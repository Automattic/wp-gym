<?php
/**
 * Plugin Name: Site Tools Status
 * Description: Adds a public read-only site status endpoint at /wp-json/site-tools/v1/status for uptime and dashboard integrations.
 * Version:     1.0.0
 * Author:      Site Tools
 * License:     GPL-2.0-or-later
 * Text Domain: site-tools-status
 *
 * @package SiteToolsStatus
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the /site-tools/v1/status REST route.
 *
 * The endpoint is intentionally public and read-only. It exposes only
 * non-sensitive, already-public information (site name, published post count)
 * plus a simple OK flag suitable for uptime checks.
 */
function site_tools_status_register_routes() {
	register_rest_route(
		'site-tools/v1',
		'/status',
		array(
			'methods'             => 'GET',
			'callback'            => 'site_tools_status_get_status',
			// Public read-only endpoint: no authentication required.
			'permission_callback' => '__return_true',
			'args'                => array(),
		)
	);
}
add_action( 'rest_api_init', 'site_tools_status_register_routes' );

/**
 * Build the status payload.
 *
 * @return WP_REST_Response Compact status payload.
 */
function site_tools_status_get_status() {
	$published_posts = wp_count_posts( 'post' );
	$published_count = isset( $published_posts->publish ) ? (int) $published_posts->publish : 0;

	$data = array(
		'ok'              => true,
		'site_name'       => get_bloginfo( 'name' ),
		'published_posts' => $published_count,
	);

	return rest_ensure_response( $data );
}
