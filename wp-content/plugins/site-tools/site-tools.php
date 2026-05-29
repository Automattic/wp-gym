<?php
/**
 * Plugin Name: Site Tools
 * Description: Provides a public read-only site status endpoint for simple uptime and dashboard integrations.
 * Version: 1.0.0
 * Author: OpenAI
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: site-tools
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', function () {
	register_rest_route(
		'site-tools/v1',
		'/status',
		array(
			'methods'             => 'GET',
			'callback'            => 'site_tools_get_status',
			'permission_callback' => '__return_true',
		)
	);
} );

function site_tools_get_status() {
	$post_count = wp_count_posts( 'post' );
	$published  = 0;

	if ( $post_count && isset( $post_count->publish ) ) {
		$published = (int) $post_count->publish;
	}

	return rest_ensure_response(
		array(
			'ok'              => true,
			'site_name'       => get_bloginfo( 'name' ),
			'published_posts' => $published,
		)
	);
}
