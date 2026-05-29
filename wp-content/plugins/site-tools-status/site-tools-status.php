<?php
/**
 * Plugin Name: Site Tools Status
 * Description: Adds a public read-only REST endpoint at /wp-json/site-tools/v1/status for basic site status checks.
 * Version: 1.0.0
 * Author: Site Tools
 * License: GPL-2.0-or-later
 * Text Domain: site-tools-status
 * Requires at least: 5.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the public site status REST endpoint.
 */
function site_tools_status_register_rest_route() {
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
add_action( 'rest_api_init', 'site_tools_status_register_rest_route' );

/**
 * Return a compact, public-safe site status payload.
 *
 * @return WP_REST_Response
 */
function site_tools_status_get_status() {
	$post_counts = wp_count_posts( 'post' );
	$published   = isset( $post_counts->publish ) ? (int) $post_counts->publish : 0;

	return rest_ensure_response(
		array(
			'ok'              => true,
			'site_name'       => get_bloginfo( 'name' ),
			'published_posts' => $published,
		)
	);
}
