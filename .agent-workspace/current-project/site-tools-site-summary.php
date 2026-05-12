<?php
/**
 * Plugin Name: Site Tools - Site Summary Ability
 * Description: Exposes a WordPress Abilities API action that returns the site name and published post count.
 * Version: 1.0.0
 * Author: Site Tools
 * License: GPL-2.0-or-later
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Text Domain: site-tools-site-summary
 *
 * @package SiteToolsSiteSummary
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the Site Tools ability category.
 */
function site_tools_site_summary_register_ability_category() {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		'site-tools',
		array(
			'label'       => __( 'Site Tools', 'site-tools-site-summary' ),
			'description' => __( 'Read-only utilities for discovering basic site information.', 'site-tools-site-summary' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'site_tools_site_summary_register_ability_category' );

/**
 * Register the callable site summary ability.
 */
function site_tools_site_summary_register_ability() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-site-summary' ),
			'description'         => __( 'Returns the current site name and number of published posts.', 'site-tools-site-summary' ),
			'category'            => 'site-tools',
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => array(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'                 => 'object',
				'properties'           => array(
					'site_name'       => array(
						'type'        => 'string',
						'description' => __( 'The configured WordPress site name.', 'site-tools-site-summary' ),
					),
					'published_posts' => array(
						'type'        => 'integer',
						'description' => __( 'The number of published posts on the site.', 'site-tools-site-summary' ),
					),
				),
				'required'             => array( 'site_name', 'published_posts' ),
				'additionalProperties' => false,
			),
			'execute_callback'    => 'site_tools_site_summary_get_summary',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'wp_abilities_api_init', 'site_tools_site_summary_register_ability' );

/**
 * Return a compact summary of the current WordPress site.
 *
 * @return array{site_name:string,published_posts:int} Site summary data.
 */
function site_tools_site_summary_get_summary() {
	$post_counts = wp_count_posts( 'post' );

	return array(
		'site_name'       => get_bloginfo( 'name' ),
		'published_posts' => isset( $post_counts->publish ) ? (int) $post_counts->publish : 0,
	);
}
