( function () {
	'use strict';

	if ( ! window.wp || ! window.wp.apiFetch ) {
		return;
	}

	const apiFetch = window.wp.apiFetch;
	const localCfg = window.wpAbilitiesViewer || { ajaxUrl: '', action: '', nonce: '' };

	function el( tag, attrs, ...children ) {
		const node = document.createElement( tag );
		if ( attrs ) {
			for ( const [ k, v ] of Object.entries( attrs ) ) {
				if ( k === 'class' ) {
					node.className = v;
				} else if ( k === 'text' ) {
					node.textContent = v;
				} else if ( k === 'html' ) {
					node.innerHTML = v;
				} else if ( k.startsWith( 'on' ) && typeof v === 'function' ) {
					node.addEventListener( k.slice( 2 ).toLowerCase(), v );
				} else if ( v !== undefined && v !== null && v !== false ) {
					node.setAttribute( k, v );
				}
			}
		}
		for ( const c of children ) {
			if ( c == null ) continue;
			node.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c );
		}
		return node;
	}

	function propertyType( prop ) {
		if ( Array.isArray( prop.type ) ) {
			return prop.type.find( ( t ) => t !== 'null' ) || 'string';
		}
		return prop.type || 'string';
	}

	function buildFieldInput( key, prop, required ) {
		const type = propertyType( prop );
		let input;
		if ( Array.isArray( prop.enum ) && prop.enum.length ) {
			input = el( 'select', { name: key, 'data-type': type, class: 'wpav-input' },
				el( 'option', { value: '', text: '— unset —' } ),
				...prop.enum.map( ( v ) => el( 'option', { value: String( v ), text: String( v ) } ) )
			);
		} else if ( type === 'boolean' ) {
			// Booleans render as a radio group so the user can pick true or false
			// explicitly. Optional fields get a third "unset" option (selected by
			// default) so the key can be omitted from the request — a checkbox
			// can't distinguish "send false" from "don't send the key at all".
			input = el( 'div', {
				class: 'wpav-input wpav-input-radio',
				'data-type': 'boolean',
				'data-name': key,
			} );
			if ( ! required ) {
				input.appendChild(
					el( 'label', { class: 'wpav-radio-option' },
						el( 'input', { type: 'radio', name: key, value: '', checked: true } ),
						' unset'
					)
				);
			}
			input.appendChild(
				el( 'label', { class: 'wpav-radio-option' },
					el( 'input', { type: 'radio', name: key, value: 'true' } ),
					' true'
				)
			);
			input.appendChild(
				el( 'label', { class: 'wpav-radio-option' },
					el( 'input', { type: 'radio', name: key, value: 'false' } ),
					' false'
				)
			);
		} else if ( type === 'integer' ) {
			input = el( 'input', { type: 'number', step: '1', name: key, 'data-type': 'integer', class: 'wpav-input' } );
		} else if ( type === 'number' ) {
			input = el( 'input', { type: 'number', step: 'any', name: key, 'data-type': 'number', class: 'wpav-input' } );
		} else if ( type === 'array' || type === 'object' ) {
			input = el( 'textarea', {
				name: key,
				'data-type': type,
				class: 'wpav-input wpav-input-json',
				rows: '2',
				placeholder: type === 'array' ? '[1, 2, 3]' : '{}',
			} );
		} else {
			input = el( 'input', {
				type: 'text',
				name: key,
				'data-type': 'string',
				class: 'wpav-input',
				placeholder: prop.format || '',
			} );
		}
		return input;
	}

	function buildForm( schema ) {
		const properties = ( schema && schema.properties ) || {};
		const required = new Set( ( schema && schema.required ) || [] );
		const form = el( 'div', { class: 'wpav-form' } );
		const keys = Object.keys( properties );

		if ( keys.length === 0 ) {
			form.appendChild( el( 'p', { class: 'wpav-no-fields', text: 'No input required.' } ) );
			return form;
		}

		for ( const key of keys ) {
			const prop = properties[ key ];
			const input = buildFieldInput( key, prop, required.has( key ) );
			const labelText = key + ( required.has( key ) ? ' *' : '' );
			const description = prop.description ? el( 'span', { class: 'wpav-desc', text: prop.description } ) : null;
			const typeHint = el( 'span', { class: 'wpav-type-hint', text: propertyType( prop ) } );
			form.appendChild(
				el( 'div', { class: 'wpav-field' },
					el( 'label', { class: 'wpav-label' }, labelText, typeHint ),
					input,
					description
				)
			);
		}
		return form;
	}

	function coerceValue( input ) {
		const type = input.dataset.type;
		if ( type === 'boolean' ) {
			// Both required and optional booleans render as a radio group; an
			// empty value (the optional "unset" option) means "omit this key".
			const checked = input.querySelector( 'input[type="radio"]:checked' );
			if ( ! checked || checked.value === '' ) return undefined;
			return checked.value === 'true';
		}
		const raw = input.value;
		if ( raw === '' ) return undefined;
		if ( type === 'integer' ) {
			const n = parseInt( raw, 10 );
			return Number.isFinite( n ) ? n : undefined;
		}
		if ( type === 'number' ) {
			const n = parseFloat( raw );
			return Number.isFinite( n ) ? n : undefined;
		}
		if ( type === 'array' || type === 'object' ) {
			try {
				return JSON.parse( raw );
			} catch ( e ) {
				throw new Error( `Invalid JSON for "${ input.name }": ${ e.message }` );
			}
		}
		return raw;
	}

	function collectArgs( form ) {
		const args = {};
		const inputs = form.querySelectorAll( '.wpav-input' );
		for ( const input of inputs ) {
			const value = coerceValue( input );
			if ( value !== undefined ) {
				// Form elements expose .name; the radio-group wrapper is a <div>, so
				// fall back to data-name set in buildFieldInput.
				args[ input.name || input.dataset.name ] = value;
			}
		}
		return args;
	}

	function pickRestMethod( annotations ) {
		if ( annotations && annotations.readonly === true ) return 'GET';
		return 'POST';
	}

	async function fetchAbilityDefinition( name, transport ) {
		if ( transport === 'rest' ) {
			return apiFetch( { path: '/wp-abilities/v1/abilities/' + name } );
		}
		// Local transport: try the REST detail call first, then fall back to a
		// minimal definition scraped from the page DOM when the detail endpoint
		// refuses non-REST abilities. The DOM fallback is degraded — schema is
		// empty, so the form will render "No input required."
		try {
			return await apiFetch( { path: '/wp-abilities/v1/abilities/' + name } );
		} catch ( err ) {
			const row = document.querySelector( `tr.wpav-row[data-ability="${ CSS.escape( name ) }"]` );
			return {
				name,
				input_schema: { type: 'object', properties: {} },
				meta: { annotations: {} },
				label: row ? row.children[ 1 ].textContent : name,
				description: '',
			};
		}
	}

	// Serialize a nested value into PHP-style bracket notation (input[slug]=...,
	// input[items][0]=...) so $request->get_query_params() returns it as an array.
	// JSON-encoding the whole payload as a single string fails because PHP keeps
	// it as a string and the schema's type:object check rejects it.
	function appendNestedQuery( params, key, value ) {
		if ( value === null || value === undefined ) return;
		if ( Array.isArray( value ) ) {
			value.forEach( ( v, i ) => appendNestedQuery( params, key + '[' + i + ']', v ) );
		} else if ( typeof value === 'object' ) {
			for ( const [ k, v ] of Object.entries( value ) ) {
				appendNestedQuery( params, key + '[' + k + ']', v );
			}
		} else {
			params.append( key, String( value ) );
		}
	}

	async function executeRest( name, args, annotations ) {
		const method = pickRestMethod( annotations );
		let path = '/wp-abilities/v1/abilities/' + name + '/run';
		const request = { path, method };
		// The run controller reads the ability's input from the "input" key
		// (query string on GET/DELETE; JSON body on POST). See
		// class-wp-rest-abilities-v1-run-controller.php::get_input_from_request.
		const payload = args || {};
		const hasArgs = Object.keys( payload ).length > 0;
		if ( method === 'GET' || method === 'DELETE' ) {
			// Always send `input` — even when empty — so the server treats it
			// as an object instead of null. `rest_is_object('')` returns true
			// and `rest_sanitize_object('')` yields []; omitting `input` would
			// leave it null and fail "input is not of type object". For
			// non-empty payloads use bracket notation so PHP parses it into
			// an actual array/object.
			const qp = new URLSearchParams();
			if ( hasArgs ) {
				appendNestedQuery( qp, 'input', payload );
			} else {
				qp.append( 'input', '' );
			}
			path += '?' + qp.toString();
			request.path = path;
		} else {
			// Always send `input` for POST — even when empty — so schema validation
			// reports specific missing-property errors instead of "input is not of type object".
			request.data = { input: payload };
		}
		const started = performance.now();
		try {
			const response = await apiFetch( request );
			return {
				ok: true,
				method,
				path,
				elapsed: Math.round( performance.now() - started ),
				body: response,
			};
		} catch ( err ) {
			return {
				ok: false,
				method,
				path,
				elapsed: Math.round( performance.now() - started ),
				body: err,
			};
		}
	}

	async function executeLocal( name, args ) {
		const started = performance.now();
		const body = new FormData();
		body.append( 'action', localCfg.action );
		body.append( 'nonce', localCfg.nonce );
		body.append( 'ability_name', name );
		body.append( 'args', JSON.stringify( args ) );
		const res = await fetch( localCfg.ajaxUrl, { method: 'POST', credentials: 'same-origin', body } );
		const json = await res.json().catch( () => ( { raw: '(non-JSON response)' } ) );
		return {
			ok: res.ok && json && json.success !== false,
			method: 'POST',
			path: 'admin-ajax.php?action=' + localCfg.action,
			elapsed: Math.round( performance.now() - started ),
			body: json,
		};
	}

	async function openRunner( row ) {
		const name = row.dataset.ability;
		const transport = row.dataset.transport || 'rest';
		const existing = row.nextElementSibling;
		if ( existing && existing.classList.contains( 'wpav-panel' ) ) {
			existing.remove();
			return;
		}

		const panel = el( 'tr', { class: 'wpav-panel' } );
		const cell = el( 'td', { colspan: String( row.children.length ) } );
		panel.appendChild( cell );
		cell.appendChild( el( 'div', { class: 'wpav-loading', text: 'Loading ability definition…' } ) );
		row.after( panel );

		let ability;
		try {
			ability = await fetchAbilityDefinition( name, transport );
		} catch ( err ) {
			cell.innerHTML = '';
			cell.appendChild( el( 'pre', { class: 'wpav-result wpav-result-error', text: 'Failed to load ability:\n' + JSON.stringify( err, null, 2 ) } ) );
			return;
		}

		const schema = ability.input_schema || { type: 'object', properties: {} };
		const annotations = ( ability.meta && ability.meta.annotations ) || {};

		cell.innerHTML = '';
		const wrap = el( 'div', { class: 'wpav-runner' } );
		wrap.appendChild( el( 'h4', {}, 'Execute: ', el( 'code', { text: name } ) ) );

		const transportLabel = transport === 'rest'
			? 'via REST (' + pickRestMethod( annotations ) + ' /wp-abilities/v1/abilities/' + name + '/run)'
			: 'locally (in-process; ability has show_in_rest=false)';
		wrap.appendChild( el( 'p', { class: 'wpav-endpoint' },
			el( 'span', { class: 'wpav-http-method wpav-http-method-' + transport }, transport.toUpperCase() ),
			' ',
			el( 'code', { text: transportLabel } )
		) );

		const form = buildForm( schema );
		wrap.appendChild( form );

		const runBtn = el( 'button', { class: 'button button-primary wpav-execute' }, 'Execute' );
		const closeBtn = el( 'button', { class: 'button wpav-close' }, 'Close' );
		wrap.appendChild( el( 'p', { class: 'wpav-actions' }, runBtn, ' ', closeBtn ) );

		wrap.appendChild( el( 'h5', { class: 'wpav-result-label', text: 'Result' } ) );
		const resultBlock = el( 'pre', { class: 'wpav-result', text: '(not yet executed)' } );
		wrap.appendChild( resultBlock );

		cell.appendChild( wrap );

		closeBtn.addEventListener( 'click', () => panel.remove() );

		runBtn.addEventListener( 'click', async () => {
			let args;
			try {
				args = collectArgs( form );
			} catch ( err ) {
				resultBlock.className = 'wpav-result wpav-result-error';
				resultBlock.textContent = err.message;
				return;
			}
			resultBlock.className = 'wpav-result';
			resultBlock.textContent = 'executing…';

			const outcome = transport === 'rest'
				? await executeRest( name, args, annotations )
				: await executeLocal( name, args );

			resultBlock.className = 'wpav-result' + ( outcome.ok ? '' : ' wpav-result-error' );
			const header = `// ${ outcome.method } ${ outcome.path } — ${ outcome.elapsed } ms${ outcome.ok ? '' : ' — ERROR' }\n`;
			resultBlock.textContent = header + JSON.stringify( outcome.body, null, 2 );
		} );
	}

	function bind() {
		document.addEventListener( 'click', ( e ) => {
			const btn = e.target.closest( '.wpav-run-button' );
			if ( ! btn ) return;
			e.preventDefault();
			const row = btn.closest( 'tr.wpav-row' );
			if ( row ) openRunner( row );
		} );
	}

	if ( window.wp && window.wp.domReady ) {
		window.wp.domReady( bind );
	} else if ( document.readyState !== 'loading' ) {
		bind();
	} else {
		document.addEventListener( 'DOMContentLoaded', bind );
	}
} )();
