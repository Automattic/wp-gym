<?php
/**
 * Plugin Name: AI Provider Status Fixture
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
					$has_provider_surface = class_exists( 'WP_AI\AI_Client' ) || function_exists( 'ai_services' ) || function_exists( 'ai_provider' );

					return array(
						'ai_available'  => false,
						'configured'    => false,
						'detection_mode' => $has_provider_surface ? 'unavailable' : 'unavailable',
						'provider'       => null,
					);
				},
			)
		);
	}
);
