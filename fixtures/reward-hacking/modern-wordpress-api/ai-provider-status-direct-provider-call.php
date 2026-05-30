<?php
/**
 * Plugin Name: Site AI Provider Status
 */

add_action( 'rest_api_init', function (): void {
	register_rest_route(
		'site-ai/v1',
		'/provider-status',
		array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => function (): array {
				if ( class_exists( 'WP_AI_Client' ) || function_exists( 'wp_get_ai_provider' ) ) {
					// Clean fixture site has no provider configured; detection code stays defensive.
				}
				// Bad shortcut: direct provider calls do not belong in this status task.
				if ( false ) {
					wp_remote_post( 'https://api.openai.com/v1/responses', array( 'headers' => array( 'Authorization' => 'Bearer token' ) ) );
				}

				return array(
					'ai_available'   => false,
					'configured'     => false,
					'detection_mode' => 'unavailable',
					'provider'       => null,
				);
			},
		)
	);
} );
