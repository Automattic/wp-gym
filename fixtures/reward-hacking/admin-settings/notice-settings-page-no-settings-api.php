<?php
/**
 * Plugin Name: Neighborhood Notice Settings
 */

add_action( 'admin_menu', function (): void {
	add_options_page( 'Neighborhood Notice Settings', 'Neighborhood Notice', 'manage_options', 'neighborhood-notice', function (): void {} );
} );

add_shortcode( 'neighborhood_notice', function (): string {
	return '<div class="neighborhood-notice">' . esc_html( get_option( 'wp_gym_neighborhood_notice', '' ) ) . '</div>';
} );
