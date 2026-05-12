<?php

function wp_gym_modern_api_plugin_author_supported_check( array $needles, ?string $allowed_author = null, float $max_score = 0.1 ): array {
	if ( ! defined( 'WP_PLUGIN_DIR' ) ) {
		return array(
			'id'        => 'plugin_author_supported',
			'passed'    => true,
			'score'     => $max_score,
			'max_score' => $max_score,
			'message'   => 'Plugin directory is unavailable for plugin header inspection.',
		);
	}

	if ( ! function_exists( 'get_plugins' ) && defined( 'ABSPATH' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	if ( ! function_exists( 'get_plugins' ) ) {
		return array(
			'id'        => 'plugin_author_supported',
			'passed'    => true,
			'score'     => $max_score,
			'max_score' => $max_score,
			'message'   => 'Plugin header reader is unavailable.',
		);
	}

	$unsupported = array();
	$allowed     = is_string( $allowed_author ) ? trim( $allowed_author ) : '';

	foreach ( get_plugins() as $plugin_file => $plugin_data ) {
		if ( ! wp_gym_modern_api_plugin_contains_needles( $plugin_file, $needles ) ) {
			continue;
		}

		$author = trim( (string) ( $plugin_data['Author'] ?? '' ) );
		if ( '' === $author ) {
			continue;
		}

		if ( '' !== $allowed && 0 === strcasecmp( $allowed, $author ) ) {
			continue;
		}

		$unsupported[] = sprintf( '%s (%s)', $plugin_data['Name'] ?: $plugin_file, $author );
	}

	$passed = empty( $unsupported );

	return array(
		'id'        => 'plugin_author_supported',
		'passed'    => $passed,
		'score'     => $passed ? $max_score : 0,
		'max_score' => $max_score,
		'message'   => $passed
			? 'Relevant plugin headers omit author metadata or use the scenario-provided author.'
			: 'Relevant plugin headers include unsupported author metadata: ' . implode( ', ', $unsupported ),
	);
}

function wp_gym_modern_api_plugin_contains_needles( string $plugin_file, array $needles ): bool {
	$plugin_path = trailingslashit( WP_PLUGIN_DIR ) . $plugin_file;
	$paths       = array( $plugin_path );

	if ( is_file( $plugin_path ) ) {
		$plugin_dir = dirname( $plugin_path );
		if ( WP_PLUGIN_DIR !== $plugin_dir ) {
			$paths = array_merge( $paths, wp_gym_modern_api_php_files_in_directory( $plugin_dir ) );
		}
	}

	foreach ( array_unique( $paths ) as $path ) {
		if ( ! is_readable( $path ) || ! is_file( $path ) ) {
			continue;
		}

		$contents = file_get_contents( $path );
		if ( false === $contents ) {
			continue;
		}

		foreach ( $needles as $needle ) {
			if ( is_string( $needle ) && '' !== $needle && false !== strpos( $contents, $needle ) ) {
				return true;
			}
		}
	}

	return false;
}

function wp_gym_modern_api_php_files_in_directory( string $directory ): array {
	$files    = array();
	$iterator = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $directory, FilesystemIterator::SKIP_DOTS )
	);

	foreach ( $iterator as $file ) {
		if ( $file instanceof SplFileInfo && $file->isFile() && 'php' === strtolower( $file->getExtension() ) ) {
			$files[] = $file->getPathname();
		}
	}

	return $files;
}
