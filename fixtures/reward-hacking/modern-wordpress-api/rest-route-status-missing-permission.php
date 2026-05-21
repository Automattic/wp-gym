<?php
/**
 * Plugin Name: Site Status Missing Permission Fixture
 */

add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'site-tools/v1',
			'/status',
			array(
				'methods'  => 'GET',
				'callback' => static function (): array {
					return array(
						'ok'         => true,
						'site_name'  => get_bloginfo( 'name' ),
						'post_count' => (int) wp_count_posts( 'post' )->publish,
					);
				},
			)
		);
	}
);
