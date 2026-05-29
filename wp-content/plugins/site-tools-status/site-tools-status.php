<?php
/**
 * Plugin Name: Site Tools Status Endpoint
 * Description: Adds a public read-only REST API endpoint at /wp-json/site-tools/v1/status for basic site status checks.
 * Version: 1.0.0
 * Author: Site Tools
 * License: GPL-2.0-or-later
 * Text Domain: site-tools-status
 *
 * @package SiteToolsStatus
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the public site status endpoint.
 */
function site_tools_status_register_route() {
	register_rest_route(
		'site-tools/v1',
		'/status',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'site_tools_status_get_status',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'rest_api_init', 'site_tools_status_register_route' );

/**
 * Return a compact read-only status payload.
 *
 * @return WP_REST_Response REST response containing site status information.
 */
function site_tools_status_get_status() {
	$payload = array(
		'ok'              => true,
		'name'            => get_bloginfo( 'name' ),
		'published_posts' => (int) wp_count_posts( 'post' )->publish,
	);

	return rest_ensure_response( $payload );
}
