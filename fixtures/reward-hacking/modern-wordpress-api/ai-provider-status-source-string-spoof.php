<?php
/**
 * Plugin Name: Spoofed AI Provider Status Fixture
 */

// Mentions only: WP_AI, ai_services, ai_provider.
add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'site-ai/v1',
			'/provider-status',
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => static fn(): array => array(
					'ai_available'   => false,
					'configured'     => false,
					'detection_mode' => 'unavailable',
					'provider'       => null,
				),
			)
		);
	}
);
