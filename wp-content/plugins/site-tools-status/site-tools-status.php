<?php
/**
 * Plugin Name: Site Tools Status
 * Description: Adds a public read-only REST API endpoint for compact site status information.
 * Version: 1.0.0
 * Author: Site Tools
 * License: GPL-2.0-or-later
 * Text Domain: site-tools-status
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the public site status endpoint.
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
 * Return compact, public-safe site status information.
 *
 * @return WP_REST_Response REST response containing site status details.
 */
function site_tools_status_get_status() {
	$post_counts     = wp_count_posts( 'post' );
	$published_posts = isset( $post_counts->publish ) ? (int) $post_counts->publish : 0;

	return rest_ensure_response(
		array(
			'ok'              => true,
			'site_name'       => get_bloginfo( 'name' ),
			'published_posts' => $published_posts,
		)
	);
}
