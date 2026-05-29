<?php
/**
 * Plugin Name:       Site Tools – Site Summary
 * Description:       Registers a `site-tools/site-summary` ability via the WordPress Abilities API that returns a compact site summary (site name + published post count).
 * Version:           1.0.0
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Author:            Site Tools
 * License:           GPL-2.0-or-later
 * Text Domain:       site-tools-summary
 *
 * @package SiteTools\Summary
 */

declare( strict_types=1 );

namespace SiteTools\Summary;

// Prevent direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the `site-tools` ability category.
 *
 * Fires on `wp_abilities_api_categories_init` so the category exists before
 * any abilities try to attach to it.
 *
 * @param mixed $registry Ability category registry passed by the action.
 * @return void
 */
function register_category( $registry = null ): void {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		'site-tools',
		array(
			'label'       => __( 'Site Tools', 'site-tools-summary' ),
			'description' => __( 'Utility abilities for inspecting and managing the current site.', 'site-tools-summary' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', __NAMESPACE__ . '\\register_category' );

/**
 * Register the `site-tools/site-summary` ability.
 *
 * Fires on `wp_abilities_api_init` so WordPress is fully loaded and the
 * Abilities API registry is available.
 *
 * @return void
 */
function register_ability(): void {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-summary' ),
			'description'         => __( 'Returns a compact summary of the current site including the site name and number of published posts.', 'site-tools-summary' ),
			'category'            => 'site-tools',
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => new \stdClass(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'site_name'        => array(
						'type'        => 'string',
						'description' => __( 'The current site name (blogname option).', 'site-tools-summary' ),
					),
					'published_posts'  => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Number of posts in the `post` post type with status `publish`.', 'site-tools-summary' ),
					),
				),
				'required'   => array( 'site_name', 'published_posts' ),
			),
			'execute_callback'    => __NAMESPACE__ . '\\execute',
			'permission_callback' => __NAMESPACE__ . '\\can_execute',
		)
	);
}
add_action( 'wp_abilities_api_init', __NAMESPACE__ . '\\register_ability' );

/**
 * Permission callback for the ability.
 *
 * The summary only exposes information that is already public (site name and
 * the count of *published* posts), so the ability is safe to call without a
 * specific capability. We still expose a filter for site owners to tighten it.
 *
 * @return bool|\WP_Error True when the caller may execute the ability.
 */
function can_execute() {
	/**
	 * Filter whether the current caller may execute `site-tools/site-summary`.
	 *
	 * @param bool $allowed Whether the call is allowed. Default true.
	 */
	return (bool) apply_filters( 'site_tools_summary_can_execute', true );
}

/**
 * Execute callback for the ability.
 *
 * @param array<string,mixed> $input Input arguments (unused).
 * @return array{site_name:string,published_posts:int}
 */
function execute( array $input = array() ): array {
	unset( $input ); // No input is consumed.

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
