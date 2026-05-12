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

function wp_gym_modern_api_project_roots(): array {
	$cwd = getcwd();

	$roots = array(
		getenv( 'WP_GYM_AGENT_ROOT' ) ?: '',
		$cwd ? $cwd . '/.agent-workspace/current-project' : '',
	);

	return wp_gym_modern_api_existing_directories( $roots );
}

function wp_gym_modern_api_files_with_content( array $roots, callable $matches ): array {
	$matched_files = array();
	$extensions    = array( 'php', 'txt', 'md' );

	foreach ( $roots as $root ) {
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS )
		);

		foreach ( $iterator as $file ) {
			if ( ! $file instanceof SplFileInfo || ! $file->isFile() ) {
				continue;
			}

			$extension = strtolower( $file->getExtension() );
			if ( ! in_array( $extension, $extensions, true ) ) {
				continue;
			}

			$pathname = $file->getPathname();
			$content  = file_get_contents( $pathname );
			if ( false !== $content && $matches( $pathname, $content ) ) {
				$matched_files[] = $pathname;
			}
		}
	}

	return array_values( array_unique( $matched_files ) );
}

function wp_gym_modern_api_relative_paths( array $files, array $roots ): array {
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

function wp_gym_check_no_speculative_plugin_packaging_metadata( array $options = array() ): array {
	$roots        = wp_gym_modern_api_project_roots();
	$allow_readme = (bool) ( $options['allow_readme'] ?? false );

	$readme_files = $allow_readme
		? array()
		: wp_gym_modern_api_files_with_content(
			$roots,
			static fn( string $path, string $content ): bool => 'readme.txt' === strtolower( basename( $path ) )
		);

	$metadata_files = wp_gym_modern_api_files_with_content(
		$roots,
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
		}
	);

	$flagged_files = array_values( array_unique( array_merge( $readme_files, $metadata_files ) ) );
	$passed        = empty( $flagged_files );
	$paths         = wp_gym_modern_api_relative_paths( $flagged_files, $roots );

	return array(
		'id'        => 'no_speculative_plugin_packaging_metadata',
		'passed'    => $passed,
		'score'     => $passed ? 0.1 : 0,
		'max_score' => 0.1,
		'message'   => $passed ? 'No speculative plugin packaging metadata detected.' : 'Detected unsupported plugin packaging metadata in: ' . implode( ', ', $paths ),
	);
}

function wp_gym_modern_api_plugin_author_supported_check( array $needles, ?string $allowed_author = null, float $max_score = 0.1 ): array {
	$roots       = wp_gym_modern_api_project_roots();
	$unsupported = array();
	$allowed     = is_string( $allowed_author ) ? trim( $allowed_author ) : '';

	foreach ( wp_gym_modern_api_plugin_header_files( $roots ) as $plugin ) {
		if ( ! wp_gym_modern_api_plugin_scope_contains_needles( $plugin, $needles ) ) {
			continue;
		}

		$author = wp_gym_modern_api_plugin_header_value( $plugin['content'], 'Author' );
		if ( '' === $author ) {
			continue;
		}

		if ( '' !== $allowed && 0 === strcasecmp( $allowed, $author ) ) {
			continue;
		}

		$unsupported[] = array(
			'path'   => $plugin['path'],
			'author' => $author,
		);
	}

	$messages = array();
	foreach ( $unsupported as $plugin ) {
		$path       = wp_gym_modern_api_relative_paths( array( $plugin['path'] ), $roots )[0] ?? $plugin['path'];
		$messages[] = sprintf( '%s (%s)', $path, $plugin['author'] );
	}

	$passed = empty( $messages );

	return array(
		'id'        => 'plugin_author_supported',
		'passed'    => $passed,
		'score'     => $passed ? $max_score : 0,
		'max_score' => $max_score,
		'message'   => $passed
			? 'Relevant plugin headers omit author metadata or use the scenario-provided author.'
			: 'Relevant plugin headers include unsupported author metadata in: ' . implode( ', ', $messages ),
	);
}

function wp_gym_modern_api_plugin_header_files( array $roots ): array {
	$plugins = array();
	$files   = wp_gym_modern_api_files_with_content(
		$roots,
		static fn( string $path, string $content ): bool => 'php' === strtolower( pathinfo( $path, PATHINFO_EXTENSION ) )
			&& '' !== wp_gym_modern_api_plugin_header_value( $content, 'Plugin Name' )
	);

	foreach ( $files as $file ) {
		$content = file_get_contents( $file );
		if ( false === $content ) {
			continue;
		}

		$plugins[] = array(
			'path'    => $file,
			'content' => $content,
			'scope'   => wp_gym_modern_api_plugin_scope_for_file( $file, $roots ),
		);
	}

	return $plugins;
}

function wp_gym_modern_api_plugin_header_value( string $content, string $header ): string {
	$header = preg_quote( $header, '/' );
	if ( preg_match( '/^\s*(?:\*\s*)?' . $header . '\s*:\s*(.+)$/mi', $content, $matches ) ) {
		return trim( (string) $matches[1] );
	}

	return '';
}

function wp_gym_modern_api_plugin_scope_for_file( string $file, array $roots ): string {
	$directory = dirname( $file );

	foreach ( $roots as $root ) {
		$root = rtrim( $root, DIRECTORY_SEPARATOR );
		if ( $directory === $root ) {
			return $file;
		}

		if ( 0 === strpos( $directory, $root . DIRECTORY_SEPARATOR ) ) {
			$relative = substr( $directory, strlen( $root ) + 1 );
			$first    = strtok( $relative, DIRECTORY_SEPARATOR );

			return $first ? $root . DIRECTORY_SEPARATOR . $first : $file;
		}
	}

	return $file;
}

function wp_gym_modern_api_plugin_scope_contains_needles( array $plugin, array $needles ): bool {
	$paths = is_dir( $plugin['scope'] )
		? wp_gym_modern_api_files_with_content(
			array( $plugin['scope'] ),
			static fn( string $path, string $content ): bool => 'php' === strtolower( pathinfo( $path, PATHINFO_EXTENSION ) )
		)
		: array( $plugin['scope'] );

	foreach ( $paths as $path ) {
		$content = file_get_contents( $path );
		if ( false === $content ) {
			continue;
		}

		foreach ( $needles as $needle ) {
			if ( is_string( $needle ) && '' !== $needle && false !== strpos( $content, $needle ) ) {
				return true;
			}
		}
	}

	return false;
}
