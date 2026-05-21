<?php

require_once __DIR__ . '/../block-markup/grader-common.php';

if ( ! function_exists( 'wp_gym_media_import_find_attachment_by_filename' ) ) {
	function wp_gym_media_import_find_attachment_by_filename( string $filename ): ?WP_Post {
		$attachments = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'posts_per_page' => -1,
			)
		);

		foreach ( $attachments as $attachment ) {
			$file = (string) get_attached_file( $attachment->ID );
			$url  = (string) wp_get_attachment_url( $attachment->ID );

			if ( basename( $file ) === $filename || basename( wp_parse_url( $url, PHP_URL_PATH ) ?: '' ) === $filename ) {
				return $attachment;
			}
		}

		return null;
	}
}

if ( ! function_exists( 'wp_gym_media_import_post_content_text' ) ) {
	function wp_gym_media_import_post_content_text( array $posts ): string {
		$text = '';

		foreach ( $posts as $post ) {
			$text .= ' ' . $post->post_title . ' ' . wp_strip_all_tags( $post->post_content );
		}

		return strtolower( $text );
	}
}

if ( ! function_exists( 'wp_gym_media_import_failure_reason_for_check' ) ) {
	function wp_gym_media_import_failure_reason_for_check( array $check ): string {
		return wp_gym_failure_reason_for_check_id( (string) ( $check['id'] ?? '' ) );
	}
}

if ( ! function_exists( 'wp_gym_media_import_grade' ) ) {
	function wp_gym_media_import_grade( array $checks ): array {
		$checks = wp_gym_add_failure_reasons_to_checks( $checks );

		return wp_gym_grade( $checks );
	}
}

return static function (): array {
	$required_titles = array( 'Harbor Market Spring Menu', 'Catering Gallery' );
	$posts           = array();
	$missing_titles  = array();

	foreach ( $required_titles as $title ) {
		$post = wp_gym_find_post_by_title( $title );
		if ( $post instanceof WP_Post ) {
			$posts[] = $post;
		} else {
			$missing_titles[] = $title;
		}
	}

	$all_content      = wp_gym_media_import_post_content_text( $posts );
	$required_snippets = array( 'smoked mushroom tart', 'seasonal grazing table', 'local asparagus bundles', 'catering board' );
	$missing_snippets = array_values(
		array_filter(
			$required_snippets,
			static fn( string $snippet ): bool => false === strpos( $all_content, $snippet )
		)
	);

	$required_filenames  = array( 'harbor-market-hero.svg', 'catering-board.svg' );
	$attachments_by_file = array();
	$missing_attachments = array();
	$missing_files       = array();

	foreach ( $required_filenames as $filename ) {
		$attachment = wp_gym_media_import_find_attachment_by_filename( $filename );
		if ( $attachment instanceof WP_Post ) {
			$attachments_by_file[ $filename ] = $attachment;
			$file                            = (string) get_attached_file( $attachment->ID );
			if ( '' === $file || ! file_exists( $file ) ) {
				$missing_files[] = $filename;
			}
		} else {
			$missing_attachments[] = $filename;
			$missing_files[]       = $filename;
		}
	}

	$featured_post       = wp_gym_find_post_by_title( 'Harbor Market Spring Menu' );
	$featured_attachment = $attachments_by_file['harbor-market-hero.svg'] ?? null;
	$featured_id         = $featured_post instanceof WP_Post ? (int) get_post_thumbnail_id( $featured_post->ID ) : 0;
	$featured_restored   = $featured_attachment instanceof WP_Post && $featured_id === (int) $featured_attachment->ID;

	$combined_post_content = '';
	$block_names           = array();
	foreach ( $posts as $post ) {
		$combined_post_content .= ' ' . $post->post_content;
		$block_names            = array_merge( $block_names, wp_gym_block_names( parse_blocks( $post->post_content ) ) );
	}

	$lower_content = strtolower( $combined_post_content );
	$stale_hosts   = array( 'legacy.example.test', 'old-harbor-market.invalid' );
	$stale_hits    = array_values(
		array_filter(
			$stale_hosts,
			static fn( string $host ): bool => false !== strpos( $lower_content, $host )
		)
	);
	$local_upload_references = substr_count( $lower_content, '/wp-content/uploads/' );
	$image_block_count       = count( array_filter( $block_names, static fn( string $name ): bool => 'core/image' === $name ) );

	$checks = array(
		array(
			'id'        => 'target_content_exists',
			'passed'    => empty( $missing_titles ),
			'score'     => empty( $missing_titles ) ? 0.16 : 0,
			'max_score' => 0.16,
			'message'   => empty( $missing_titles ) ? 'Expected imported posts/pages exist.' : 'Missing imported content: ' . implode( ', ', $missing_titles ),
		),
		array(
			'id'        => 'required_content_snippets',
			'passed'    => empty( $missing_snippets ),
			'score'     => empty( $missing_snippets ) ? 0.14 : 0,
			'max_score' => 0.14,
			'message'   => empty( $missing_snippets ) ? 'Expected source content snippets are present.' : 'Missing snippets: ' . implode( ', ', $missing_snippets ),
		),
		array(
			'id'        => 'attachment_posts_exist',
			'passed'    => empty( $missing_attachments ),
			'score'     => empty( $missing_attachments ) ? 0.18 : 0,
			'max_score' => 0.18,
			'message'   => empty( $missing_attachments ) ? 'Expected attachment posts exist in the Media Library.' : 'Missing attachment posts: ' . implode( ', ', $missing_attachments ),
		),
		array(
			'id'        => 'attachment_files_exist',
			'passed'    => empty( $missing_files ),
			'score'     => empty( $missing_files ) ? 0.18 : 0,
			'max_score' => 0.18,
			'message'   => empty( $missing_files ) ? 'Expected attachment files exist on disk.' : 'Missing attachment files: ' . implode( ', ', array_values( array_unique( $missing_files ) ) ),
		),
		array(
			'id'        => 'featured_image_restored',
			'passed'    => $featured_restored,
			'score'     => $featured_restored ? 0.14 : 0,
			'max_score' => 0.14,
			'message'   => $featured_restored ? 'Featured image points to the imported hero attachment.' : 'Expected Harbor Market Spring Menu featured image to use harbor-market-hero.svg.',
		),
		array(
			'id'        => 'image_blocks_use_local_media',
			'passed'    => $image_block_count >= 2 && $local_upload_references >= 2,
			'score'     => $image_block_count >= 2 && $local_upload_references >= 2 ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => 'Expected at least two core/image blocks referencing local uploads; found ' . $image_block_count . ' image blocks and ' . $local_upload_references . ' local upload references.',
		),
		array(
			'id'        => 'no_stale_remote_media_urls',
			'passed'    => empty( $stale_hits ),
			'score'     => empty( $stale_hits ) ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => empty( $stale_hits ) ? 'No stale source media URLs remain in imported content.' : 'Stale media hosts remain: ' . implode( ', ', $stale_hits ),
		),
	);

	return wp_gym_media_import_grade( $checks );
};
