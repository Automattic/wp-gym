<?php
/**
 * Plugin Name:       Site Tools — Site Summary
 * Description:       Registers a `site-tools/site-summary` ability that returns a compact site summary (site name and published post count) for discovery and execution via the WordPress Abilities API.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            Site Tools
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       site-tools-summary
 *
 * @package SiteTools\Summary
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the `site-tools` ability category.
 *
 * Runs on `wp_abilities_api_categories_init` so the category exists before
 * any abilities try to attach to it.
 *
 * @return void
 */
function site_tools_summary_register_category(): void {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		'site-tools',
		array(
			'label'       => __( 'Site Tools', 'site-tools-summary' ),
			'description' => __( 'Utility abilities for inspecting and managing this WordPress site.', 'site-tools-summary' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'site_tools_summary_register_category' );

/**
 * Register the `site-tools/site-summary` ability.
 *
 * Runs on `wp_abilities_api_init` so all of WordPress (and the Abilities API
 * registry) is fully loaded before the ability is registered.
 *
 * @return void
 */
function site_tools_summary_register_ability(): void {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-summary' ),
			'description'         => __( 'Returns a compact summary of this site: its name and the number of published posts.', 'site-tools-summary' ),
			'category'            => 'site-tools',
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => new stdClass(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'                 => 'object',
				'properties'           => array(
					'site_name'        => array(
						'type'        => 'string',
						'description' => __( 'The current site name (blogname option).', 'site-tools-summary' ),
					),
					'published_posts'  => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Number of posts in the `publish` status for the default `post` post type.', 'site-tools-summary' ),
					),
				),
				'required'             => array( 'site_name', 'published_posts' ),
				'additionalProperties' => false,
			),
			'execute_callback'    => 'site_tools_summary_execute',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'wp_abilities_api_init', 'site_tools_summary_register_ability' );

/**
 * Execute callback for the `site-tools/site-summary` ability.
 *
 * Returns a compact summary with the site name and published post count.
 *
 * @param array<string,mixed> $input Validated input (currently unused; schema is empty).
 * @return array{site_name:string,published_posts:int}
 */
function site_tools_summary_execute( $input = array() ): array {
	unset( $input ); // No input is required for this ability.

	$counts          = wp_count_posts( 'post' );
	$published_posts = isset( $counts->publish ) ? (int) $counts->publish : 0;

	return array(
		'site_name'       => (string) get_bloginfo( 'name' ),
		'published_posts' => $published_posts,
	);
}
