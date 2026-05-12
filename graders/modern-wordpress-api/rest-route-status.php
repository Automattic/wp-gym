<?php

require_once __DIR__ . '/grader-common.php';

return function (): array {
	$checks = array();

	if ( function_exists( 'rest_get_server' ) ) {
		rest_get_server();
	}

	$routes           = function_exists( 'rest_get_server' ) ? rest_get_server()->get_routes() : array();
	$route_registered = isset( $routes['/site-tools/v1/status'] );
	$checks[]         = array(
		'id'        => 'route_registered',
		'passed'    => $route_registered,
		'score'     => $route_registered ? 0.2 : 0,
		'max_score' => 0.2,
		'message'   => $route_registered ? 'REST route /site-tools/v1/status is registered.' : 'Expected REST route /site-tools/v1/status.',
	);

	$has_permission_callback = false;
	if ( $route_registered ) {
		foreach ( $routes['/site-tools/v1/status'] as $handler ) {
			if ( isset( $handler['methods']['GET'] ) && isset( $handler['permission_callback'] ) && is_callable( $handler['permission_callback'] ) ) {
				$has_permission_callback = true;
				break;
			}
		}
	}
	$checks[] = array(
		'id'        => 'permission_callback_present',
		'passed'    => $has_permission_callback,
		'score'     => $has_permission_callback ? 0.15 : 0,
		'max_score' => 0.15,
		'message'   => $has_permission_callback ? 'GET handler has an explicit permission callback.' : 'Expected a callable permission_callback on the GET handler.',
	);

	$data   = null;
	$status = 0;
	if ( class_exists( 'WP_REST_Request' ) && function_exists( 'rest_do_request' ) ) {
		$response = rest_do_request( new WP_REST_Request( 'GET', '/site-tools/v1/status' ) );
		if ( $response instanceof WP_REST_Response ) {
			$status = $response->get_status();
			$data   = $response->get_data();
		}
	}

	$status_ok = 200 === $status;
	$checks[]  = array(
		'id'        => 'status_200',
		'passed'    => $status_ok,
		'score'     => $status_ok ? 0.15 : 0,
		'max_score' => 0.15,
		'message'   => $status_ok ? 'Route returned HTTP 200.' : 'Expected REST request to return HTTP 200.',
	);

	$ok_flag  = is_array( $data ) && isset( $data['ok'] ) && true === $data['ok'];
	$checks[] = array(
		'id'        => 'ok_flag_true',
		'passed'    => $ok_flag,
		'score'     => $ok_flag ? 0.1 : 0,
		'max_score' => 0.1,
		'message'   => $ok_flag ? 'Response ok flag is true.' : 'Expected response data ok=true.',
	);

	$site_name_matches = is_array( $data )
		&& isset( $data['site_name'] )
		&& $data['site_name'] === get_bloginfo( 'name' );
	$checks[]          = array(
		'id'        => 'site_name_matches',
		'passed'    => $site_name_matches,
		'score'     => $site_name_matches ? 0.15 : 0,
		'max_score' => 0.15,
		'message'   => $site_name_matches ? 'Response returned the current site name.' : 'Expected site_name to match get_bloginfo( name ).',
	);

	$expected_post_count = (int) ( wp_count_posts( 'post' )->publish ?? 0 );
	$post_count_matches  = is_array( $data )
		&& isset( $data['post_count'] )
		&& (int) $data['post_count'] === $expected_post_count;
	$checks[]            = array(
		'id'        => 'post_count_matches',
		'passed'    => $post_count_matches,
		'score'     => $post_count_matches ? 0.15 : 0,
		'max_score' => 0.15,
		'message'   => $post_count_matches ? 'Response returned the published post count.' : 'Expected post_count to match wp_count_posts( post )->publish.',
	);

	$checks[] = wp_gym_modern_api_plugin_author_supported_check(
		array( '/site-tools/v1/status', 'site-tools/v1/status' )
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
