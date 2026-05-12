<?php
/**
 * Plugin Name: Site Tools - Site Summary
 * Description: Exposes a small automation action that returns the current site name and published post count.
 * Version: 1.0.0
 * Author: Test Blog
 * License: GPL-2.0-or-later
 * Text Domain: site-tools-site-summary
 *
 * @package SiteToolsSiteSummary
 */

declare( strict_types=1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Build the compact site summary returned by the automation action.
 *
 * @return array{name:string,published_posts:int}
 */
function site_tools_site_summary_get_summary(): array {
	$counts = wp_count_posts( 'post' );

	return array(
		'name'            => get_bloginfo( 'name' ),
		'published_posts' => isset( $counts->publish ) ? (int) $counts->publish : 0,
	);
}

/**
 * Register the site summary action with the WordPress Abilities API when present.
 *
 * The action name uses the `site-tools` namespace so automation clients can
 * discover it under a site-tools grouping.
 */
function site_tools_site_summary_register_ability(): void {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-site-summary' ),
			'description'         => __( 'Returns the current site name and number of published posts.', 'site-tools-site-summary' ),
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => array(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'       => 'object',
				'required'   => array( 'name', 'published_posts' ),
				'properties' => array(
					'name'            => array(
						'type'        => 'string',
						'description' => __( 'The current site name.', 'site-tools-site-summary' ),
					),
					'published_posts' => array(
						'type'        => 'integer',
						'description' => __( 'The number of published posts.', 'site-tools-site-summary' ),
					),
				),
			),
			'execute_callback'    => 'site_tools_site_summary_get_summary',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'init', 'site_tools_site_summary_register_ability' );
