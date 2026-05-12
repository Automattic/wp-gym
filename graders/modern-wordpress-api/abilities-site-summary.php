<?php

require_once __DIR__ . '/grader-common.php';

return function (): array {
	$checks = array();

	$api_available = function_exists( 'wp_get_ability' ) && function_exists( 'wp_register_ability' );
	$checks[]      = array(
		'id'        => 'abilities_api_available',
		'passed'    => $api_available,
		'score'     => $api_available ? 0.18 : 0,
		'max_score' => 0.18,
		'message'   => $api_available ? 'Abilities API is available.' : 'Expected WordPress Abilities API functions to exist.',
	);

	if ( function_exists( 'did_action' ) && function_exists( 'do_action' ) ) {
		if ( ! did_action( 'wp_abilities_api_categories_init' ) ) {
			do_action( 'wp_abilities_api_categories_init' );
		}
		if ( ! did_action( 'wp_abilities_api_init' ) ) {
			do_action( 'wp_abilities_api_init' );
		}
	}

	$category_registered = function_exists( 'wp_get_ability_category' ) && (bool) wp_get_ability_category( 'site-tools' );
	$checks[]            = array(
		'id'        => 'category_registered',
		'passed'    => $category_registered,
		'score'     => $category_registered ? 0.18 : 0,
		'max_score' => 0.18,
		'message'   => $category_registered ? 'Category site-tools is registered.' : 'Expected ability category site-tools.',
	);

	$ability            = $api_available ? wp_get_ability( 'site-tools/site-summary' ) : null;
	$ability_registered = (bool) $ability;
	$checks[]           = array(
		'id'        => 'ability_registered',
		'passed'    => $ability_registered,
		'score'     => $ability_registered ? 0.18 : 0,
		'max_score' => 0.18,
		'message'   => $ability_registered ? 'Ability site-tools/site-summary is registered.' : 'Expected ability site-tools/site-summary.',
	);

	$result = null;
	if ( $ability && method_exists( $ability, 'execute' ) ) {
		$result = $ability->execute( array() );
	}

	$site_name_matches = is_array( $result )
		&& isset( $result['site_name'] )
		&& $result['site_name'] === get_bloginfo( 'name' );
	$checks[]          = array(
		'id'        => 'site_name_matches',
		'passed'    => $site_name_matches,
		'score'     => $site_name_matches ? 0.18 : 0,
		'max_score' => 0.18,
		'message'   => $site_name_matches ? 'Ability returned the current site name.' : 'Expected site_name to match get_bloginfo( name ).',
	);

	$expected_post_count = (int) ( wp_count_posts( 'post' )->publish ?? 0 );
	$post_count_matches  = is_array( $result )
		&& isset( $result['post_count'] )
		&& (int) $result['post_count'] === $expected_post_count;
	$checks[]            = array(
		'id'        => 'post_count_matches',
		'passed'    => $post_count_matches,
		'score'     => $post_count_matches ? 0.18 : 0,
		'max_score' => 0.18,
		'message'   => $post_count_matches ? 'Ability returned the published post count.' : 'Expected post_count to match wp_count_posts( post )->publish.',
	);

	$checks[] = wp_gym_modern_api_plugin_author_supported_check(
		array( 'site-tools/site-summary', 'wp_register_ability' )
	);

	$score = min( 1, round( array_sum( array_column( $checks, 'score' ) ), 6 ) );

	return array(
		'success' => $score >= 1.0,
		'reward'  => $score,
		'done'    => true,
		'grade'   => array(
			'score'     => $score,
			'max_score' => 1,
			'checks'    => $checks,
		),
	);
};
