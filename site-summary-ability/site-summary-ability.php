<?php
/**
 * Plugin Name:       Site Summary Ability
 * Description:       Registers a callable site-tools/site-summary ability that returns a compact summary with the current site name and published post count.
 * Version:           0.1.0
 * Requires at least: 6.6
 * Requires PHP:      7.4
 * Author:            wp-gym
 * License:           GPL-2.0-or-later
 * Text Domain:       site-summary-ability
 *
 * Self-contained plugin: safe to activate on a fresh WordPress site. If the
 * Abilities API is unavailable the plugin simply does nothing.
 *
 * @package SiteSummaryAbility
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the "site-tools" ability category once the Abilities API is ready.
 */
function site_summary_ability_register_category() {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	// Avoid duplicate registration if the category already exists.
	if ( function_exists( 'wp_get_ability_category' ) && wp_get_ability_category( 'site-tools' ) ) {
		return;
	}

	wp_register_ability_category(
		'site-tools',
		array(
			'label'       => __( 'Site Tools', 'site-summary-ability' ),
			'description' => __( 'Utility abilities that report on the current WordPress site.', 'site-summary-ability' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'site_summary_ability_register_category' );

/**
 * Register the site-tools/site-summary ability.
 */
function site_summary_ability_register_ability() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	if ( function_exists( 'wp_get_ability' ) && wp_get_ability( 'site-tools/site-summary' ) ) {
		return;
	}

	wp_register_ability(
		'site-tools/site-summary',
		array(
			'label'               => __( 'Site Summary', 'site-summary-ability' ),
			'description'         => __( 'Returns a compact summary with the current site name and published post count.', 'site-summary-ability' ),
			'category'            => 'site-tools',
			'input_schema'        => array(
				'type'                 => 'object',
				'properties'           => new stdClass(),
				'additionalProperties' => false,
			),
			'output_schema'       => array(
				'type'       => 'object',
				'properties' => array(
					'site_name'  => array(
						'type'        => 'string',
						'description' => __( 'The current site name.', 'site-summary-ability' ),
					),
					'post_count' => array(
						'type'        => 'integer',
						'description' => __( 'Number of published posts.', 'site-summary-ability' ),
						'minimum'     => 0,
					),
				),
				'required'   => array( 'site_name', 'post_count' ),
			),
			'execute_callback'    => 'site_summary_ability_execute',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'wp_abilities_api_init', 'site_summary_ability_register_ability' );

/**
 * Execute callback for the site-tools/site-summary ability.
 *
 * @param array $input Ignored input arguments.
 * @return array{site_name:string,post_count:int}
 */
function site_summary_ability_execute( $input = array() ) {
	unset( $input );

	$counts        = wp_count_posts( 'post' );
	$published     = isset( $counts->publish ) ? (int) $counts->publish : 0;

	return array(
		'site_name'  => (string) get_bloginfo( 'name' ),
		'post_count' => $published,
	);
}
