<?php

require_once __DIR__ . '/grader-common.php';

if ( ! function_exists( 'wp_gym_pricing_block_html' ) ) {
	function wp_gym_pricing_block_html( array $block ): string {
		$html = (string) ( $block['innerHTML'] ?? '' );

		foreach ( (array) ( $block['innerBlocks'] ?? array() ) as $inner_block ) {
			if ( is_array( $inner_block ) ) {
				$html .= ' ' . wp_gym_pricing_block_html( $inner_block );
			}
		}

		return $html;
	}
}

if ( ! function_exists( 'wp_gym_count_meaningful_pricing_columns' ) ) {
	function wp_gym_count_meaningful_pricing_columns( array $blocks ): int {
		$count = 0;

		foreach ( wp_gym_flatten_blocks( $blocks ) as $block ) {
			if ( 'core/column' !== ( $block['blockName'] ?? null ) ) {
				continue;
			}

			$inner_blocks = (array) ( $block['innerBlocks'] ?? array() );
			$inner_names  = wp_gym_block_names( $inner_blocks );
			$text         = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( wp_gym_pricing_block_html( $block ) ) ) );

			if (
				in_array( 'core/heading', $inner_names, true ) &&
				in_array( 'core/paragraph', $inner_names, true ) &&
				in_array( 'core/button', $inner_names, true ) &&
				strlen( $text ) >= 40
			) {
				$count++;
			}
		}

		return $count;
	}
}

return static function (): array {
	$title = 'Simple Pricing Page';
	$post  = wp_gym_find_post_by_title( $title );

	if ( null === $post ) {
		return wp_gym_missing_post_grade( $title );
	}

	$blocks       = parse_blocks( $post->post_content );
	$names        = wp_gym_block_names( $blocks );
	$column_count = count( array_filter( $names, static fn( $name ) => 'core/column' === $name ) );
	$button_count = count( array_filter( $names, static fn( $name ) => 'core/button' === $name ) );
	$plan_columns = wp_gym_count_meaningful_pricing_columns( $blocks );

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
		wp_gym_check_required_blocks( $blocks, array( 'core/cover', 'core/heading', 'core/paragraph', 'core/columns', 'core/column', 'core/buttons', 'core/button' ) ),
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
			'id'        => 'plan_columns_have_meaningful_content',
			'passed'    => 3 === $plan_columns,
			'score'     => 3 === $plan_columns ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => 'Expected each pricing column to include an editable plan heading, descriptive paragraph, and button; found ' . $plan_columns . ' complete plan columns.',
		),
		array(
			'id'        => 'no_fallback_or_html_blocks',
			'passed'    => ! wp_gym_has_fallback_block( $blocks ),
			'score'     => ! wp_gym_has_fallback_block( $blocks ) ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => ! wp_gym_has_fallback_block( $blocks ) ? 'No fallback/freeform or HTML block detected.' : 'Detected fallback/freeform content or core/html.',
		),
		wp_gym_check_no_shortcodes( $post->post_content ),
		array(
			'id'        => 'expected_heading_text',
			'passed'    => false !== strpos( $post->post_content, 'Choose Your Plan' ),
			'score'     => false !== strpos( $post->post_content, 'Choose Your Plan' ) ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Checks for the requested pricing heading text.',
		),
	);

	return wp_gym_grade( $checks );
};
