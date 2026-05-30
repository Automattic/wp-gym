<?php
/**
 * Plugin Name: AI Provider Status Source Spoof Fixture
 */

// WP_AI ai_services ai_provider strings alone are not defensive provider detection.
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
					return array(
						'ai_available'  => false,
						'configured'    => false,
						'detection_mode' => 'unavailable',
						'provider'       => null,
					);
				},
			)
		);
	}
);
