<?php
/**
 * Plugin Name:       Site Tools – Site Summary
 * Description:       Exposes a callable "site-tools/site-summary" ability via the WordPress Abilities API. Returns a compact summary (site name and published post count) for automation tools.
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

declare( strict_types=1 );

defined( 'ABSPATH' ) || exit;

/**
 * Register the "site-tools" ability category so the site-summary ability has a
 * discoverable grouping under which it can be listed by automation clients.
 *
 * The Abilities API fires `wp_abilities_api_categories_init` once it is ready
 * to accept category registrations. Registering here keeps the plugin
 * self-contained and avoids racing against core initialization.
 *
 * @return void
 */
function site_tools_site_summary_register_category(): void {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		'site-tools',
		array(
			'label'       => __( 'Site Tools', 'site-tools-site-summary' ),
			'description' => __( 'Utility abilities that report on or operate against the current WordPress site.', 'site-tools-site-summary' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'site_tools_site_summary_register_category' );

/**
 * Register the "site-tools/site-summary" ability.
 *
 * The ability has no required input and returns a compact object containing
 * the current site name and the number of published posts. It is safe to call
 * on any WordPress install — both lookups use the standard public APIs.
 *
 * @return void
 */
function site_tools_site_summary_register_ability(): void {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-site-summary' ),
			'description'         => __( 'Returns a compact summary of the current site, including its name and the number of published posts.', 'site-tools-site-summary' ),
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
						'description' => __( 'The site name (blogname option).', 'site-tools-site-summary' ),
					),
					'published_posts' => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Number of posts in the "publish" status for the default "post" post type.', 'site-tools-site-summary' ),
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
 * Execute callback for the "site-tools/site-summary" ability.
 *
 * Builds a minimal, JSON-serializable array describing the site. Uses
 * `wp_count_posts()` for the published-post tally so it honors post-type
 * filters and remains accurate on fresh installs (where it returns 0).
 *
 * @param array<string, mixed> $input Ability input (unused — schema is empty).
 * @return array{site_name: string, published_posts: int}
 */
function site_tools_site_summary_execute( $input = array() ): array {
	unset( $input ); // Intentionally unused; the ability takes no input.

	$site_name = (string) get_bloginfo( 'name' );

	$counts          = wp_count_posts( 'post' );
	$published_posts = isset( $counts->publish ) ? (int) $counts->publish : 0;

	return array(
		'site_name'       => $site_name,
		'published_posts' => $published_posts,
	);
}
