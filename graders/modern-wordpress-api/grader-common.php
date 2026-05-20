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

function wp_gym_modern_api_normalize_relative_path( string $path ): string {
	$path = trim( str_replace( '\\', '/', $path ) );
	$path = ltrim( $path, '/' );

	while ( str_contains( $path, '//' ) ) {
		$path = str_replace( '//', '/', $path );
	}

	return rtrim( $path, '/' );
}

function wp_gym_modern_api_hidden_path_prefixes(): array {
	$default_hidden_paths = array(
		'graders',
		'scenarios',
		'prompts',
		'checks',
		'task-sets',
		'.github',
		'docs',
		'scripts',
	);
	$env_hidden_paths     = getenv( 'WP_GYM_HIDDEN_PATHS' );
	$hidden_paths         = false === $env_hidden_paths || '' === trim( $env_hidden_paths )
		? $default_hidden_paths
		: preg_split( '/[,:]/', $env_hidden_paths );

	return array_values(
		array_filter(
			array_map(
				static fn( string $path ): string => wp_gym_modern_api_normalize_relative_path( $path ),
				$hidden_paths
			)
		)
	);
}

function wp_gym_modern_api_writable_path_prefixes(): array {
	$default_writable_paths = array(
		'plugins',
		'starter-workspaces/modern-wordpress-api/plugins',
	);
	$env_writable_paths     = getenv( 'WP_GYM_WRITABLE_ROOTS' );
	$writable_paths         = false === $env_writable_paths || '' === trim( $env_writable_paths )
		? $default_writable_paths
		: preg_split( '/[,:]/', $env_writable_paths );

	return array_values(
		array_filter(
			array_map(
				static fn( string $path ): string => wp_gym_modern_api_normalize_relative_path( $path ),
				$writable_paths
			)
		)
	);
}

function wp_gym_modern_api_path_has_prefix( string $path, string $prefix ): bool {
	return $path === $prefix || str_starts_with( $path, $prefix . '/' );
}

function wp_gym_modern_api_hidden_relative_path( string $relative_path ): bool {
	foreach ( wp_gym_modern_api_hidden_path_prefixes() as $hidden_path ) {
		if ( wp_gym_modern_api_path_has_prefix( $relative_path, $hidden_path ) ) {
			return true;
		}
	}

	return false;
}

function wp_gym_modern_api_writable_relative_path( string $relative_path ): bool {
	$writable_paths = wp_gym_modern_api_writable_path_prefixes();
	if ( empty( $writable_paths ) ) {
		return false;
	}

	foreach ( $writable_paths as $writable_path ) {
		if ( wp_gym_modern_api_path_has_prefix( $relative_path, $writable_path ) ) {
			return true;
		}
	}

	return false;
}

function wp_gym_modern_api_changed_relative_paths( string $root ): array {
	$command = sprintf(
		'git -C %s status --porcelain --untracked-files=all 2>/dev/null',
		escapeshellarg( $root )
	);
	$output  = array();
	$status  = 0;
	exec( $command, $output, $status );

	if ( 0 !== $status ) {
		return array( '__git_status_failed__' );
	}

	$paths = array();
	foreach ( $output as $line ) {
		$path = trim( substr( $line, 3 ) );
		if ( str_contains( $path, ' -> ' ) ) {
			$parts = explode( ' -> ', $path );
			$path  = trim( end( $parts ) );
		}

		$path = trim( $path, '"' );
		if ( '' !== $path ) {
			$paths[] = wp_gym_modern_api_normalize_relative_path( $path );
		}
	}

	return array_values( array_unique( $paths ) );
}

function wp_gym_modern_api_is_hidden_path( string $root, string $pathname ): bool {
	$relative_path = wp_gym_modern_api_normalize_relative_path( substr( $pathname, strlen( rtrim( $root, DIRECTORY_SEPARATOR ) ) + 1 ) );

	return wp_gym_modern_api_hidden_relative_path( $relative_path );
}

function wp_gym_modern_api_is_writable_path( string $root, string $pathname ): bool {
	$relative_path  = wp_gym_modern_api_normalize_relative_path( substr( $pathname, strlen( rtrim( $root, DIRECTORY_SEPARATOR ) ) + 1 ) );
	$writable_paths = wp_gym_modern_api_writable_path_prefixes();

	if ( empty( $writable_paths ) ) {
		return false;
	}

	foreach ( $writable_paths as $writable_path ) {
		if ( wp_gym_modern_api_path_has_prefix( $relative_path, $writable_path ) ) {
			return true;
		}
	}

	return false;
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
			$realpath = realpath( $pathname );
			$rootpath = rtrim( $root, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR;
			if ( false === $realpath || 0 !== strpos( $realpath, $rootpath ) ) {
				continue;
			}

			if ( wp_gym_modern_api_is_hidden_path( $root, $pathname ) ) {
				continue;
			}

			if ( ! wp_gym_modern_api_is_writable_path( $root, $pathname ) ) {
				continue;
			}

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

function wp_gym_modern_api_workspace_policy_check(): array {
	$roots      = wp_gym_modern_api_submitted_project_roots();
	$violations = array();

	if ( empty( $roots ) ) {
		return array(
			'id'             => 'workspace_policy',
			'passed'         => false,
			'score'          => 0,
			'max_score'      => 0,
			'failure_reason' => 'missing_workspace_root',
			'message'        => 'No submitted workspace root was available for policy checks.',
		);
	}

	foreach ( $roots as $root ) {
		foreach ( wp_gym_modern_api_changed_relative_paths( $root ) as $relative_path ) {
			if (
				wp_gym_modern_api_hidden_relative_path( $relative_path ) ||
				! wp_gym_modern_api_writable_relative_path( $relative_path )
			) {
				$violations[] = $relative_path;
			}
		}
	}

	$violations = array_values( array_unique( $violations ) );
	$passed     = empty( $violations );

	return array(
		'id'             => 'workspace_policy',
		'passed'         => $passed,
		'score'          => 0,
		'max_score'      => 0,
		'failure_reason' => $passed ? null : 'workspace_policy_violation',
		'message'        => $passed ? 'Workspace changes stayed inside writable roots.' : 'Detected changed files outside writable roots or inside hidden paths: ' . implode( ', ', $violations ),
	);
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
		'workspace_policy'                         => 'workspace_policy_violation',
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
	foreach ( $checks as $check ) {
		if ( is_array( $check ) && 'workspace_policy' === ( $check['id'] ?? '' ) && empty( $check['passed'] ) ) {
			$score = 0;
			break;
		}
	}

	return array(
		'success'         => $score >= 1.0,
		'reward'          => $score,
		'done'            => true,
		'terminated'      => true,
		'truncated'       => false,
		'truncation_reason' => null,
		'failure_reasons' => wp_gym_modern_api_failure_reasons( $checks ),
		'grade'           => array(
			'score'     => $score,
			'max_score' => 1,
			'checks'    => $checks,
		),
	);
}
