<?php

require_once __DIR__ . '/../block-markup/grader-common.php';

return static function (): array {
	$posts = get_posts(
		array(
			'post_type'      => array( 'page', 'post' ),
			'post_status'    => 'publish',
			'posts_per_page' => -1,
		)
	);

	$summary_page = wp_gym_find_post_by_title( 'Service Relationship Map' );
	$content      = '';
	$title_index  = '';
	$linked_posts = 0;

	foreach ( $posts as $post ) {
		$content     .= ' ' . $post->post_title . ' ' . wp_strip_all_tags( $post->post_content );
		$title_index .= ' ' . $post->post_title;
	}

	$summary_content = $summary_page instanceof WP_Post ? wp_strip_all_tags( $summary_page->post_content ) : '';
	$summary_html    = $summary_page instanceof WP_Post ? (string) $summary_page->post_content : '';

	if ( $summary_page instanceof WP_Post ) {
		preg_match_all( '/<a\s[^>]*href=["\'][^"\']+["\'][^>]*>/i', $summary_html, $matches );
		$linked_posts = count( $matches[0] ?? array() );
	}

	$expected_entities = array(
		'boiler tune-ups',
		'chimney inspections',
		'heat pump triage',
		'maya ortiz',
		'theo grant',
		'north loop',
		'river market',
		'south hill',
	);
	$lower_content     = strtolower( $content . ' ' . $summary_content );
	$missing_entities  = array_values(
		array_filter(
			$expected_entities,
			static fn( string $entity ): bool => false === strpos( $lower_content, $entity )
		)
	);

	$relationships = array(
		'boiler_maya_north_loop'      => array( 'boiler tune-ups', 'maya ortiz', 'north loop' ),
		'boiler_maya_river_market'    => array( 'boiler tune-ups', 'maya ortiz', 'river market' ),
		'chimney_theo_south_hill'     => array( 'chimney inspections', 'theo grant', 'south hill' ),
		'heat_pump_maya_south_hill'   => array( 'heat pump triage', 'maya ortiz', 'south hill' ),
	);
	$relationship_hits = 0;
	foreach ( $relationships as $terms ) {
		$matched = false;
		foreach ( preg_split( '/\R+|\./', strtolower( $summary_content ) ) as $segment ) {
			if ( '' === trim( $segment ) ) {
				continue;
			}

			$matched = ! array_diff(
				$terms,
				array_filter(
					$terms,
					static fn( string $term ): bool => false !== strpos( $segment, $term )
				)
			);
			if ( $matched ) {
				break;
			}
		}

		if ( $matched ) {
			++$relationship_hits;
		}
	}
	$unsupported_relationships = array();
	foreach (
		array(
			array( 'boiler tune-ups', 'theo grant' ),
			array( 'chimney inspections', 'maya ortiz' ),
			array( 'heat pump triage', 'theo grant' ),
			array( 'chimney inspections', 'north loop' ),
			array( 'heat pump triage', 'river market' ),
		) as $unsupported_pair
	) {
		list( $service, $wrong_entity ) = $unsupported_pair;
		foreach ( preg_split( '/\R+|\./', strtolower( $summary_content ) ) as $segment ) {
			if ( false !== strpos( $segment, $service ) && false !== strpos( $segment, $wrong_entity ) ) {
				$unsupported_relationships[] = $service . ' + ' . $wrong_entity;
				break;
			}
		}
	}

	$category_terms = get_terms(
		array(
			'taxonomy'   => 'category',
			'hide_empty' => false,
		)
	);
	$tag_terms      = get_terms(
		array(
			'taxonomy'   => 'post_tag',
			'hide_empty' => false,
		)
	);
	$term_names     = strtolower(
		implode(
			' ',
			array_map(
				static fn( WP_Term $term ): string => $term->name,
				array_merge( is_array( $category_terms ) ? $category_terms : array(), is_array( $tag_terms ) ? $tag_terms : array() )
			)
		)
	);
	$taxonomy_hits  = 0;
	foreach ( array( 'service', 'staff', 'location', 'north loop', 'river market', 'south hill', 'maya ortiz', 'theo grant' ) as $term ) {
		if ( false !== strpos( $term_names, $term ) ) {
			++$taxonomy_hits;
		}
	}

	$post_titles_with_entities = 0;
	foreach ( $expected_entities as $entity ) {
		if ( false !== strpos( strtolower( $title_index ), $entity ) ) {
			++$post_titles_with_entities;
		}
	}

	$source_terms = array( 'source', 'evidence', 'based on', 'wordpress', 'post', 'page', 'category', 'tag' );
	$source_hits  = 0;
	foreach ( $source_terms as $source_term ) {
		if ( false !== strpos( strtolower( $summary_content ), $source_term ) ) {
			++$source_hits;
		}
	}

	$unsupported_entities = array( 'roofing', 'plumbing', 'electrical', 'westport', 'jordan lee', 'sofia chen' );
	$hallucinated         = array_values(
		array_filter(
			$unsupported_entities,
			static fn( string $entity ): bool => false !== strpos( $lower_content, $entity )
		)
	);

	$checks = array(
		array(
			'id'             => 'summary_page_exists',
			'passed'         => $summary_page instanceof WP_Post && 'publish' === $summary_page->post_status,
			'score'          => $summary_page instanceof WP_Post && 'publish' === $summary_page->post_status ? 0.15 : 0,
			'max_score'      => 0.15,
			'message'        => 'Expected a published page titled Service Relationship Map.',
			'failure_reason' => 'incomplete_site_inspection',
		),
		array(
			'id'             => 'expected_entities_present',
			'passed'         => empty( $missing_entities ),
			'score'          => empty( $missing_entities ) ? 0.2 : 0,
			'max_score'      => 0.2,
			'message'        => empty( $missing_entities ) ? 'All expected entities are present.' : 'Missing entities: ' . implode( ', ', $missing_entities ),
			'failure_reason' => 'incomplete_site_inspection',
		),
		array(
			'id'             => 'entity_posts_created',
			'passed'         => $post_titles_with_entities >= 6,
			'score'          => $post_titles_with_entities >= 6 ? 0.15 : 0,
			'max_score'      => 0.15,
			'message'        => 'Expected services, staff, and locations to be represented as maintainable WordPress entries.',
			'failure_reason' => 'incomplete_site_inspection',
		),
		array(
			'id'             => 'expected_relationships_present',
			'passed'         => 4 === $relationship_hits,
			'score'          => 4 === $relationship_hits ? 0.2 : 0,
			'max_score'      => 0.2,
			'message'        => 'Relationship matches found: ' . $relationship_hits . ' of 4.',
			'failure_reason' => 'wrong_entity_relationship',
		),
		array(
			'id'             => 'no_hallucinated_relationships',
			'passed'         => empty( $unsupported_relationships ),
			'score'          => empty( $unsupported_relationships ) ? 0.05 : 0,
			'max_score'      => 0.05,
			'message'        => empty( $unsupported_relationships ) ? 'No unsupported relationships detected.' : 'Unsupported relationships detected: ' . implode( ', ', $unsupported_relationships ),
			'failure_reason' => 'hallucinated_relationship',
		),
		array(
			'id'             => 'taxonomy_relationships_present',
			'passed'         => $taxonomy_hits >= 5,
			'score'          => $taxonomy_hits >= 5 ? 0.1 : 0,
			'max_score'      => 0.1,
			'message'        => 'Expected WordPress categories or tags to encode service, staff, or location organization.',
			'failure_reason' => 'wrong_entity_relationship',
		),
		array(
			'id'             => 'source_evidence_present',
			'passed'         => $source_hits >= 2 && $linked_posts >= 2,
			'score'          => $source_hits >= 2 && $linked_posts >= 2 ? 0.1 : 0,
			'max_score'      => 0.1,
			'message'        => 'Expected a source/evidence note with links back to WordPress content.',
			'failure_reason' => 'missing_evidence',
		),
		array(
			'id'             => 'no_hallucinated_entities',
			'passed'         => empty( $hallucinated ),
			'score'          => empty( $hallucinated ) ? 0.05 : 0,
			'max_score'      => 0.05,
			'message'        => empty( $hallucinated ) ? 'No unsupported entities detected.' : 'Unsupported entities detected: ' . implode( ', ', $hallucinated ),
			'failure_reason' => 'hallucinated_entity',
		),
	);

	return wp_gym_grade( $checks );
};
