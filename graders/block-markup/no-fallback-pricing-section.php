<?php

require_once __DIR__ . '/grader-common.php';

return static function (): array {
	$title = 'Parseable Pricing Section';
	$post  = wp_rl_find_post_by_title( $title );

	if ( null === $post ) {
		return wp_rl_missing_post_grade( $title );
	}

	$blocks       = parse_blocks( $post->post_content );
	$names        = wp_rl_block_names( $blocks );
	$column_count = count( array_filter( $names, static fn( $name ) => 'core/column' === $name ) );
	$button_count = count( array_filter( $names, static fn( $name ) => 'core/button' === $name ) );

	$checks = array(
		array(
			'id'        => 'target_post_exists',
			'passed'    => true,
			'score'     => 0.15,
			'max_score' => 0.15,
			'message'   => 'Found target page/post.',
		),
		array(
			'id'        => 'content_has_blocks',
			'passed'    => has_blocks( $post->post_content ),
			'score'     => has_blocks( $post->post_content ) ? 0.15 : 0,
			'max_score' => 0.15,
			'message'   => has_blocks( $post->post_content ) ? 'Content uses Gutenberg block comments.' : 'Content does not use Gutenberg block comments.',
		),
		wp_rl_check_required_blocks( $blocks, array( 'core/cover', 'core/heading', 'core/paragraph', 'core/columns', 'core/column', 'core/buttons', 'core/button' ) ),
		array(
			'id'        => 'three_pricing_columns',
			'passed'    => 3 === $column_count,
			'score'     => 3 === $column_count ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => 'Expected exactly three core/column blocks; found ' . $column_count . '.',
		),
		array(
			'id'        => 'buttons_for_plans',
			'passed'    => $button_count >= 3,
			'score'     => $button_count >= 3 ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Expected at least three core/button blocks; found ' . $button_count . '.',
		),
		array(
			'id'        => 'no_fallback_or_html_blocks',
			'passed'    => ! wp_rl_has_fallback_block( $blocks ),
			'score'     => ! wp_rl_has_fallback_block( $blocks ) ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => ! wp_rl_has_fallback_block( $blocks ) ? 'No fallback/freeform or HTML block detected.' : 'Detected fallback/freeform content or core/html.',
		),
		array(
			'id'        => 'expected_heading_text',
			'passed'    => false !== strpos( $post->post_content, 'Choose Your Plan' ),
			'score'     => false !== strpos( $post->post_content, 'Choose Your Plan' ) ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Checks for the requested pricing heading text.',
		),
	);

	return wp_rl_grade( $checks );
};
