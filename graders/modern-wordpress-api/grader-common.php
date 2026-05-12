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
