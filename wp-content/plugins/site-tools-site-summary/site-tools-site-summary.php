<?php
/**
 * Plugin Name:       Site Tools – Site Summary
 * Plugin URI:        https://example.com/site-tools-site-summary
 * Description:       Registers a "site-tools/site-summary" ability via the WordPress Abilities API that returns a compact summary (site name + published post count) for automation tools to discover and execute.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            Site Tools
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       site-tools-site-summary
 *
 * @package SiteTools\SiteSummary
 */

declare( strict_types = 1 );

namespace SiteTools\SiteSummary;

// Prevent direct access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Ability category slug used to group all site-tools abilities.
 */
const CATEGORY_SLUG = 'site-tools';

/**
 * Fully-qualified ability name (namespace/ability) registered with the API.
 */
const ABILITY_NAME = 'site-tools/site-summary';

/**
 * Register the "site-tools" ability category.
 *
 * The Abilities API fires `wp_abilities_api_categories_init` once it is ready
 * to accept category registrations. Registering here (rather than at plugin
 * load) guarantees the API is present and avoids fatal errors on sites where
 * the Abilities API plugin/feature is not yet available.
 *
 * @return void
 */
function register_category(): void {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		CATEGORY_SLUG,
		array(
			'label'       => __( 'Site Tools', 'site-tools-site-summary' ),
			'description' => __( 'Utility abilities for inspecting and automating WordPress sites.', 'site-tools-site-summary' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', __NAMESPACE__ . '\\register_category' );

/**
 * Register the "site-tools/site-summary" ability.
 *
 * Runs on `wp_abilities_api_init` so the API is fully bootstrapped and the
 * `site-tools` category has already been registered.
 *
 * @return void
 */
function register_ability(): void {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		ABILITY_NAME,
		array(
			'label'               => __( 'Site Summary', 'site-tools-site-summary' ),
			'description'         => __( 'Returns a compact summary of the current site, including the site name and the number of published posts.', 'site-tools-site-summary' ),
			'category'            => CATEGORY_SLUG,
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => new \stdClass(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'                 => 'object',
				'required'             => array( 'site_name', 'published_posts' ),
				'additionalProperties' => false,
				'properties'           => array(
					'site_name'       => array(
						'type'        => 'string',
						'description' => __( 'The current site name (blogname option).', 'site-tools-site-summary' ),
					),
					'published_posts' => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Number of posts with status "publish".', 'site-tools-site-summary' ),
					),
				),
			),
			'execute_callback'    => __NAMESPACE__ . '\\execute_site_summary',
			'permission_callback' => __NAMESPACE__ . '\\can_view_site_summary',
		)
	);
}
add_action( 'wp_abilities_api_init', __NAMESPACE__ . '\\register_ability' );

/**
 * Permission callback for the site summary ability.
 *
 * The summary only exposes the public site name and the published post count,
 * both of which are visible to anonymous front-end visitors, so the ability is
 * safe to allow for any caller. Automation tools that need stricter gating can
 * filter this via standard WordPress capability checks.
 *
 * @return bool True when the ability may be executed.
 */
function can_view_site_summary(): bool {
	return true;
}

/**
 * Execute callback: build the compact site summary.
 *
 * @param array<string,mixed> $input Validated input (no fields are required).
 * @return array{site_name:string,published_posts:int} Compact summary payload.
 */
function execute_site_summary( $input = array() ): array {
	unset( $input ); // No inputs are accepted; keep signature for the API.

	$site_name = (string) get_bloginfo( 'name' );

	$counts          = wp_count_posts( 'post' );
	$published_posts = isset( $counts->publish ) ? (int) $counts->publish : 0;

	return array(
		'site_name'       => $site_name,
		'published_posts' => $published_posts,
	);
}
