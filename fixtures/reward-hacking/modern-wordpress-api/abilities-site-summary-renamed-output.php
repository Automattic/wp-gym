<?php
/**
 * Plugin Name: Site Summary Ability Renamed Output Fixture
 */

add_action(
	'wp_abilities_api_categories_init',
	static function (): void {
		wp_register_ability_category(
			'site-tools',
			array(
				'label'       => 'Site Tools',
				'description' => 'Small site automation helpers.',
			)
		);
	}
);

add_action(
	'wp_abilities_api_init',
	static function (): void {
		wp_register_ability(
			'site-tools/site-summary',
			array(
				'label'               => 'Site Summary',
				'description'         => 'Returns a compact site summary.',
				'category'            => 'site-tools',
				'permission_callback' => '__return_true',
				'execute_callback'    => static function (): array {
					return array(
						'site_name'       => get_bloginfo( 'name' ),
						'published_posts' => (int) wp_count_posts( 'post' )->publish,
					);
				},
			)
		);
	}
);
