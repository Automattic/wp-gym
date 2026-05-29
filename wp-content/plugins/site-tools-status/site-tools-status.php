<?php
/**
 * Plugin Name: Site Tools Status
 * Description: Adds a public, read-only site status endpoint at /wp-json/site-tools/v1/status for uptime and dashboard integrations.
 * Version:     1.0.0
 * Author:      Site Tools
 * License:     GPL-2.0-or-later
 * Requires PHP: 7.2
 * Requires at least: 5.5
 *
 * @package SiteToolsStatus
 */

// Prevent direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the /site-tools/v1/status REST route.
 *
 * The endpoint is intentionally public and read-only: it exposes only
 * non-sensitive information (a health flag, the public site name, and the
 * count of published posts) that is already visible to unauthenticated
 * visitors of the site.
 */
function site_tools_status_register_routes() {
	register_rest_route(
		'site-tools/v1',
		'/status',
		array(
			'methods'             => WP_REST_Server::READABLE, // GET only.
			'callback'            => 'site_tools_status_handle_request',
			// Public read-only endpoint; no authentication required.
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
function site_tools_status_handle_request() {
	$published_posts = wp_count_posts( 'post' );
	$published_count = isset( $published_posts->publish ) ? (int) $published_posts->publish : 0;

	$data = array(
		'ok'               => true,
		'site_name'        => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ),
		'published_posts'  => $published_count,
	);

	return rest_ensure_response( $data );
}
