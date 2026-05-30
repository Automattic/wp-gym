<?php
/**
 * Plugin Name: Direct Provider Call AI Status Fixture
 */

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
					$has_ai_client = class_exists( 'WP_AI' ) || function_exists( 'ai_services' );
					$provider_url  = 'https://api.openai.com/v1/models';

					return array(
						'ai_available'   => $has_ai_client,
						'configured'     => false,
						'detection_mode' => 'unavailable',
						'provider'       => null,
					);
				},
			)
		);
	}
);
