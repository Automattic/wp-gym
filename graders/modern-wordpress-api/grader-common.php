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

function wp_gym_modern_api_files_with_content( array $roots, callable $matches, array $extensions = array( 'php', 'txt', 'md' ) ): array {
	$matched_files = array();

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

function wp_gym_modern_api_is_candidate_submission_file( string $path, array $roots ): bool {
	$relative_paths = wp_gym_modern_api_relative_paths( array( $path ), $roots );
	$relative_path  = str_replace( '\\', '/', $relative_paths[0] ?? $path );
	$first_segment  = strtok( $relative_path, '/' );

	$ignored_segments = array(
		'.git',
		'.github',
		'.claude',
		'.opencode',
		'node_modules',
		'vendor',
		'bundles',
		'docs',
		'graders',
		'prompts',
		'scenarios',
		'scripts',
		'task-sets',
	);

	return false === $first_segment || ! in_array( $first_segment, $ignored_segments, true );
}

function wp_gym_modern_api_candidate_plugin_files( array $needles ): array {
	$roots = wp_gym_modern_api_project_roots();

	return wp_gym_modern_api_files_with_content(
		$roots,
		static function ( string $path, string $content ) use ( $needles, $roots ): bool {
			if ( ! wp_gym_modern_api_is_candidate_submission_file( $path, $roots ) ) {
				return false;
			}

			foreach ( $needles as $needle ) {
				if ( is_string( $needle ) && '' !== $needle && false !== strpos( $content, $needle ) ) {
					return true;
				}
			}

			return false;
		},
		array( 'php' )
	);
}

function wp_gym_modern_api_file_contents( array $files ): string {
	$source = '';

	foreach ( $files as $file ) {
		if ( ! is_readable( $file ) || ! is_file( $file ) ) {
			continue;
		}

		$contents = file_get_contents( $file );
		if ( false !== $contents ) {
			$source .= "\n" . $contents;
		}
	}

	return $source;
}
