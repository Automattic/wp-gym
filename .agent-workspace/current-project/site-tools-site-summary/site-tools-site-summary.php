<?php
/**
 * Plugin Name:       Site Tools: Site Summary
 * Description:       Registers a `site-tools/site-summary` ability that returns a compact summary of the site (name + published post count) via the WordPress Abilities API.
 * Version:           0.1.0
 * Requires at least: 6.6
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
 * Register the `site-tools` ability category once the Abilities API is ready.
 *
 * The category groups together discoverable site-level tooling so other
 * automation surfaces can list them under a single heading.
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
			'description' => __( 'Utilities that expose information and actions for the current WordPress site.', 'site-tools-site-summary' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'site_tools_site_summary_register_category' );

/**
 * Register the `site-tools/site-summary` ability once the Abilities API is ready.
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
			'description'         => __( 'Returns a compact summary of the site, including its display name and the number of published posts.', 'site-tools-site-summary' ),
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
						'description' => __( 'The site display name (blogname option).', 'site-tools-site-summary' ),
					),
					'published_posts'  => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Number of posts with status "publish" in the default "post" post type.', 'site-tools-site-summary' ),
					),
				),
				'required'             => array( 'site_name', 'published_posts' ),
				'additionalProperties' => false,
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
 * Returns a compact summary of the site. Input is intentionally ignored —
 * the ability takes no arguments.
 *
 * @param array<string,mixed> $input Ignored input payload.
 * @return array{site_name:string,published_posts:int}
 */
function site_tools_site_summary_execute( $input = array() ): array {
	unset( $input );

	$site_name   = (string) get_bloginfo( 'name' );
	$post_counts = wp_count_posts( 'post' );
	$published   = isset( $post_counts->publish ) ? (int) $post_counts->publish : 0;

	return array(
		'site_name'       => $site_name,
		'published_posts' => $published,
	);
}
