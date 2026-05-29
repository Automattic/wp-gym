<?php
/**
 * Plugin Name: Site Tools Status
 * Description: Adds a public read-only site status endpoint at /wp-json/site-tools/v1/status for simple uptime/dashboard integrations.
 * Version:     1.0.0
 * Author:      Site Tools
 * License:     GPL-2.0-or-later
 * Requires at least: 5.0
 * Requires PHP: 7.2
 *
 * @package SiteToolsStatus
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the REST route for the site status endpoint.
 */
function site_tools_status_register_routes() {
	register_rest_route(
		'site-tools/v1',
		'/status',
		array(
			'methods'             => 'GET',
			'callback'            => 'site_tools_status_get_status',
			// Public, read-only endpoint: no authentication required.
			'permission_callback' => '__return_true',
			'args'                => array(),
		)
	);
}
add_action( 'rest_api_init', 'site_tools_status_register_routes' );

/**
 * Return a compact site status payload.
 *
 * Shape:
 *   {
 *     "ok":             bool,    // always true when the endpoint can respond
 *     "site_name":      string,  // result of get_bloginfo('name')
 *     "published_posts": int     // count of published posts of type 'post'
 *   }
 *
 * @return WP_REST_Response
 */
function site_tools_status_get_status() {
	$counts           = wp_count_posts( 'post' );
	$published_posts  = isset( $counts->publish ) ? (int) $counts->publish : 0;

	$payload = array(
		'ok'              => true,
		'site_name'       => (string) get_bloginfo( 'name' ),
		'published_posts' => $published_posts,
	);

	return new WP_REST_Response( $payload, 200 );
}
