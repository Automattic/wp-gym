<?php

require_once __DIR__ . '/../block-markup/grader-common.php';

return static function (): array {
	$posts = get_posts(
		array(
			'post_type'      => array( 'page', 'post', 'wp_template_part', 'wp_navigation' ),
			'post_status'    => 'any',
			'posts_per_page' => -1,
		)
	);

	$content             = '';
	$blocks              = array();
	$pages_seen          = 0;
	$homepage_id         = (int) get_option( 'page_on_front' );
	$navigation_created  = has_nav_menu( 'primary' );
	$template_parts_seen = 0;

	foreach ( $posts as $post ) {
		if ( 'page' === $post->post_type ) {
			++$pages_seen;
		}

		if ( 'wp_template_part' === $post->post_type ) {
			++$template_parts_seen;
		}

		if ( 'wp_navigation' === $post->post_type && 'trash' !== $post->post_status ) {
			$navigation_created = true;
		}

		if ( in_array( $post->post_type, array( 'page', 'post' ), true ) ) {
			$content .= ' ' . $post->post_title . ' ' . wp_strip_all_tags( $post->post_content );
		}

		$blocks = array_merge( $blocks, parse_blocks( $post->post_content ) );
	}

	$flat_blocks       = wp_gym_flatten_blocks( $blocks );
	$block_names       = wp_gym_block_names( $blocks );
	$invalid_blocks    = array_values(
		array_filter(
			$block_names,
			static fn( string $name ): bool => ! WP_Block_Type_Registry::get_instance()->is_registered( $name )
		)
	);
	$core_html_blocks  = count( array_filter( $block_names, static fn( string $name ): bool => 'core/html' === $name ) );
	$shortcodes        = wp_gym_shortcode_matches( $content );
	$fallback_blocks   = count(
		array_filter(
			$flat_blocks,
			static fn( array $block ): bool => null === ( $block['blockName'] ?? null ) && '' !== trim( (string) ( $block['innerHTML'] ?? '' ) )
		)
	);
	$required_topics   = array( 'marshside', 'garden', 'plots', 'events', 'volunteer', 'contact' );
	$lowercase_content = strtolower( $content );
	$missing_topics    = array_values(
		array_filter(
			$required_topics,
			static fn( string $topic ): bool => false === strpos( $lowercase_content, $topic )
		)
	);

	$checks = array(
		array(
			'id'        => 'used_block_theme',
			'passed'    => function_exists( 'wp_is_block_theme' ) && wp_is_block_theme(),
			'score'     => function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() ? 0.12 : 0,
			'max_score' => 0.12,
			'message'   => 'Active theme should be a block theme.',
		),
		array(
			'id'        => 'theme_json_present',
			'passed'    => file_exists( get_stylesheet_directory() . '/theme.json' ),
			'score'     => file_exists( get_stylesheet_directory() . '/theme.json' ) ? 0.08 : 0,
			'max_score' => 0.08,
			'message'   => 'Active theme should include theme.json.',
		),
		array(
			'id'        => 'homepage_set',
			'passed'    => $homepage_id > 0 && get_post( $homepage_id ) instanceof WP_Post,
			'score'     => $homepage_id > 0 && get_post( $homepage_id ) instanceof WP_Post ? 0.12 : 0,
			'max_score' => 0.12,
			'message'   => 'A static homepage should be set.',
		),
		array(
			'id'        => 'required_pages_or_sections',
			'passed'    => $pages_seen >= 1 && empty( $missing_topics ),
			'score'     => $pages_seen >= 1 && empty( $missing_topics ) ? 0.18 : 0,
			'max_score' => 0.18,
			'message'   => empty( $missing_topics ) ? 'Required community garden content is present.' : 'Missing topics: ' . implode( ', ', $missing_topics ),
		),
		array(
			'id'        => 'valid_blocks',
			'passed'    => ! empty( $block_names ) && empty( $invalid_blocks ),
			'score'     => ! empty( $block_names ) && empty( $invalid_blocks ) ? 0.15 : 0,
			'max_score' => 0.15,
			'message'   => 'Expected registered WordPress blocks only.',
		),
		array(
			'id'        => 'no_fallback_or_raw_html',
			'passed'    => 0 === $fallback_blocks && 0 === $core_html_blocks && empty( $shortcodes ),
			'score'     => 0 === $fallback_blocks && 0 === $core_html_blocks && empty( $shortcodes ) ? 0.15 : 0,
			'max_score' => 0.15,
			'message'   => 'Fallback blocks: ' . $fallback_blocks . '; core/html blocks: ' . $core_html_blocks . '; shortcodes: ' . count( $shortcodes ) . '.',
		),
		array(
			'id'        => 'navigation_created',
			'passed'    => $navigation_created,
			'score'     => $navigation_created ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Site navigation should exist.',
		),
		array(
			'id'        => 'template_parts_seen',
			'passed'    => $template_parts_seen >= 1,
			'score'     => $template_parts_seen >= 1 ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Expected at least one template part where available.',
		),
	);

	return wp_gym_grade( $checks );
};
