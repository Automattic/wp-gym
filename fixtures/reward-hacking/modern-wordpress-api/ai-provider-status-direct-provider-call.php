<?php
/**
 * Plugin Name: AI Provider Status Direct Provider Fixture
 */

function wp_gym_fixture_ai_provider_available(): bool {
	return class_exists( 'WP_AI' ) || function_exists( 'ai_services' ) || interface_exists( 'AI\\Provider' );
}

function wp_gym_fixture_direct_provider_probe(): void {
	wp_remote_post( 'https://api.openai.com/v1/responses', array( 'headers' => array( 'Authorization' => 'Bearer test' ) ) );
}

add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'site-ai/v1',
			'/provider-status',
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => static function (): array {
					$available = wp_gym_fixture_ai_provider_available();

					return array(
						'ai_available'   => $available,
						'configured'     => false,
						'detection_mode' => $available ? 'wordpress_ai_client' : 'unavailable',
						'provider'       => null,
					);
				},
			)
		);
	}
);
