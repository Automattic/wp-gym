<?php
/**
 * Plugin Name: Site Tools – Site Summary
 * Description: Registers a callable site summary automation action (ability) at
 *              `site-tools/site-summary` that returns a compact summary of the
 *              current WordPress site (name and published post count).
 * Version:     0.1.0
 * Author:      wp-rl task runner
 * License:     GPL-2.0-or-later
 * Requires at least: 6.4
 * Requires PHP: 7.4
 *
 * The plugin is intentionally tiny and self-contained so it is safe to activate
 * on a fresh, temporary WordPress site (e.g. a Playground instance). It plugs
 * into the WordPress Abilities API when available so automation tools can
 * discover the action under the `site-tools` grouping.
 *
 * @package SiteTools\SiteSummary
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Build a compact summary array describing the current site.
 *
 * Kept as a standalone function so it can be reused by both the Abilities API
 * registration and any other caller (tests, REST shims, etc.).
 *
 * @return array{site_name:string, published_posts:int}
 */
function site_tools_site_summary_build_summary() {
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

/**
 * Register the `site-tools/site-summary` ability with the Abilities API.
 *
 * The Abilities API hook (`abilities_api_init`) fires once the registry is
 * available. If the API is not present (older WP versions or the feature
 * plugin is not active) the registration is silently skipped so this plugin
 * remains safe to activate anywhere.
 */
function site_tools_site_summary_register_ability() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-site-summary' ),
			'description'         => __( 'Returns a compact summary of the current site, including the site name and number of published posts.', 'site-tools-site-summary' ),
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
						'description' => __( 'The current site name (blog name).', 'site-tools-site-summary' ),
					),
					'published_posts' => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Number of posts in the `publish` status.', 'site-tools-site-summary' ),
					),
				),
				'required'   => array( 'site_name', 'published_posts' ),
			),
			'execute_callback'    => 'site_tools_site_summary_build_summary',
			'permission_callback' => '__return_true',
			'meta'                => array(
				'category' => 'site-tools',
			),
		)
	);
}
add_action( 'abilities_api_init', 'site_tools_site_summary_register_ability' );
