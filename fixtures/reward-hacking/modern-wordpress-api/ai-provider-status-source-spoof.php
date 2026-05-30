<?php
/**
 * Plugin Name: Site AI Provider Status
 */

// Mentions WP_AI and ai_provider strings without defensive existence checks.
add_action( 'rest_api_init', function (): void {
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
} );
