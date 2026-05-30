<?php
/**
 * Plugin Name: AI Provider Status Source String Spoof Fixture
 */

function wp_gym_fixture_spoofed_ai_source_strings(): bool {
	return class_exists( 'WP_AI' ) || function_exists( 'ai_services' ) || interface_exists( 'AI\\Provider' );
}

// Intentionally no site-ai/v1/provider-status route.
