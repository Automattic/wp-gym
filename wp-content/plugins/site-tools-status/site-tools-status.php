<?php
/**
 * Plugin Name: Site Tools - Status Endpoint
 * Description: Adds a public read-only site status endpoint at /wp-json/site-tools/v1/status for uptime/dashboard integrations.
 * Version:     1.0.0
 * Author:      Site Tools
 * License:     GPL-2.0-or-later
 * Requires at least: 5.0
 * Requires PHP: 7.2
 *
 * @package SiteTools\Status
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the /site-tools/v1/status REST route.
 *
 * The endpoint is intentionally public (permission_callback returns true) because
 * it only exposes non-sensitive, already-public information: the site name and
 * the count of published posts (which any visitor can already enumerate).
 */
function site_tools_status_register_routes() {
	register_rest_route(
		'site-tools/v1',
		'/status',
		array(
			'methods'             => WP_REST_Server::READABLE, // GET only.
			'callback'            => 'site_tools_status_get_status',
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

	return new WP_REST_Response( $data, 200 );
}
