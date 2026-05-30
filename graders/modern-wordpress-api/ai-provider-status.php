<?php

require_once __DIR__ . '/grader-common.php';

return function (): array {
	$checks = array();
	$source = wp_gym_modern_api_submitted_source( array( 'site-ai/v1/provider-status', 'WP_AI', 'ai_services', 'ai_provider' ), array( 'php' ) );

	if ( function_exists( 'rest_get_server' ) ) {
		rest_get_server();
	}

	$routes           = function_exists( 'rest_get_server' ) ? rest_get_server()->get_routes() : array();
	$route_registered = isset( $routes['/site-ai/v1/provider-status'] );
	$checks[]         = array(
		'id'        => 'route_registered',
		'passed'    => $route_registered,
		'score'     => $route_registered ? 0.14 : 0,
		'max_score' => 0.14,
		'message'   => $route_registered ? 'REST route /site-ai/v1/provider-status is registered.' : 'Expected REST route /site-ai/v1/provider-status.',
	);

	$has_permission_callback = false;
	if ( $route_registered ) {
		foreach ( $routes['/site-ai/v1/provider-status'] as $handler ) {
			if ( isset( $handler['methods']['GET'] ) && isset( $handler['permission_callback'] ) && is_callable( $handler['permission_callback'] ) ) {
				$has_permission_callback = true;
				break;
			}
		}
	}
	$checks[] = array(
		'id'        => 'permission_callback_present',
		'passed'    => $has_permission_callback,
		'score'     => $has_permission_callback ? 0.1 : 0,
		'max_score' => 0.1,
		'message'   => $has_permission_callback ? 'GET handler has an explicit permission callback.' : 'Expected a callable permission_callback on the GET handler.',
	);

	$data   = null;
	$status = 0;
	if ( class_exists( 'WP_REST_Request' ) && function_exists( 'rest_do_request' ) ) {
		$response = rest_do_request( new WP_REST_Request( 'GET', '/site-ai/v1/provider-status' ) );
		if ( $response instanceof WP_REST_Response ) {
			$status = $response->get_status();
			$data   = $response->get_data();
		}
	}

	$status_ok = 200 === $status;
	$checks[]  = array(
		'id'        => 'status_200',
		'passed'    => $status_ok,
		'score'     => $status_ok ? 0.1 : 0,
		'max_score' => 0.1,
		'message'   => $status_ok ? 'Route returned HTTP 200.' : 'Expected REST request to return HTTP 200.',
	);

	$expected_keys       = array( 'ai_available', 'configured', 'detection_mode', 'provider' );
	$result_keys         = is_array( $data ) ? array_keys( $data ) : array();
	sort( $result_keys );
	$exact_output_shape  = $expected_keys === $result_keys;
	$checks[]            = array(
		'id'        => 'exact_output_shape',
		'passed'    => $exact_output_shape,
		'score'     => $exact_output_shape ? 0.14 : 0,
		'max_score' => 0.14,
		'message'   => $exact_output_shape ? 'Response returned exactly the AI provider status keys.' : 'Expected response data to contain exactly ai_available, configured, detection_mode, and provider.',
	);

	$clean_site_fallback = is_array( $data )
		&& array_key_exists( 'ai_available', $data )
		&& array_key_exists( 'configured', $data )
		&& array_key_exists( 'detection_mode', $data )
		&& array_key_exists( 'provider', $data )
		&& false === $data['ai_available']
		&& false === $data['configured']
		&& null === $data['provider']
		&& 'unavailable' === $data['detection_mode'];
	$checks[]            = array(
		'id'        => 'ai_unavailable_fallback',
		'passed'    => $clean_site_fallback,
		'score'     => $clean_site_fallback ? 0.18 : 0,
		'max_score' => 0.18,
		'message'   => $clean_site_fallback ? 'Clean-site fallback reports no AI provider without fatal errors.' : 'Expected unavailable fallback on a clean WordPress site with no AI provider plugin.',
	);

	$uses_wordpress_ai_detection = '' !== $source && preg_match( '/\b(?:class_exists|function_exists|interface_exists)\s*\(/', $source )
		&& preg_match( '/(?:WP_AI|ai_services|ai_provider|AI\\\\|Ai_)/i', $source );
	$checks[]                    = array(
		'id'        => 'wordpress_ai_detection',
		'passed'    => (bool) $uses_wordpress_ai_detection,
		'score'     => $uses_wordpress_ai_detection ? 0.14 : 0,
		'max_score' => 0.14,
		'message'   => $uses_wordpress_ai_detection ? 'Submitted source checks for WordPress AI Client/provider surfaces defensively.' : 'Expected defensive detection of WordPress AI Client or provider APIs.',
	);

	$avoids_direct_external_provider = '' === $source || ! preg_match( '/(?:api\.openai\.com|api\.anthropic\.com|curl_exec\s*\(|wp_remote_post\s*\(|Authorization:\s*Bearer)/i', $source );
	$checks[]                       = array(
		'id'        => 'no_direct_external_ai_calls',
		'passed'    => $avoids_direct_external_provider,
		'score'     => $avoids_direct_external_provider ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $avoids_direct_external_provider ? 'No direct external model-provider calls detected.' : 'Expected provider status detection without direct external API calls or bearer-token plumbing.',
	);

	$checks[] = wp_gym_modern_api_plugin_author_supported_check(
		array( '/site-ai/v1/provider-status', 'site-ai/v1/provider-status' ),
		null,
		0.09
	);

	$checks[] = wp_gym_check_no_speculative_plugin_packaging_metadata( array( 'max_score' => 0.09 ) );

	return wp_gym_modern_api_grade( $checks );
};
