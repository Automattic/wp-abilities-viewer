=== WP Abilities Viewer ===
Contributors: agent-skills
Tags: abilities, developer, mcp
Requires at least: 6.9
Tested up to: 6.9
Requires PHP: 7.2.24
Stable tag: 0.3.9
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Browse every ability registered on a WordPress site and execute each one — via REST when exposed, or locally otherwise — to inspect the real response.

== Description ==

A diagnostic plugin for developers working with the WordPress Abilities API
(WP 6.9+). Adds **Tools → WP Abilities** listing every registered ability,
and lets an admin invoke each one with a generated input form.

Each row shows the ability's name, label, category, input-field count, whether
it declares an output schema, its annotations (readonly / destructive /
idempotent), and which transport will run the invocation:

* **REST** badge — calls `POST /wp-abilities/v1/abilities/<name>/run` (or
  `GET` for readonly abilities) — the same endpoint an MCP client hits.
* **local** badge — for abilities registered with `show_in_rest: false`.
  Runs in-process via the same `normalize_input → validate_input →
  check_permissions → execute` pipeline.

The result panel shows the method, path, elapsed time, and the raw JSON
response (or `WP_Error`) returned by the ability.

== Why you want it ==

* Verify which abilities a plugin actually registers on a live site.
* Invoke an ability end-to-end — no curl, no Postman, no auth plumbing.
* See structured errors from `validate_input` and `check_permissions` to
  debug your own registrations.
* Exercise the exact REST shape an MCP client will hit.

== Installation ==

1. Upload the plugin zip via **Plugins → Add New → Upload Plugin**.
2. Activate **WP Abilities Viewer**.
3. Go to **Tools → WP Abilities**.

Requires a user with `manage_options`. No settings; no stored data; no
public-facing endpoints.

== Frequently Asked Questions ==

= Does it add any abilities itself? =

No. It only reads what `wp_get_abilities()` returns and uses the existing
REST endpoints (`/wp-abilities/v1/abilities/...`) plus one admin-ajax
handler (gated by `manage_options` + nonce) to run abilities that aren't
REST-exposed.

= Why does "Transport: local" appear on some abilities? =

Those abilities are registered with `show_in_rest: false`. The REST
endpoint deliberately refuses them. The plugin falls back to running
them in-process so you can still see their output, using the same
ability pipeline WordPress core uses internally.

= Does it work without Jetpack / MCP adapter? =

Yes. It relies only on the core Abilities API (WP 6.9+).

== Screenshots ==

1. Tools → WP Abilities listing every registered ability, with the runner panel expanded for `core/get-site-info` showing the input form, REST endpoint, and JSON response.

== Changelog ==

= 0.3.9 =
* Render optional boolean fields as a three-way radio group (`unset` /
  `true` / `false`) instead of a checkbox. A checkbox could only send
  `true` or omit the key, with no way to send an explicit `false`.

= 0.3.8 =
* Sanitize the ability name from the local-run admin-ajax handler.
* Guard `format_annotations()` against non-scalar values (avoids "Array" output
  and PHP 8 notices when an annotation value is itself an array).
* Replace the hand-rolled CSS selector escape with `CSS.escape()`.
* Compute the runner panel's `colspan` from the row's column count so it stays
  correct if the table layout changes.
* Drop the `destructive → DELETE` REST method mapping; the run controller
  registers POST, so always use POST for non-readonly abilities.
* Remove dead admin-ajax `_definition` fallback that was never wired up.
* Add `Text Domain` / `Domain Path` headers and `load_plugin_textdomain()` for
  manual installs.

= 0.3.3 =
* Fix REST runs: the controller reads `input` from a wrapped key in the
  JSON body (POST) or query string (GET). Previously abilities with a
  schema rejected calls with "input is not of type object."

= 0.3.2 =
* Fix local runs on schema-less abilities. `WP_Ability::validate_input`
  rejects anything other than `null` when no input schema is defined.

= 0.3.1 =
* Don't URL-encode the `/` in ability slugs — Apache on some hosts (e.g.
  Atomic) rejects percent-encoded slashes in REST paths.

= 0.3.0 =
* Add local-execution path for abilities with `show_in_rest: false`.

= 0.2.0 =
* Add per-ability Run panel; execute via `wp.apiFetch` to the real REST
  route.

= 0.1.0 =
* Initial read-only viewer.
