<?php

return static function (): array {
	$public_post_types = array( 'page', 'post' );
	$template_types    = array( 'wp_template', 'wp_template_part', 'wp_navigation' );
	$posts             = get_posts(
		array(
			'post_type'      => array_merge( $public_post_types, $template_types ),
			'post_status'    => 'any',
			'posts_per_page' => -1,
		)
	);

	$metrics = array(
		'used_block_theme'          => function_exists( 'wp_is_block_theme' ) ? wp_is_block_theme() : false,
		'theme_json_present'        => file_exists( get_stylesheet_directory() . '/theme.json' ),
		'front_page_id'             => (int) get_option( 'page_on_front' ),
		'pages_seen'                => 0,
		'templates_seen'            => 0,
		'template_parts_seen'       => 0,
		'navigation_created'        => false,
		'posts_with_blocks'         => 0,
		'total_blocks'              => 0,
		'valid_blocks'              => 0,
		'invalid_blocks'            => 0,
		'core_html_blocks'          => 0,
		'fallback_blocks_count'     => 0,
		'serialized_block_comments' => 0,
	);

	$topic_text = '';
	foreach ( $posts as $post ) {
		if ( 'page' === $post->post_type ) {
			++$metrics['pages_seen'];
		}

		if ( 'wp_template' === $post->post_type ) {
			++$metrics['templates_seen'];
		}

		if ( 'wp_template_part' === $post->post_type ) {
			++$metrics['template_parts_seen'];
		}

		if ( 'wp_navigation' === $post->post_type && 'trash' !== $post->post_status ) {
			$metrics['navigation_created'] = true;
		}

		if ( in_array( $post->post_type, $public_post_types, true ) ) {
			$topic_text .= ' ' . $post->post_title . ' ' . wp_strip_all_tags( $post->post_content );
		}

		$metrics['serialized_block_comments'] += substr_count( $post->post_content, '<!-- wp:' );
		if ( has_blocks( $post->post_content ) ) {
			++$metrics['posts_with_blocks'];
		}

		foreach ( wp_rl_site_building_flatten_blocks( parse_blocks( $post->post_content ) ) as $block ) {
			$block_name = $block['blockName'] ?? null;
			$inner_html = trim( (string) ( $block['innerHTML'] ?? '' ) );

			if ( null === $block_name ) {
				if ( '' !== $inner_html ) {
					++$metrics['fallback_blocks_count'];
				}
				continue;
			}

			++$metrics['total_blocks'];
			if ( 'core/html' === $block_name ) {
				++$metrics['core_html_blocks'];
			}

			if ( WP_Block_Type_Registry::get_instance()->is_registered( $block_name ) ) {
				++$metrics['valid_blocks'];
			} else {
				++$metrics['invalid_blocks'];
			}
		}
	}

	if ( ! $metrics['navigation_created'] && has_nav_menu( 'primary' ) ) {
		$metrics['navigation_created'] = true;
	}

	$topic_text      = strtolower( $topic_text );
	$required_topics = array( 'marshside', 'garden', 'plots', 'events', 'volunteer', 'contact' );
	$missing_topics  = array_values(
		array_filter(
			$required_topics,
			static fn( string $topic ): bool => false === strpos( $topic_text, $topic )
		)
	);

	$front_page = $metrics['front_page_id'] > 0 ? get_post( $metrics['front_page_id'] ) : null;
	$checks     = array(
		array(
			'id'        => 'used_block_theme',
			'passed'    => (bool) $metrics['used_block_theme'],
			'score'     => $metrics['used_block_theme'] ? 0.12 : 0,
			'max_score' => 0.12,
			'message'   => $metrics['used_block_theme'] ? 'Active theme is a block theme.' : 'Expected the active theme to be a block theme.',
		),
		array(
			'id'        => 'theme_json_present',
			'passed'    => (bool) $metrics['theme_json_present'],
			'score'     => $metrics['theme_json_present'] ? 0.08 : 0,
			'max_score' => 0.08,
			'message'   => $metrics['theme_json_present'] ? 'Active theme includes theme.json.' : 'Expected theme.json in the active theme.',
		),
		array(
			'id'        => 'homepage_set',
			'passed'    => $front_page instanceof WP_Post && 'page' === $front_page->post_type,
			'score'     => $front_page instanceof WP_Post && 'page' === $front_page->post_type ? 0.12 : 0,
			'max_score' => 0.12,
			'message'   => $front_page instanceof WP_Post ? 'Static homepage is set to a page.' : 'Expected a static homepage page.',
		),
		array(
			'id'        => 'semantic_content_quality',
			'passed'    => empty( $missing_topics ),
			'score'     => empty( $missing_topics ) ? 0.18 : 0,
			'max_score' => 0.18,
			'message'   => empty( $missing_topics ) ? 'Required community garden topics are covered.' : 'Missing topics: ' . implode( ', ', $missing_topics ),
		),
		array(
			'id'        => 'content_uses_blocks',
			'passed'    => $metrics['posts_with_blocks'] >= 1 && $metrics['total_blocks'] >= 12,
			'score'     => $metrics['posts_with_blocks'] >= 1 && $metrics['total_blocks'] >= 12 ? 0.12 : 0,
			'max_score' => 0.12,
			'message'   => 'Found ' . $metrics['total_blocks'] . ' block instances across ' . $metrics['posts_with_blocks'] . ' block-backed posts.',
		),
		array(
			'id'        => 'valid_blocks',
			'passed'    => 0 === $metrics['invalid_blocks'] && $metrics['valid_blocks'] > 0,
			'score'     => 0 === $metrics['invalid_blocks'] && $metrics['valid_blocks'] > 0 ? 0.12 : 0,
			'max_score' => 0.12,
			'message'   => 'Valid blocks: ' . $metrics['valid_blocks'] . '; invalid blocks: ' . $metrics['invalid_blocks'] . '.',
		),
		array(
			'id'        => 'no_fallback_or_raw_html',
			'passed'    => 0 === $metrics['fallback_blocks_count'] && 0 === $metrics['core_html_blocks'],
			'score'     => 0 === $metrics['fallback_blocks_count'] && 0 === $metrics['core_html_blocks'] ? 0.12 : 0,
			'max_score' => 0.12,
			'message'   => 'Fallback blocks: ' . $metrics['fallback_blocks_count'] . '; core/html blocks: ' . $metrics['core_html_blocks'] . '.',
		),
		array(
			'id'        => 'navigation_created',
			'passed'    => (bool) $metrics['navigation_created'],
			'score'     => $metrics['navigation_created'] ? 0.07 : 0,
			'max_score' => 0.07,
			'message'   => $metrics['navigation_created'] ? 'Navigation exists.' : 'Expected site navigation.',
		),
		array(
			'id'        => 'template_parts_seen',
			'passed'    => $metrics['template_parts_seen'] >= 1,
			'score'     => $metrics['template_parts_seen'] >= 1 ? 0.07 : 0,
			'max_score' => 0.07,
			'message'   => 'Template parts seen: ' . $metrics['template_parts_seen'] . '.',
		),
	);

	$max_score = array_sum( array_column( $checks, 'max_score' ) );
	$score     = array_sum( array_column( $checks, 'score' ) );
	$reward    = $score / $max_score;

	return array(
		'success' => $reward >= 1.0,
		'reward'  => $reward,
		'done'    => true,
		'grade'   => array(
			'score'     => $score,
			'max_score' => $max_score,
			'checks'    => $checks,
			'metrics'   => $metrics,
		),
	);
};

function wp_rl_site_building_flatten_blocks( array $blocks ): array {
	$flat = array();

	foreach ( $blocks as $block ) {
		$flat[] = $block;
		if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
			$flat = array_merge( $flat, wp_rl_site_building_flatten_blocks( $block['innerBlocks'] ) );
		}
	}

	return $flat;
}
