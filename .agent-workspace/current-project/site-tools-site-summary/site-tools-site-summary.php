<?php
/**
 * Plugin Name:       Site Tools: Site Summary
 * Plugin URI:        https://example.com/site-tools-site-summary
 * Description:       Registers a WordPress Abilities API ability (`site-tools/site-summary`) that returns a compact summary of the site, including its name and published post count. Intended as an automation hook for external tools that discover and execute abilities under the `site-tools` grouping.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            Site Tools
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       site-tools-site-summary
 *
 * @package SiteTools\SiteSummary
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the `site-tools` ability category.
 *
 * Categories must be registered on `wp_abilities_api_categories_init` so that
 * abilities registered later can be grouped under them. Guarded with a
 * `function_exists()` check so the plugin is safe to activate even when the
 * Abilities API is not present on the host site.
 *
 * @return void
 */
function site_tools_site_summary_register_category() {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		'site-tools',
		array(
			'label'       => __( 'Site Tools', 'site-tools-site-summary' ),
			'description' => __( 'Automation helpers that expose lightweight information and operations about this WordPress site.', 'site-tools-site-summary' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'site_tools_site_summary_register_category' );

/**
 * Register the `site-tools/site-summary` ability.
 *
 * Registers the callable ability on `wp_abilities_api_init` so it is available
 * after WordPress has finished loading and other tools can discover and
 * execute it via the Abilities API.
 *
 * @return void
 */
function site_tools_site_summary_register_ability() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-site-summary' ),
			'description'         => __( 'Returns a compact summary of this WordPress site, including the site name and the total number of published posts.', 'site-tools-site-summary' ),
			'category'            => 'site-tools',
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => new stdClass(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'site_name'       => array(
						'type'        => 'string',
						'description' => __( 'The current site name (the `blogname` option).', 'site-tools-site-summary' ),
					),
					'published_posts' => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'The number of posts in the `post` post type with status `publish`.', 'site-tools-site-summary' ),
					),
				),
				'required'   => array( 'site_name', 'published_posts' ),
			),
			'execute_callback'    => 'site_tools_site_summary_execute',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'wp_abilities_api_init', 'site_tools_site_summary_register_ability' );

/**
 * Execute callback for the `site-tools/site-summary` ability.
 *
 * Returns a compact array with the current site name and the number of
 * published posts. Kept intentionally side-effect free so it is safe to call
 * from any automation context.
 *
 * @param array $input Input arguments (none expected).
 * @return array{site_name:string, published_posts:int}
 */
function site_tools_site_summary_execute( $input = array() ) {
	unset( $input );

	$site_name = (string) get_bloginfo( 'name' );

	$counts          = wp_count_posts( 'post' );
	$published_posts = 0;
	if ( is_object( $counts ) && isset( $counts->publish ) ) {
		$published_posts = (int) $counts->publish;
	}

	return array(
		'site_name'       => $site_name,
		'published_posts' => $published_posts,
	);
}
