<?php

function wp_rl_find_post_by_title( string $title ): ?WP_Post {
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

function wp_rl_flatten_blocks( array $blocks ): array {
	$flat = array();

	foreach ( $blocks as $block ) {
		$flat[] = $block;
		if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
			$flat = array_merge( $flat, wp_rl_flatten_blocks( $block['innerBlocks'] ) );
		}
	}

	return $flat;
}

function wp_rl_block_names( array $blocks ): array {
	return array_values(
		array_filter(
			array_map(
				static fn( $block ) => is_array( $block ) ? ( $block['blockName'] ?? null ) : null,
				wp_rl_flatten_blocks( $blocks )
			)
		)
	);
}

function wp_rl_has_fallback_block( array $blocks ): bool {
	foreach ( wp_rl_flatten_blocks( $blocks ) as $block ) {
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

function wp_rl_check_required_blocks( array $blocks, array $required_blocks ): array {
	$names   = wp_rl_block_names( $blocks );
	$missing = array_values( array_diff( $required_blocks, $names ) );

	return array(
		'id'        => 'required_blocks_present',
		'passed'    => empty( $missing ),
		'score'     => empty( $missing ) ? 0.25 : 0,
		'max_score' => 0.25,
		'message'   => empty( $missing ) ? 'All required blocks are present.' : 'Missing blocks: ' . implode( ', ', $missing ),
	);
}

function wp_rl_grade( array $checks ): array {
	$max_score = 0.0;
	$score     = 0.0;

	foreach ( $checks as $check ) {
		$max_score += (float) $check['max_score'];
		$score     += (float) $check['score'];
	}

	$reward = $max_score > 0 ? $score / $max_score : 0;

	return array(
		'success' => $reward >= 1.0,
		'reward'  => $reward,
		'done'    => true,
		'grade'   => array(
			'score'     => $score,
			'max_score' => $max_score,
			'checks'    => $checks,
		),
	);
}

function wp_rl_missing_post_grade( string $title ): array {
	return wp_rl_grade(
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
