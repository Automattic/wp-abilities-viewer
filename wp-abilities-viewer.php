<?php
/**
 * Plugin Name:       WP Abilities Viewer
 * Plugin URI:        https://github.com/WordPress/agent-skills
 * Description:       Lists every WordPress ability registered on this site and lets an admin invoke each one — via the real REST route when exposed, otherwise via the same in-process pipeline. Tools → WP Abilities.
 * Version:           0.3.8
 * Requires at least: 6.9
 * Requires PHP:      7.2.24
 * Author:            Agent Skills
 * License:           GPL-2.0-or-later
 * Text Domain:       wp-abilities-viewer
 * Domain Path:       /languages
 *
 * @package WP_Abilities_Viewer
 */

declare( strict_types=1 );

namespace WP_Abilities_Viewer;

defined( 'ABSPATH' ) || exit;

const MENU_SLUG    = 'wp-abilities-viewer';
const ASSET_HANDLE = 'wp-abilities-viewer';
const VERSION      = '0.3.8';
const NONCE_ACTION = 'wp-abilities-viewer-run';
const AJAX_ACTION  = 'wp_abilities_viewer_run';

add_action( 'init', __NAMESPACE__ . '\\load_textdomain' );
add_action( 'admin_menu', __NAMESPACE__ . '\\register_admin_page' );
add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue_assets' );
add_action( 'wp_ajax_' . AJAX_ACTION, __NAMESPACE__ . '\\handle_local_run' );

function load_textdomain(): void {
	load_plugin_textdomain( 'wp-abilities-viewer', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}

function register_admin_page(): void {
	add_management_page(
		__( 'WP Abilities', 'wp-abilities-viewer' ),
		__( 'WP Abilities', 'wp-abilities-viewer' ),
		'manage_options',
		MENU_SLUG,
		__NAMESPACE__ . '\\render_admin_page'
	);
}

function enqueue_assets( string $hook ): void {
	if ( 'tools_page_' . MENU_SLUG !== $hook ) {
		return;
	}
	wp_enqueue_script(
		ASSET_HANDLE,
		plugins_url( 'viewer.js', __FILE__ ),
		array( 'wp-api-fetch', 'wp-dom-ready' ),
		VERSION,
		true
	);
	wp_enqueue_style(
		ASSET_HANDLE,
		plugins_url( 'viewer.css', __FILE__ ),
		array(),
		VERSION
	);
	wp_add_inline_script(
		ASSET_HANDLE,
		'window.wpAbilitiesViewer = ' . wp_json_encode( array(
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
			'action'  => AJAX_ACTION,
			'nonce'   => wp_create_nonce( NONCE_ACTION ),
		) ) . ';',
		'before'
	);
}

function render_admin_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$abilities = function_exists( 'wp_get_abilities' ) ? wp_get_abilities() : array();

	echo '<div class="wrap wpav-wrap">';
	echo '<h1>' . esc_html__( 'WP Abilities', 'wp-abilities-viewer' ) . '</h1>';

	if ( ! function_exists( 'wp_get_abilities' ) ) {
		echo '<div class="notice notice-error"><p>';
		echo esc_html__( 'wp_get_abilities() is not available. This site needs WordPress 6.9+ with the Abilities API.', 'wp-abilities-viewer' );
		echo '</p></div></div>';
		return;
	}

	$total = count( $abilities );

	printf(
		'<p>%s</p><p><small>%s</small></p>',
		sprintf(
			/* translators: %d: number of abilities registered */
			esc_html( _n( '%d ability registered. Click Run… on any row to invoke it.', '%d abilities registered. Click Run… on any row to invoke one.', $total, 'wp-abilities-viewer' ) ),
			(int) $total
		),
		esc_html__( 'REST-exposed abilities run via /wp-abilities/v1/abilities/<name>/run (the same endpoint an MCP client hits). Non-REST abilities run locally through the same permission_callback + validate_input + execute pipeline.', 'wp-abilities-viewer' )
	);

	if ( 0 === $total ) {
		echo '<p><em>' . esc_html__( 'No abilities are registered on this site yet.', 'wp-abilities-viewer' ) . '</em></p></div>';
		return;
	}

	echo '<table class="widefat striped wpav-table">';
	echo '<thead><tr>';
	echo '<th>' . esc_html__( 'Name', 'wp-abilities-viewer' ) . '</th>';
	echo '<th>' . esc_html__( 'Label', 'wp-abilities-viewer' ) . '</th>';
	echo '<th>' . esc_html__( 'Category', 'wp-abilities-viewer' ) . '</th>';
	echo '<th>' . esc_html__( 'Input', 'wp-abilities-viewer' ) . '</th>';
	echo '<th>' . esc_html__( 'Output?', 'wp-abilities-viewer' ) . '</th>';
	echo '<th>' . esc_html__( 'Annotations', 'wp-abilities-viewer' ) . '</th>';
	echo '<th>' . esc_html__( 'Transport', 'wp-abilities-viewer' ) . '</th>';
	echo '<th></th>';
	echo '</tr></thead><tbody>';

	foreach ( $abilities as $ability ) {
		render_row( $ability );
	}

	echo '</tbody></table>';
	echo '</div>';
}

/**
 * @param \WP_Ability $ability
 */
function render_row( $ability ): void {
	$name          = method_exists( $ability, 'get_name' ) ? (string) $ability->get_name() : '';
	$label         = method_exists( $ability, 'get_label' ) ? (string) $ability->get_label() : '';
	$description   = method_exists( $ability, 'get_description' ) ? (string) $ability->get_description() : '';
	$category      = method_exists( $ability, 'get_category' ) ? (string) $ability->get_category() : '';
	$input_schema  = method_exists( $ability, 'get_input_schema' ) ? $ability->get_input_schema() : array();
	$output_schema = method_exists( $ability, 'get_output_schema' ) ? $ability->get_output_schema() : array();
	$meta          = method_exists( $ability, 'get_meta' ) ? $ability->get_meta() : array();
	$annotations   = isset( $meta['annotations'] ) && is_array( $meta['annotations'] ) ? $meta['annotations'] : array();
	$show_in_rest  = ! empty( $meta['show_in_rest'] );

	$input_field_count = 0;
	if ( is_array( $input_schema ) && isset( $input_schema['properties'] ) && is_array( $input_schema['properties'] ) ) {
		$input_field_count = count( $input_schema['properties'] );
	}

	$transport = $show_in_rest ? 'rest' : 'local';

	echo '<tr class="wpav-row" data-ability="' . esc_attr( $name ) . '" data-transport="' . esc_attr( $transport ) . '">';
	echo '<td><code>' . esc_html( $name ) . '</code><br><small>' . esc_html( $description ) . '</small></td>';
	echo '<td>' . esc_html( $label ) . '</td>';
	echo '<td>' . esc_html( $category ) . '</td>';
	echo '<td>' . (int) $input_field_count . ' ' . esc_html__( 'field(s)', 'wp-abilities-viewer' ) . '</td>';
	echo '<td>' . ( ! empty( $output_schema ) ? esc_html__( 'yes', 'wp-abilities-viewer' ) : '—' ) . '</td>';
	echo '<td><small>' . esc_html( format_annotations( $annotations ) ) . '</small></td>';
	echo '<td>';
	if ( $show_in_rest ) {
		echo '<span class="wpav-badge wpav-badge-rest">REST</span>';
	} else {
		echo '<span class="wpav-badge wpav-badge-local" title="' . esc_attr__( 'show_in_rest is false; runs locally through the same permission + schema + execute pipeline.', 'wp-abilities-viewer' ) . '">local</span>';
	}
	echo '</td>';
	echo '<td><button type="button" class="button wpav-run-button" data-ability="' . esc_attr( $name ) . '">' . esc_html__( 'Run…', 'wp-abilities-viewer' ) . '</button></td>';
	echo '</tr>';
}

/**
 * @param array<string,mixed> $annotations
 */
function format_annotations( array $annotations ): string {
	if ( empty( $annotations ) ) {
		return '—';
	}
	$parts = array();
	foreach ( $annotations as $key => $value ) {
		if ( is_bool( $value ) ) {
			$parts[] = sprintf( '%s=%s', $key, $value ? 'true' : 'false' );
		} elseif ( is_scalar( $value ) ) {
			$parts[] = sprintf( '%s=%s', $key, (string) $value );
		} else {
			$parts[] = sprintf( '%s=%s', $key, (string) wp_json_encode( $value ) );
		}
	}
	return implode( ', ', $parts );
}

/**
 * Admin-ajax handler: run an ability in-process for abilities that aren't
 * exposed to REST. Mirrors the pipeline the REST handler runs server-side:
 * normalize_input -> validate_input -> check_permissions -> execute.
 */
function handle_local_run(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_send_json_error( array(
			'code'    => 'forbidden',
			'message' => __( 'You do not have permission to run abilities.', 'wp-abilities-viewer' ),
		), 403 );
	}

	check_ajax_referer( NONCE_ACTION, 'nonce' );

	$name_raw = isset( $_POST['ability_name'] ) ? wp_unslash( $_POST['ability_name'] ) : '';
	$name     = is_string( $name_raw ) ? trim( sanitize_text_field( $name_raw ) ) : '';
	if ( '' === $name ) {
		wp_send_json_error( array(
			'code'    => 'missing_name',
			'message' => __( 'Missing ability name.', 'wp-abilities-viewer' ),
		), 400 );
	}

	$args_raw = isset( $_POST['args'] ) ? wp_unslash( $_POST['args'] ) : '{}';
	$args     = is_string( $args_raw ) ? json_decode( $args_raw, true ) : array();
	if ( ! is_array( $args ) ) {
		$args = array();
	}

	if ( ! function_exists( 'wp_get_ability' ) ) {
		wp_send_json_error( array(
			'code'    => 'abilities_api_missing',
			'message' => __( 'wp_get_ability() is not available.', 'wp-abilities-viewer' ),
		), 500 );
	}

	$ability = wp_get_ability( $name );
	if ( ! $ability ) {
		wp_send_json_error( array(
			'code'    => 'ability_not_found',
			'message' => sprintf( /* translators: %s: ability name */ __( 'Ability "%s" is not registered.', 'wp-abilities-viewer' ), $name ),
		), 404 );
	}

	$started = microtime( true );

	$input_schema = method_exists( $ability, 'get_input_schema' ) ? $ability->get_input_schema() : array();
	$has_schema   = is_array( $input_schema ) && ! empty( $input_schema );

	if ( $has_schema && method_exists( $ability, 'normalize_input' ) ) {
		$normalized = $ability->normalize_input( $args );
		if ( is_wp_error( $normalized ) ) {
			send_wp_error( $normalized, 400, $started );
		}
	} else {
		// Schema-less abilities (e.g. core/get-user-info) require null, not
		// empty-array, or WP_Ability::validate_input() — which execute() calls
		// internally — rejects with ability_missing_input_schema.
		$normalized = null;
	}

	if ( $has_schema && method_exists( $ability, 'validate_input' ) ) {
		$validation = $ability->validate_input( $normalized );
		if ( is_wp_error( $validation ) ) {
			send_wp_error( $validation, 400, $started );
		}
	}

	if ( method_exists( $ability, 'check_permissions' ) ) {
		$permitted = $ability->check_permissions();
		if ( is_wp_error( $permitted ) ) {
			send_wp_error( $permitted, 403, $started );
		}
		if ( true !== $permitted ) {
			send_wp_error(
				new \WP_Error( 'forbidden', __( 'Permission denied by the ability.', 'wp-abilities-viewer' ) ),
				403,
				$started
			);
		}
	}

	$result = $ability->execute( $normalized );
	if ( is_wp_error( $result ) ) {
		send_wp_error( $result, 400, $started );
	}

	wp_send_json( array(
		'success'      => true,
		'data'         => $result,
		'_transport'   => 'local',
		'_elapsed_ms'  => (int) round( ( microtime( true ) - $started ) * 1000 ),
	) );
}

function send_wp_error( \WP_Error $error, int $status, float $started ): void {
	wp_send_json( array(
		'success'     => false,
		'code'        => $error->get_error_code(),
		'message'     => $error->get_error_message(),
		'data'        => $error->get_error_data(),
		'_transport'  => 'local',
		'_elapsed_ms' => (int) round( ( microtime( true ) - $started ) * 1000 ),
	), $status );
}
