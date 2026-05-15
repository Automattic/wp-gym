<?php

function wp_gym_find_post_by_title( string $title ): ?WP_Post {
	$posts = get_posts(
		array(
			'post_type'      => array( 'page', 'post' ),
			'post_status'    => 'any',
			'title'          => $title,
			'posts_per_page' => 1,
			'orderby'        => 'date',
			'order'          => 'DESC',
		)
	);

	foreach ( $posts as $post ) {
		if ( $post instanceof WP_Post && $post->post_title === $title ) {
			return $post;
		}
	}

	return null;
}

function wp_gym_flatten_blocks( array $blocks ): array {
	$flat = array();

	foreach ( $blocks as $block ) {
		$flat[] = $block;
		if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
			$flat = array_merge( $flat, wp_gym_flatten_blocks( $block['innerBlocks'] ) );
		}
	}

	return $flat;
}

function wp_gym_block_names( array $blocks ): array {
	return array_values(
		array_filter(
			array_map(
				static fn( $block ) => is_array( $block ) ? ( $block['blockName'] ?? null ) : null,
				wp_gym_flatten_blocks( $blocks )
			)
		)
	);
}

function wp_gym_has_fallback_block( array $blocks ): bool {
	foreach ( wp_gym_flatten_blocks( $blocks ) as $block ) {
		$block_name = $block['blockName'] ?? null;
		$inner_html = trim( (string) ( $block['innerHTML'] ?? '' ) );

		if ( null === $block_name && '' !== $inner_html ) {
			return true;
		}

		if ( 'core/html' === $block_name ) {
			return true;
		}
	}

	return false;
}

function wp_gym_shortcode_matches( string $content ): array {
	if ( '' === trim( $content ) ) {
		return array();
	}

	preg_match_all( '/\[(?!\[|\/)([A-Za-z][A-Za-z0-9_-]*)(?:\s[^\]]*)?\]/', $content, $matches );

	return array_values( array_unique( $matches[1] ?? array() ) );
}

function wp_gym_check_no_shortcodes( string $content ): array {
	$shortcodes = wp_gym_shortcode_matches( $content );

	return array(
		'id'        => 'no_shortcodes',
		'passed'    => empty( $shortcodes ),
		'score'     => empty( $shortcodes ) ? 0.1 : 0,
		'max_score' => 0.1,
		'message'   => empty( $shortcodes ) ? 'No shortcode markup detected.' : 'Detected shortcode-like markup: ' . implode( ', ', $shortcodes ),
	);
}

function wp_gym_check_required_blocks( array $blocks, array $required_blocks ): array {
	$names   = wp_gym_block_names( $blocks );
	$missing = array_values( array_diff( $required_blocks, $names ) );

	return array(
		'id'        => 'required_blocks_present',
		'passed'    => empty( $missing ),
		'score'     => empty( $missing ) ? 0.25 : 0,
		'max_score' => 0.25,
		'message'   => empty( $missing ) ? 'All required blocks are present.' : 'Missing blocks: ' . implode( ', ', $missing ),
	);
}

function wp_gym_failure_reason_for_check( array $check ): string {
	$id = (string) ( $check['id'] ?? '' );

	$reasons = array(
		'target_post_exists'                     => 'missing_target_content',
		'content_has_blocks'                     => 'missing_block_markup',
		'required_blocks_present'                => 'missing_required_blocks',
		'three_pricing_columns'                  => 'layout_structure_mismatch',
		'buttons_for_plans'                      => 'missing_required_cta',
		'plan_columns_have_meaningful_content' => 'missing_required_plan_content',
		'expected_group_columns_nesting'         => 'layout_structure_mismatch',
		'no_fallback_or_html_blocks'             => 'raw_html_or_fallback_block',
		'no_fallback_or_raw_html'                => 'raw_html_or_fallback_block',
		'no_shortcodes'                          => 'shortcode_markup',
		'expected_heading_text'                  => 'missing_required_text',
		'used_block_theme'                       => 'missing_block_theme',
		'theme_json_present'                     => 'missing_theme_json',
		'homepage_set'                           => 'homepage_not_set',
		'required_pages_or_sections'             => 'missing_required_content',
		'valid_blocks'                           => 'invalid_block',
		'navigation_created'                     => 'missing_navigation',
		'template_parts_seen'                    => 'missing_template_part',
	);

	return $reasons[ $id ] ?? $id;
}

function wp_gym_normalize_checks( array $checks ): array {
	foreach ( $checks as &$check ) {
		if ( ! is_array( $check ) || ! empty( $check['passed'] ) || ! empty( $check['failure_reason'] ) ) {
			continue;
		}

		$check['failure_reason'] = wp_gym_failure_reason_for_check( $check );
	}
	unset( $check );

	return $checks;
}

function wp_gym_failure_reasons( array $checks ): array {
	$reasons = array();

	foreach ( $checks as $check ) {
		if ( ! is_array( $check ) || ! empty( $check['passed'] ) || empty( $check['failure_reason'] ) ) {
			continue;
		}

		$reasons[] = (string) $check['failure_reason'];
	}

	return array_values( array_unique( $reasons ) );
}

function wp_gym_grade( array $checks ): array {
	$checks    = wp_gym_normalize_checks( $checks );
	$max_score = 0.0;
	$score     = 0.0;

	foreach ( $checks as $check ) {
		$max_score += (float) $check['max_score'];
		$score     += (float) $check['score'];
	}

	$reward = $max_score > 0 ? $score / $max_score : 0;

	return array(
		'success'           => $reward >= 1.0,
		'reward'            => $reward,
		'done'              => true,
		'terminated'        => true,
		'truncated'         => false,
		'truncation_reason' => null,
		'failure_reasons'   => wp_gym_failure_reasons( $checks ),
		'grade'             => array(
			'score'     => $score,
			'max_score' => $max_score,
			'checks'    => $checks,
		),
	);
}

function wp_gym_missing_post_grade( string $title ): array {
	return wp_gym_grade(
		array(
			array(
				'id'        => 'target_post_exists',
				'passed'    => false,
				'score'     => 0,
				'max_score' => 1,
				'message'   => 'No page or post found with title: ' . $title,
			),
		)
	);
}
