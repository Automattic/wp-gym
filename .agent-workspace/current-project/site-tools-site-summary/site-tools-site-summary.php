<?php
/**
 * Plugin Name: Site Tools - Site Summary
 * Description: Registers a callable "site-tools/site-summary" ability that returns a compact summary of this WordPress site (name and number of published posts) for automation tools built on the WordPress Abilities API.
 * Version:     0.1.0
 * Author:      Site Tools
 * License:     GPL-2.0-or-later
 * Requires PHP: 7.4
 * Text Domain: site-tools-site-summary
 *
 * @package SiteTools\SiteSummary
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Build the compact site summary payload.
 *
 * Returns an associative array containing the current site name and the
 * number of published posts. Kept intentionally small so it is safe to call
 * from automation tools and easy to consume.
 *
 * @return array{name:string,published_posts:int}
 */
function site_tools_site_summary_build_summary() {
	$counts          = wp_count_posts( 'post' );
	$published_posts = isset( $counts->publish ) ? (int) $counts->publish : 0;

	return array(
		'name'            => (string) get_bloginfo( 'name' ),
		'published_posts' => $published_posts,
	);
}

/**
 * Register the "site-tools/site-summary" ability with the WordPress
 * Abilities API once it is available.
 */
function site_tools_site_summary_register_ability() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-site-summary' ),
			'description'         => __(
				'Returns a compact summary of this WordPress site, including the site name and the number of published posts.',
				'site-tools-site-summary'
			),
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => new stdClass(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'name'            => array(
						'type'        => 'string',
						'description' => __( 'The site name (blogname).', 'site-tools-site-summary' ),
					),
					'published_posts' => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Number of posts in the "publish" status.', 'site-tools-site-summary' ),
					),
				),
				'required'   => array( 'name', 'published_posts' ),
			),
			'execute_callback'    => 'site_tools_site_summary_build_summary',
			'permission_callback' => '__return_true',
		)
	);
}

// The Abilities API registers its bootstrap on `abilities_api_init`, which is
// the canonical hook for registering abilities on fresh sites.
add_action( 'abilities_api_init', 'site_tools_site_summary_register_ability' );
