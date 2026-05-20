<?php

if ( 3 !== $argc ) {
	fwrite( STDERR, "Usage: php scripts/run-block-markup-fixture.php <fixture.json> <repo-root>\n" );
	exit( 2 );
}

$fixture_file = $argv[1];
$repo_root    = rtrim( $argv[2], DIRECTORY_SEPARATOR );
$fixture      = json_decode( file_get_contents( $fixture_file ), true );

if ( ! is_array( $fixture ) ) {
	fwrite( STDERR, "Invalid fixture JSON: {$fixture_file}\n" );
	exit( 2 );
}

$content = file_get_contents( $repo_root . DIRECTORY_SEPARATOR . $fixture['content_file'] );
$title   = $fixture['post_title'] ?? 'Simple Pricing Page';

class WP_Post {
	public string $post_title;
	public string $post_content;

	public function __construct( string $title, string $content ) {
		$this->post_title   = $title;
		$this->post_content = $content;
	}
}

$GLOBALS['wp_gym_fixture_post'] = new WP_Post( $title, $content );

function get_posts( array $args ): array {
	$post = $GLOBALS['wp_gym_fixture_post'];

	if ( isset( $args['title'] ) && $post->post_title !== $args['title'] ) {
		return array();
	}

	return array( $post );
}

function has_blocks( string $content ): bool {
	return preg_match( '/<!--\s+wp:/', $content ) === 1;
}

function wp_strip_all_tags( string $text ): string {
	return strip_tags( $text );
}

function wp_gym_fixture_block_name( string $name ): string {
	return str_contains( $name, '/' ) ? $name : 'core/' . $name;
}

function wp_gym_fixture_append_freeform_block( array &$blocks, string $html ): void {
	if ( '' === trim( $html ) ) {
		return;
	}

	$blocks[] = array(
		'blockName'   => null,
		'innerHTML'   => $html,
		'innerBlocks' => array(),
	);
}

function parse_blocks( string $content ): array {
	preg_match_all( '/<!--\s+(\/)?wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+[^>]*)?-->/', $content, $matches, PREG_OFFSET_CAPTURE );

	$root  = array();
	$stack = array();
	$cursor = 0;

	foreach ( $matches[0] as $index => $match ) {
		$is_close = '/' === $matches[1][ $index ][0];
		$name     = wp_gym_fixture_block_name( $matches[2][ $index ][0] );
		$offset   = $match[1];

		if ( ! $is_close ) {
			if ( empty( $stack ) ) {
				wp_gym_fixture_append_freeform_block( $root, substr( $content, $cursor, $offset - $cursor ) );
			}

			$stack[] = array(
				'blockName'    => $name,
				'innerHTML'    => '',
				'innerBlocks'  => array(),
				'contentStart' => $offset + strlen( $match[0] ),
			);
			continue;
		}

		$block = array_pop( $stack );
		if ( ! is_array( $block ) ) {
			continue;
		}

		$block['innerHTML'] = substr( $content, $block['contentStart'], $offset - $block['contentStart'] );
		unset( $block['contentStart'] );

		if ( ! empty( $stack ) ) {
			$parent_index = count( $stack ) - 1;
			$stack[ $parent_index ]['innerBlocks'][] = $block;
		} else {
			$root[] = $block;
			$cursor = $offset + strlen( $match[0] );
		}
	}

	while ( ! empty( $stack ) ) {
		$block = array_pop( $stack );
		$block['innerHTML'] = substr( $content, $block['contentStart'] );
		unset( $block['contentStart'] );

		if ( ! empty( $stack ) ) {
			$parent_index = count( $stack ) - 1;
			$stack[ $parent_index ]['innerBlocks'][] = $block;
		} else {
			$root[] = $block;
			$cursor = strlen( $content );
		}
	}

	wp_gym_fixture_append_freeform_block( $root, substr( $content, $cursor ) );

	return $root;
}

$grader_file = $repo_root . DIRECTORY_SEPARATOR . $fixture['grader_file'];
$grader      = require $grader_file;
$result      = $grader();

echo json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n";
