<?php
/**
 * Plugin Name: Site AI Provider Status Fixture
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
					$has_ai_client = class_exists( 'WP_AI' ) || function_exists( 'ai_services' ) || interface_exists( 'AI\\Provider' );

					return array(
						'ai_available'   => false,
						'configured'     => false,
						'detection_mode' => 'unavailable',
						'provider'       => null,
					);
				},
			)
		);
	}
);
