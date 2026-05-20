<?php

require_once __DIR__ . '/grader-common.php';

return function (): array {
	$checks = array( wp_gym_modern_api_workspace_policy_check() );

	$plugin_source                = wp_gym_modern_api_submitted_source( array( 'site-tools/site-summary', 'wp_register_ability' ) );
	$uses_category_lifecycle      = str_contains( $plugin_source, 'wp_abilities_api_categories_init' );
	$uses_ability_lifecycle       = str_contains( $plugin_source, 'wp_abilities_api_init' );
	$uses_unprefixed_lifecycle    = (bool) preg_match( "/add_action\s*\(\s*['\"]abilities_api_init['\"]/", $plugin_source );
	$uses_init_for_ability_source = str_contains( $plugin_source, 'wp_register_ability' )
		&& (bool) preg_match( "/add_action\s*\(\s*['\"]init['\"]/", $plugin_source );
	$uses_function_exists_guard   = str_contains( $plugin_source, "function_exists( 'wp_register_ability'" )
		|| str_contains( $plugin_source, 'function_exists( "wp_register_ability"' );

	$api_available = function_exists( 'wp_get_ability' ) && function_exists( 'wp_register_ability' );
	$checks[]      = array(
		'id'        => 'abilities_api_available',
		'passed'    => $api_available,
		'score'     => $api_available ? 0.08 : 0,
		'max_score' => 0.08,
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
	$ability            = $api_available ? wp_get_ability( 'site-tools/site-summary' ) : null;
	$ability_registered = (bool) $ability;

	$lifecycle_hooks_ok = $uses_category_lifecycle && $uses_ability_lifecycle && ! $uses_unprefixed_lifecycle && ! $uses_init_for_ability_source;
	$lifecycle_message  = 'Expected category registration on wp_abilities_api_categories_init and ability registration on wp_abilities_api_init.';
	if ( $lifecycle_hooks_ok ) {
		$lifecycle_message = 'Ability registration is available on the Abilities API lifecycle.';
	} elseif ( $uses_unprefixed_lifecycle ) {
		$lifecycle_message = 'Found add_action( abilities_api_init ); use wp_abilities_api_init for ability registration.';
	} elseif ( $uses_init_for_ability_source ) {
		$lifecycle_message = 'Found ability registration tied to init; use wp_abilities_api_categories_init for categories and wp_abilities_api_init for abilities.';
	} elseif ( $uses_function_exists_guard ) {
		$lifecycle_message = 'Found a wp_register_ability function_exists guard, but the ability was not registered on the Abilities API lifecycle.';
	}
	$checks[] = array(
		'id'        => 'abilities_api_lifecycle',
		'passed'    => $lifecycle_hooks_ok,
		'score'     => $lifecycle_hooks_ok ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $lifecycle_message,
	);

	$checks[]            = array(
		'id'        => 'category_registered',
		'passed'    => $category_registered,
		'score'     => $category_registered ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $category_registered ? 'Category site-tools is registered.' : 'Expected wp_register_ability_category( site-tools, ... ) during wp_abilities_api_categories_init.',
	);

	$checks[]           = array(
		'id'        => 'ability_registered',
		'passed'    => $ability_registered,
		'score'     => $ability_registered ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $ability_registered ? 'Ability site-tools/site-summary is registered.' : 'Expected wp_register_ability( site-tools/site-summary, ... ) during wp_abilities_api_init.',
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
		'score'     => $site_name_matches ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $site_name_matches ? 'Ability returned the current site name.' : 'Expected output key site_name to match get_bloginfo( name ); key name is not accepted.',
	);

	$expected_post_count = (int) ( wp_count_posts( 'post' )->publish ?? 0 );
	$post_count_matches  = is_array( $result )
		&& isset( $result['post_count'] )
		&& (int) $result['post_count'] === $expected_post_count;
	$checks[]            = array(
		'id'        => 'post_count_matches',
		'passed'    => $post_count_matches,
		'score'     => $post_count_matches ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $post_count_matches ? 'Ability returned the published post count.' : 'Expected output key post_count to match wp_count_posts( post )->publish; key published_posts is not accepted.',
	);

	$result_keys        = is_array( $result ) ? array_keys( $result ) : array();
	$expected_keys      = array( 'post_count', 'site_name' );
	sort( $result_keys );
	$exact_output_shape = $expected_keys === $result_keys;
	$checks[]           = array(
		'id'        => 'exact_output_shape',
		'passed'    => $exact_output_shape,
		'score'     => $exact_output_shape ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $exact_output_shape ? 'Ability returned exactly site_name and post_count.' : 'Expected ability output to contain exactly site_name and post_count, with no renamed or extra fields.',
	);

	$checks[] = wp_gym_modern_api_plugin_author_supported_check(
		array( 'site-tools/site-summary', 'wp_register_ability' )
	);

	$checks[] = wp_gym_check_no_speculative_plugin_packaging_metadata();

	return wp_gym_modern_api_grade( $checks );
};
