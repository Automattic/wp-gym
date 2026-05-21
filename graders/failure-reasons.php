<?php

if ( ! function_exists( 'wp_gym_failure_reason_taxonomy' ) ) {
	function wp_gym_failure_reason_taxonomy(): array {
		return array(
			// Content and semantic task failures.
			'missing_target_content'              => 'The expected WordPress post, page, artifact, or answer is missing.',
			'missing_required_content'            => 'Required scenario content is absent or incomplete.',
			'missing_required_text'               => 'Required text is absent from the produced content.',
			'semantic_content_loss'               => 'The output loses required source meaning or migration semantics.',
			'missing_required_blocks'             => 'Required block types are absent.',
			'missing_block_markup'                => 'Expected block markup is absent.',
			'invalid_block'                       => 'The output contains unregistered or invalid block markup.',
			'fallback_block'                      => 'The output relies on fallback/freeform block content.',
			'raw_html_shortcut'                   => 'The output uses raw HTML or shortcode-like markup instead of the requested WordPress structure.',

			// Layout, site-building, and visual-builder failures.
			'layout_structure_mismatch'           => 'The output uses the wrong layout or nesting structure.',
			'missing_required_cta'                => 'A required call to action is missing.',
			'missing_required_plan_content'       => 'Required plan/card content is missing.',
			'missing_block_theme'                 => 'The submitted site does not use the required block theme.',
			'missing_theme_json'                  => 'The active theme lacks required theme.json configuration.',
			'homepage_not_set'                    => 'The expected static homepage is not configured.',
			'missing_navigation'                  => 'The expected navigation structure is missing.',
			'missing_template_part'               => 'The expected template part is missing.',
			'missing_builder_metadata'            => 'Required visual-builder metadata is absent or invalid.',
			'missing_builder_widget'              => 'Required visual-builder widget types are missing.',

			// API/plugin task failures.
			'abilities_api_unavailable'           => 'The required WordPress Abilities API surface is unavailable.',
			'wrong_api_lifecycle'                 => 'The implementation uses the wrong API lifecycle hook.',
			'missing_ability_category'            => 'The required ability category registration is missing.',
			'missing_ability_registration'        => 'The required ability registration is missing.',
			'missing_rest_route'                  => 'The required REST route is missing.',
			'missing_permission_callback'         => 'The REST route lacks a permission callback.',
			'rest_status_mismatch'                => 'The REST response status does not match the scenario contract.',
			'output_site_name_mismatch'           => 'The reported site name does not match WordPress state.',
			'output_post_count_mismatch'          => 'The reported post count does not match WordPress state.',
			'output_shape_mismatch'               => 'The output shape does not match the scenario contract.',
			'output_ok_flag_mismatch'             => 'The output ok flag does not match the scenario contract.',
			'invented_plugin_metadata'            => 'The submission invents or uses unsupported plugin metadata.',
			'speculative_packaging_metadata'      => 'The submission includes speculative plugin packaging metadata.',

			// Migration and media failures.
			'missing_attachment_posts'            => 'Expected media attachment posts are missing.',
			'missing_attachment_files'            => 'Expected media files are missing from local WordPress media.',
			'missing_featured_image'              => 'The expected featured image is missing.',
			'stale_remote_media_url'              => 'The output still references remote source media URLs.',

			// Investigation and site-understanding failures.
			'missing_final_answer_artifact'       => 'The expected final answer artifact is missing.',
			'missing_wp_cli_evidence'             => 'The answer lacks required WP-CLI evidence.',
			'missing_show_on_front_evidence'      => 'The answer lacks required show_on_front evidence.',
			'missing_page_on_front_evidence'      => 'The answer lacks required page_on_front evidence.',
			'incorrect_homepage_diagnosis'        => 'The homepage diagnosis is incorrect.',
			'missing_static_homepage_remediation' => 'The answer omits the expected static-homepage remediation.',
			'incomplete_site_inspection'          => 'The site inspection missed required entities or WordPress state.',
			'wrong_entity_relationship'           => 'The output maps an entity relationship incorrectly.',
			'hallucinated_relationship'           => 'The output invents an unsupported entity relationship.',
			'hallucinated_entity'                 => 'The output invents an unsupported entity.',
			'missing_evidence'                    => 'The output lacks required source evidence.',

			// Stable fallback for unmapped failed checks.
			'unclassified_task_failure'           => 'A failed task check has not yet been mapped to the stable taxonomy.',
		);
	}
}

if ( ! function_exists( 'wp_gym_failure_reason_check_map' ) ) {
	function wp_gym_failure_reason_check_map(): array {
		return array(
			'target_post_exists'                         => 'missing_target_content',
			'target_content_exists'                      => 'missing_target_content',
			'page_created'                               => 'missing_target_content',
			'content_has_blocks'                         => 'missing_block_markup',
			'required_blocks_present'                    => 'missing_required_blocks',
			'three_pricing_columns'                      => 'layout_structure_mismatch',
			'buttons_for_plans'                          => 'missing_required_cta',
			'plan_columns_have_meaningful_content'       => 'missing_required_plan_content',
			'expected_group_columns_nesting'             => 'layout_structure_mismatch',
			'no_fallback_or_html_blocks'                 => 'raw_html_shortcut',
			'no_fallback_or_raw_html'                    => 'raw_html_shortcut',
			'no_shortcodes'                              => 'raw_html_shortcut',
			'expected_heading_text'                      => 'missing_required_text',
			'expected_block_content'                     => 'missing_required_content',
			'used_block_theme'                           => 'missing_block_theme',
			'theme_json_present'                         => 'missing_theme_json',
			'homepage_set'                               => 'homepage_not_set',
			'required_pages_or_sections'                 => 'missing_required_content',
			'valid_blocks'                               => 'invalid_block',
			'navigation_created'                         => 'missing_navigation',
			'template_parts_seen'                        => 'missing_template_part',
			'elementor_builder_metadata'                 => 'missing_builder_metadata',
			'campaign_hero_copy'                         => 'semantic_content_loss',
			'visual_builder_cta'                         => 'missing_required_cta',
			'required_builder_widgets'                   => 'missing_builder_widget',
			'two_column_hero_structure'                  => 'layout_structure_mismatch',
			'required_content_snippets'                  => 'semantic_content_loss',
			'attachment_posts_exist'                     => 'missing_attachment_posts',
			'attachment_files_exist'                     => 'missing_attachment_files',
			'featured_image_restored'                    => 'missing_featured_image',
			'image_blocks_use_local_media'               => 'stale_remote_media_url',
			'no_stale_remote_media_urls'                 => 'stale_remote_media_url',
			'abilities_api_available'                    => 'abilities_api_unavailable',
			'abilities_api_lifecycle'                    => 'wrong_api_lifecycle',
			'category_registered'                        => 'missing_ability_category',
			'ability_registered'                         => 'missing_ability_registration',
			'site_name_matches'                          => 'output_site_name_mismatch',
			'post_count_matches'                         => 'output_post_count_mismatch',
			'exact_output_shape'                         => 'output_shape_mismatch',
			'plugin_author_supported'                    => 'invented_plugin_metadata',
			'no_speculative_plugin_packaging_metadata'   => 'speculative_packaging_metadata',
			'route_registered'                           => 'missing_rest_route',
			'permission_callback_present'                => 'missing_permission_callback',
			'status_200'                                 => 'rest_status_mismatch',
			'ok_flag_true'                               => 'output_ok_flag_mismatch',
			'final_answer_available'                     => 'missing_final_answer_artifact',
			'used_wp_cli'                                => 'missing_wp_cli_evidence',
			'show_on_front_reported'                     => 'missing_show_on_front_evidence',
			'page_on_front_reported'                     => 'missing_page_on_front_evidence',
			'diagnosis_correct'                          => 'incorrect_homepage_diagnosis',
			'static_homepage_remediation'                => 'missing_static_homepage_remediation',
			'summary_page_exists'                        => 'incomplete_site_inspection',
			'expected_entities_present'                  => 'incomplete_site_inspection',
			'entity_posts_created'                       => 'incomplete_site_inspection',
			'expected_relationships_present'             => 'wrong_entity_relationship',
			'no_hallucinated_relationships'              => 'hallucinated_relationship',
			'taxonomy_relationships_present'             => 'wrong_entity_relationship',
			'source_evidence_present'                    => 'missing_evidence',
			'no_hallucinated_entities'                   => 'hallucinated_entity',
		);
	}
}

if ( ! function_exists( 'wp_gym_stable_failure_reason' ) ) {
	function wp_gym_stable_failure_reason( string $reason ): string {
		$reason = trim( $reason );
		if ( preg_match( '/^[a-z0-9_]+$/', $reason ) && array_key_exists( $reason, wp_gym_failure_reason_taxonomy() ) ) {
			return $reason;
		}

		return 'unclassified_task_failure';
	}
}

if ( ! function_exists( 'wp_gym_failure_reason_for_check_id' ) ) {
	function wp_gym_failure_reason_for_check_id( string $id, array $overrides = array() ): string {
		$map    = array_merge( wp_gym_failure_reason_check_map(), $overrides );
		$reason = $map[ $id ] ?? 'unclassified_task_failure';

		return wp_gym_stable_failure_reason( (string) $reason );
	}
}

if ( ! function_exists( 'wp_gym_add_failure_reasons_to_checks' ) ) {
	function wp_gym_add_failure_reasons_to_checks( array $checks, array $overrides = array() ): array {
		foreach ( $checks as &$check ) {
			if ( ! is_array( $check ) || ! empty( $check['passed'] ) ) {
				continue;
			}

			if ( ! empty( $check['failure_reason'] ) ) {
				$check['failure_reason'] = wp_gym_stable_failure_reason( (string) $check['failure_reason'] );
				continue;
			}

			$check['failure_reason'] = wp_gym_failure_reason_for_check_id( (string) ( $check['id'] ?? '' ), $overrides );
		}
		unset( $check );

		return $checks;
	}
}

if ( ! function_exists( 'wp_gym_collect_failure_reasons' ) ) {
	function wp_gym_collect_failure_reasons( array $checks ): array {
		$reasons = array();

		foreach ( $checks as $check ) {
			if ( ! is_array( $check ) || ! empty( $check['passed'] ) || empty( $check['failure_reason'] ) ) {
				continue;
			}

			$reasons[] = wp_gym_stable_failure_reason( (string) $check['failure_reason'] );
		}

		return array_values( array_unique( $reasons ) );
	}
}
