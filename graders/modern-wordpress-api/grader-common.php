<?php

function wp_gym_modern_api_existing_directories( array $directories ): array {
	$existing = array();

	foreach ( $directories as $directory ) {
		if ( is_string( $directory ) && '' !== $directory && is_dir( $directory ) ) {
			$realpath = realpath( $directory );
			if ( false !== $realpath ) {
				$existing[ $realpath ] = $realpath;
			}
		}
	}

	return array_values( $existing );
}

function wp_gym_modern_api_submitted_project_roots(): array {
	$cwd = getcwd();

	$roots = array(
		getenv( 'WP_GYM_AGENT_ROOT' ) ?: '',
		$cwd ? $cwd . '/.agent-workspace/current-project' : '',
	);

	return wp_gym_modern_api_existing_directories( $roots );
}

function wp_gym_modern_api_normalize_extensions( array $extensions ): array {
	$normalized = array();

	foreach ( $extensions as $extension ) {
		$extension = ltrim( strtolower( (string) $extension ), '.' );
		if ( '' !== $extension ) {
			$normalized[ $extension ] = $extension;
		}
	}

	return array_values( $normalized );
}

function wp_gym_modern_api_submitted_project_files( array $extensions = array( 'php', 'txt', 'md' ) ): array {
	$roots      = wp_gym_modern_api_submitted_project_roots();
	$extensions = wp_gym_modern_api_normalize_extensions( $extensions );
	$files      = array();

	foreach ( $roots as $root ) {
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS )
		);

		foreach ( $iterator as $file ) {
			if ( ! $file instanceof SplFileInfo || ! $file->isFile() ) {
				continue;
			}

			$extension = strtolower( $file->getExtension() );
			if ( ! empty( $extensions ) && ! in_array( $extension, $extensions, true ) ) {
				continue;
			}

			$pathname = $file->getPathname();
			$files[ $pathname ] = $pathname;
		}
	}

	return array_values( $files );
}

function wp_gym_modern_api_read_file( string $path ): string {
	$content = is_readable( $path ) && is_file( $path ) ? file_get_contents( $path ) : false;

	return false === $content ? '' : $content;
}

function wp_gym_modern_api_submitted_files_matching( callable $matches, array $extensions = array( 'php', 'txt', 'md' ) ): array {
	$matched_files = array();

	foreach ( wp_gym_modern_api_submitted_project_files( $extensions ) as $path ) {
		$content = wp_gym_modern_api_read_file( $path );
		if ( '' !== $content && $matches( $path, $content ) ) {
			$matched_files[] = $path;
		}
	}

	return array_values( array_unique( $matched_files ) );
}

function wp_gym_modern_api_file_contains_needles( string $content, array $needles ): bool {
	foreach ( $needles as $needle ) {
		if ( is_string( $needle ) && '' !== $needle && false !== strpos( $content, $needle ) ) {
			return true;
		}
	}

	return false;
}

function wp_gym_modern_api_submitted_files_containing( array $needles, array $extensions = array( 'php' ) ): array {
	return wp_gym_modern_api_submitted_files_matching(
		static fn( string $path, string $content ): bool => wp_gym_modern_api_file_contains_needles( $content, $needles ),
		$extensions
	);
}

function wp_gym_modern_api_submitted_source( array $needles = array(), array $extensions = array( 'php' ) ): string {
	$files = empty( $needles )
		? wp_gym_modern_api_submitted_project_files( $extensions )
		: wp_gym_modern_api_submitted_files_containing( $needles, $extensions );
	$source = '';

	foreach ( $files as $path ) {
		$source .= "\n" . wp_gym_modern_api_read_file( $path );
	}

	return $source;
}

function wp_gym_modern_api_submitted_action_hooks( string $source ): array {
	$hooks = array();

	if ( preg_match_all( "/add_action\s*\(\s*(['\"])([^'\"]+)\\1\s*,/", $source, $matches ) ) {
		foreach ( $matches[2] as $hook ) {
			$hooks[] = $hook;
		}
	}

	return array_values( array_unique( $hooks ) );
}

function wp_gym_modern_api_relative_paths( array $files ): array {
	$roots = wp_gym_modern_api_submitted_project_roots();
	$paths = array();

	foreach ( $files as $file ) {
		$path = $file;
		foreach ( $roots as $root ) {
			$prefix = rtrim( $root, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR;
			if ( 0 === strpos( $file, $prefix ) ) {
				$path = substr( $file, strlen( $prefix ) );
				break;
			}
		}

		$paths[] = $path;
	}

	return $paths;
}

function wp_gym_modern_api_plugin_headers_from_file( string $path ): array {
	$content = wp_gym_modern_api_read_file( $path );

	if ( '' === $content || ! preg_match( '#/\*\*(.*?)\*/|/\*(.*?)\*/#s', $content, $comment_match ) ) {
		return array();
	}

	$comment = $comment_match[1] ?? $comment_match[2] ?? '';
	$headers = array();

	foreach ( array( 'Plugin Name', 'Author', 'Version', 'Requires at least', 'Tested up to' ) as $header ) {
		if ( preg_match( '/^[ \t*#@]*' . preg_quote( $header, '/' ) . '\s*:\s*(.+)$/mi', $comment, $matches ) ) {
			$headers[ $header ] = trim( $matches[1] );
		}
	}

	return $headers;
}

function wp_gym_modern_api_plugin_author_supported_check( array $needles, ?string $allowed_author = null, float $max_score = 0.1 ): array {
	$unsupported = array();
	$allowed     = is_string( $allowed_author ) ? trim( $allowed_author ) : '';
	$files       = wp_gym_modern_api_submitted_files_containing( $needles, array( 'php' ) );

	foreach ( $files as $path ) {
		$headers = wp_gym_modern_api_plugin_headers_from_file( $path );
		$author  = trim( (string) ( $headers['Author'] ?? '' ) );

		if ( '' === $author ) {
			continue;
		}

		if ( '' !== $allowed && 0 === strcasecmp( $allowed, $author ) ) {
			continue;
		}

		$name          = trim( (string) ( $headers['Plugin Name'] ?? basename( $path ) ) );
		$unsupported[] = sprintf( '%s (%s)', $name, $author );
	}

	$passed = empty( $unsupported );

	return array(
		'id'        => 'plugin_author_supported',
		'passed'    => $passed,
		'score'     => $passed ? $max_score : 0,
		'max_score' => $max_score,
		'message'   => $passed
			? 'Relevant submitted plugin headers omit author metadata or use the scenario-provided author.'
			: 'Relevant submitted plugin headers include unsupported author metadata: ' . implode( ', ', $unsupported ),
	);
}

function wp_gym_check_no_speculative_plugin_packaging_metadata( array $options = array() ): array {
	$allow_readme = (bool) ( $options['allow_readme'] ?? false );
	$max_score    = (float) ( $options['max_score'] ?? 0.1 );

	$readme_files = $allow_readme
		? array()
		: wp_gym_modern_api_submitted_files_matching(
			static fn( string $path, string $content ): bool => 'readme.txt' === strtolower( basename( $path ) ),
			array( 'txt' )
		);

	$metadata_files = wp_gym_modern_api_submitted_files_matching(
		static function ( string $path, string $content ): bool {
			$patterns = array(
				'/^\s*(?:Tested up to|Requires at least|Stable tag|Contributors|Donate link|Tags)\s*:/mi',
				'/^\s*\*\s*(?:Tested up to|Requires at least)\s*:/mi',
			);

			foreach ( $patterns as $pattern ) {
				if ( preg_match( $pattern, $content ) ) {
					return true;
				}
			}

			return false;
		},
		array( 'php', 'txt', 'md' )
	);

	$flagged_files = array_values( array_unique( array_merge( $readme_files, $metadata_files ) ) );
	$passed        = empty( $flagged_files );
	$paths         = wp_gym_modern_api_relative_paths( $flagged_files );

	return array(
		'id'        => 'no_speculative_plugin_packaging_metadata',
		'passed'    => $passed,
		'score'     => $passed ? $max_score : 0,
		'max_score' => $max_score,
		'message'   => $passed ? 'No speculative plugin packaging metadata detected.' : 'Detected unsupported plugin packaging metadata in submitted files: ' . implode( ', ', $paths ),
	);
}

function wp_gym_modern_api_failure_reason_for_check( array $check ): string {
	$id = (string) ( $check['id'] ?? '' );

	$reasons = array(
		'abilities_api_available'                 => 'abilities_api_unavailable',
		'abilities_api_lifecycle'                 => 'incorrect_abilities_api_lifecycle',
		'category_registered'                     => 'missing_ability_category',
		'ability_registered'                      => 'missing_ability_registration',
		'site_name_matches'                       => 'output_site_name_mismatch',
		'post_count_matches'                      => 'output_post_count_mismatch',
		'exact_output_shape'                      => 'output_shape_mismatch',
		'plugin_author_supported'                 => 'unsupported_plugin_author',
		'no_speculative_plugin_packaging_metadata' => 'speculative_plugin_packaging_metadata',
		'route_registered'                        => 'missing_rest_route',
		'permission_callback_present'             => 'missing_permission_callback',
		'status_200'                              => 'rest_status_mismatch',
		'ok_flag_true'                            => 'output_ok_flag_mismatch',
	);

	return $reasons[ $id ] ?? $id;
}

function wp_gym_modern_api_normalize_checks( array $checks ): array {
	foreach ( $checks as &$check ) {
		if ( ! is_array( $check ) || ! empty( $check['passed'] ) || ! empty( $check['failure_reason'] ) ) {
			continue;
		}

		$check['failure_reason'] = wp_gym_modern_api_failure_reason_for_check( $check );
	}
	unset( $check );

	return $checks;
}

function wp_gym_modern_api_failure_reasons( array $checks ): array {
	$reasons = array();

	foreach ( $checks as $check ) {
		if ( ! is_array( $check ) || ! empty( $check['passed'] ) || empty( $check['failure_reason'] ) ) {
			continue;
		}

		$reasons[] = (string) $check['failure_reason'];
	}

	return array_values( array_unique( $reasons ) );
}

function wp_gym_modern_api_grade( array $checks ): array {
	$checks = wp_gym_modern_api_normalize_checks( $checks );
	$score  = min( 1, round( array_sum( array_column( $checks, 'score' ) ), 6 ) );

	return array(
		'success'           => $score >= 1.0,
		'reward'            => $score,
		'done'              => true,
		'terminated'        => true,
		'truncated'         => false,
		'truncation_reason' => null,
		'failure_reasons'   => wp_gym_modern_api_failure_reasons( $checks ),
		'grade'             => array(
			'score'     => $score,
			'max_score' => 1,
			'checks'    => $checks,
		),
	);
}
