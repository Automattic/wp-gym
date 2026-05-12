<?php

require_once __DIR__ . '/grader-common.php';

return static function (): array {
	$title = 'Neighborhood Cookout Plan';
	$post  = wp_gym_find_post_by_title( $title );

	if ( null === $post ) {
		return wp_gym_missing_post_grade( $title );
	}

	$blocks = parse_blocks( $post->post_content );
	$checks = array(
		array(
			'id'        => 'target_post_exists',
			'passed'    => true,
			'score'     => 0.2,
			'max_score' => 0.2,
			'message'   => 'Found target page/post.',
		),
		array(
			'id'        => 'content_has_blocks',
			'passed'    => has_blocks( $post->post_content ),
			'score'     => has_blocks( $post->post_content ) ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => has_blocks( $post->post_content ) ? 'Content uses Gutenberg block comments.' : 'Content does not use Gutenberg block comments.',
		),
		wp_gym_check_required_blocks( $blocks, array( 'core/heading', 'core/paragraph', 'core/list', 'core/list-item', 'core/buttons', 'core/button' ) ),
		array(
			'id'        => 'no_fallback_or_html_blocks',
			'passed'    => ! wp_gym_has_fallback_block( $blocks ),
			'score'     => ! wp_gym_has_fallback_block( $blocks ) ? 0.25 : 0,
			'max_score' => 0.25,
			'message'   => ! wp_gym_has_fallback_block( $blocks ) ? 'No fallback/freeform or HTML block detected.' : 'Detected fallback/freeform content or core/html.',
		),
		wp_gym_check_no_shortcodes( $post->post_content ),
		array(
			'id'        => 'expected_heading_text',
			'passed'    => false !== strpos( $post->post_content, 'Summer Cookout Plan' ),
			'score'     => false !== strpos( $post->post_content, 'Summer Cookout Plan' ) ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Checks for the requested heading text.',
		),
	);

	return wp_gym_grade( $checks );
};
