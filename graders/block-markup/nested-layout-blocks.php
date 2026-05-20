<?php

require_once __DIR__ . '/grader-common.php';

if ( ! function_exists( 'wp_gym_nested_layout_block_html' ) ) {
	function wp_gym_nested_layout_block_html( array $block ): string {
		$html = (string) ( $block['innerHTML'] ?? '' );

		foreach ( (array) ( $block['innerBlocks'] ?? array() ) as $inner_block ) {
			if ( is_array( $inner_block ) ) {
				$html .= ' ' . wp_gym_nested_layout_block_html( $inner_block );
			}
		}

		return $html;
	}
}

if ( ! function_exists( 'wp_gym_nested_layout_meaningful_text' ) ) {
	function wp_gym_nested_layout_meaningful_text( array $block ): bool {
		$text = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( wp_gym_nested_layout_block_html( $block ) ) ) );

		preg_match_all( '/[A-Za-z0-9]+/', $text, $words );

		return strlen( $text ) >= 50 && count( $words[0] ?? array() ) >= 10;
	}
}

return static function (): array {
	$title = 'Community Services Overview';
	$post  = wp_gym_find_post_by_title( $title );

	if ( null === $post ) {
		return wp_gym_missing_post_grade( $title );
	}

	$blocks       = parse_blocks( $post->post_content );
	$group_blocks = array_values( array_filter( $blocks, static fn( $block ) => ( $block['blockName'] ?? null ) === 'core/group' ) );
	$nested_ok    = false;
	$column_count = 0;
	$service_columns_with_content = 0;

	foreach ( $group_blocks as $group ) {
		foreach ( $group['innerBlocks'] ?? array() as $group_child ) {
			if ( ( $group_child['blockName'] ?? null ) !== 'core/columns' ) {
				continue;
			}

			$columns = array_values(
				array_filter(
					$group_child['innerBlocks'] ?? array(),
					static fn( $block ) => ( $block['blockName'] ?? null ) === 'core/column'
				)
			);
			$column_count = max( $column_count, count( $columns ) );

			$columns_have_text_blocks = count(
				array_filter(
					$columns,
					static function ( $column ): bool {
						$names = wp_gym_block_names( $column['innerBlocks'] ?? array() );
						return in_array( 'core/heading', $names, true ) && in_array( 'core/paragraph', $names, true );
					}
				)
			) === 2;

			$service_columns_with_content = max(
				$service_columns_with_content,
				count(
					array_filter(
						$columns,
						static function ( $column ): bool {
							$names = wp_gym_block_names( $column['innerBlocks'] ?? array() );

							return in_array( 'core/heading', $names, true ) &&
								in_array( 'core/paragraph', $names, true ) &&
								wp_gym_nested_layout_meaningful_text( $column );
						}
					)
				)
			);

			if ( 2 === count( $columns ) && $columns_have_text_blocks ) {
				$nested_ok = true;
			}
		}
	}

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
		wp_gym_check_required_blocks( $blocks, array( 'core/group', 'core/columns', 'core/column', 'core/heading', 'core/paragraph' ) ),
		array(
			'id'        => 'expected_group_columns_nesting',
			'passed'    => $nested_ok,
			'score'     => $nested_ok ? 0.35 : 0,
			'max_score' => 0.35,
			'message'   => $nested_ok ? 'Found group > columns > two columns with text blocks.' : 'Did not find the required group > columns > column nesting. Max columns found: ' . $column_count,
		),
		array(
			'id'        => 'service_columns_have_meaningful_content',
			'passed'    => 2 === $service_columns_with_content,
			'score'     => 2 === $service_columns_with_content ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => 'Expected each service column to include an editable heading and explanatory paragraph; found ' . $service_columns_with_content . ' complete service columns.',
		),
		array(
			'id'        => 'no_fallback_or_html_blocks',
			'passed'    => ! wp_gym_has_fallback_block( $blocks ),
			'score'     => ! wp_gym_has_fallback_block( $blocks ) ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => ! wp_gym_has_fallback_block( $blocks ) ? 'No fallback/freeform or HTML block detected.' : 'Detected fallback/freeform content or core/html.',
		),
		wp_gym_check_no_shortcodes( $post->post_content ),
	);

	return wp_gym_grade( $checks );
};
