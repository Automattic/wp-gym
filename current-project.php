<?php
/**
 * Plugin Name: Site Tools Summary Ability
 * Description: Registers a small automation ability that returns the site name and published post count.
 * Version: 1.0.0
 * Author: WP Gym
 * License: GPL-2.0-or-later
 * Text Domain: site-tools-summary-ability
 *
 * @package SiteToolsSummaryAbility
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the Site Tools ability category when the Abilities API is available.
 */
function site_tools_summary_register_ability_category(): void {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		'site-tools',
		array(
			'label'       => __( 'Site Tools', 'site-tools-summary-ability' ),
			'description' => __( 'Small utilities for reading basic site information.', 'site-tools-summary-ability' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'site_tools_summary_register_ability_category' );

/**
 * Build the compact site summary returned by the automation ability.
 *
 * @return array{site_name:string,post_count:int} Site summary data.
 */
function site_tools_summary_get_summary(): array {
	$post_counts = wp_count_posts( 'post' );

	return array(
		'site_name'  => get_bloginfo( 'name' ),
		'post_count' => isset( $post_counts->publish ) ? (int) $post_counts->publish : 0,
	);
}

/**
 * Register the callable site summary ability when the Abilities API is available.
 */
function site_tools_summary_register_ability(): void {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-tools-summary-ability' ),
			'description'         => __( 'Returns the current site name and number of published posts.', 'site-tools-summary-ability' ),
			'category'            => 'site-tools',
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => array(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'       => 'object',
				'required'   => array( 'site_name', 'post_count' ),
				'properties' => array(
					'site_name'  => array(
						'type'        => 'string',
						'description' => __( 'The current site name.', 'site-tools-summary-ability' ),
					),
					'post_count' => array(
						'type'        => 'integer',
						'description' => __( 'The number of published posts.', 'site-tools-summary-ability' ),
					),
				),
			),
			'permission_callback' => '__return_true',
			'execute_callback'    => 'site_tools_summary_get_summary',
		)
	);
}
add_action( 'wp_abilities_api_init', 'site_tools_summary_register_ability' );
