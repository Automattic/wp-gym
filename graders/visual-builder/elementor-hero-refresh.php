<?php

require_once __DIR__ . '/../block-markup/grader-common.php';

if ( ! function_exists( 'wp_gym_elementor_flatten_elements' ) ) {
	function wp_gym_elementor_flatten_elements( array $elements ): array {
		$flat = array();

		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) ) {
				continue;
			}

			$flat[] = $element;

			if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
				$flat = array_merge( $flat, wp_gym_elementor_flatten_elements( $element['elements'] ) );
			}
		}

		return $flat;
	}
}

if ( ! function_exists( 'wp_gym_elementor_element_text' ) ) {
	function wp_gym_elementor_element_text( array $element ): string {
		$text = '';

		foreach ( (array) ( $element['settings'] ?? array() ) as $value ) {
			if ( is_scalar( $value ) ) {
				$text .= ' ' . (string) $value;
			}
		}

		return wp_strip_all_tags( $text );
	}
}

if ( ! function_exists( 'wp_gym_elementor_text_contains' ) ) {
	function wp_gym_elementor_text_contains( array $elements, string $needle ): bool {
		foreach ( wp_gym_elementor_flatten_elements( $elements ) as $element ) {
			if ( false !== stripos( wp_gym_elementor_element_text( $element ), $needle ) ) {
				return true;
			}
		}

		return false;
	}
}

return static function (): array {
	$title = 'Luma Studio Landing Page';
	$post  = wp_gym_find_post_by_title( $title );

	if ( null === $post ) {
		return wp_gym_missing_post_grade( $title );
	}

	$elementor_edit_mode = (string) get_post_meta( $post->ID, '_elementor_edit_mode', true );
	$elementor_data_raw  = (string) get_post_meta( $post->ID, '_elementor_data', true );
	$elementor_data      = json_decode( $elementor_data_raw, true );
	$elementor_elements  = is_array( $elementor_data ) ? wp_gym_elementor_flatten_elements( $elementor_data ) : array();
	$widget_types        = array_values(
		array_filter(
			array_map(
				static fn( array $element ): ?string => isset( $element['widgetType'] ) ? (string) $element['widgetType'] : null,
				$elementor_elements
			)
		)
	);
	$column_count        = count(
		array_filter(
			$elementor_elements,
			static fn( array $element ): bool => 'column' === (string) ( $element['elType'] ?? '' )
		)
	);
	$content_text        = strtolower( wp_strip_all_tags( $post->post_title . ' ' . $post->post_content . ' ' . $elementor_data_raw ) );
	$shortcodes          = wp_gym_shortcode_matches( $post->post_content . ' ' . $elementor_data_raw );
	$blocks              = parse_blocks( $post->post_content );

	$required_widgets = array( 'heading', 'text-editor', 'button' );
	$missing_widgets  = array_values( array_diff( $required_widgets, array_unique( $widget_types ) ) );

	$checks = array(
		array(
			'id'        => 'target_post_exists',
			'passed'    => true,
			'score'     => 0.1,
			'max_score' => 0.1,
			'message'   => 'Found target landing page.',
		),
		array(
			'id'        => 'elementor_builder_metadata',
			'passed'    => 'builder' === $elementor_edit_mode && is_array( $elementor_data ),
			'score'     => 'builder' === $elementor_edit_mode && is_array( $elementor_data ) ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => is_array( $elementor_data ) ? 'Elementor-compatible builder metadata is present.' : 'Expected valid JSON in _elementor_data and _elementor_edit_mode=builder.',
		),
		array(
			'id'        => 'campaign_hero_copy',
			'passed'    => wp_gym_elementor_text_contains( $elementor_data ?: array(), 'Brand Photos That Feel Effortless' ) && false !== strpos( $content_text, 'warm' ) && false !== strpos( $content_text, 'natural' ),
			'score'     => wp_gym_elementor_text_contains( $elementor_data ?: array(), 'Brand Photos That Feel Effortless' ) && false !== strpos( $content_text, 'warm' ) && false !== strpos( $content_text, 'natural' ) ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => 'Expected requested headline plus warm, natural supporting copy in builder-managed state.',
		),
		array(
			'id'        => 'visual_builder_cta',
			'passed'    => wp_gym_elementor_text_contains( $elementor_data ?: array(), 'Book A Shoot' ) && in_array( 'button', $widget_types, true ),
			'score'     => wp_gym_elementor_text_contains( $elementor_data ?: array(), 'Book A Shoot' ) && in_array( 'button', $widget_types, true ) ? 0.15 : 0,
			'max_score' => 0.15,
			'message'   => 'Expected a builder button widget with the requested CTA text.',
		),
		array(
			'id'        => 'required_builder_widgets',
			'passed'    => empty( $missing_widgets ),
			'score'     => empty( $missing_widgets ) ? 0.15 : 0,
			'max_score' => 0.15,
			'message'   => empty( $missing_widgets ) ? 'Required Elementor-style widgets are present.' : 'Missing widget types: ' . implode( ', ', $missing_widgets ),
		),
		array(
			'id'        => 'two_column_hero_structure',
			'passed'    => $column_count >= 2,
			'score'     => $column_count >= 2 ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Expected at least two builder columns in the hero; found ' . $column_count . '.',
		),
		array(
			'id'        => 'no_fallback_or_raw_html',
			'passed'    => ! wp_gym_has_fallback_block( $blocks ) && empty( $shortcodes ),
			'score'     => ! wp_gym_has_fallback_block( $blocks ) && empty( $shortcodes ) ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => empty( $shortcodes ) ? 'No shortcode-like builder bypass detected.' : 'Detected shortcode-like markup: ' . implode( ', ', $shortcodes ),
		),
	);

	return wp_gym_grade( $checks );
};
