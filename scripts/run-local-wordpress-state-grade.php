<?php

if ( 3 !== $argc ) {
	fwrite( STDERR, "Usage: php scripts/run-local-wordpress-state-grade.php <grader.php> <state.json>\n" );
	exit( 2 );
}

$grader_file = $argv[1];
$state_file  = $argv[2];
$state       = json_decode( file_get_contents( $state_file ), true );

if ( ! is_array( $state ) ) {
	fwrite( STDERR, "Invalid state JSON: {$state_file}\n" );
	exit( 2 );
}

class WP_Post {
	public int $ID;
	public string $post_type;
	public string $post_status;
	public string $post_title;
	public string $post_content;

	public function __construct( array $post ) {
		$this->ID           = (int) ( $post['ID'] ?? 0 );
		$this->post_type    = (string) ( $post['post_type'] ?? 'post' );
		$this->post_status  = (string) ( $post['post_status'] ?? 'publish' );
		$this->post_title   = (string) ( $post['post_title'] ?? '' );
		$this->post_content = (string) ( $post['post_content'] ?? '' );
	}
}

$GLOBALS['wp_gym_local_posts'] = array_map(
	static fn( $post ) => new WP_Post( is_array( $post ) ? $post : array() ),
	$state['posts'] ?? array()
);

function get_posts( array $args ): array {
	$posts = $GLOBALS['wp_gym_local_posts'];

	return array_values(
		array_filter(
			$posts,
			static function ( WP_Post $post ) use ( $args ): bool {
				if ( isset( $args['title'] ) && $post->post_title !== $args['title'] ) {
					return false;
				}

				if ( isset( $args['post_type'] ) ) {
					$post_types = (array) $args['post_type'];
					if ( ! in_array( $post->post_type, $post_types, true ) ) {
						return false;
					}
				}

				if ( isset( $args['post_status'] ) && 'any' !== $args['post_status'] ) {
					$post_statuses = (array) $args['post_status'];
					if ( ! in_array( $post->post_status, $post_statuses, true ) ) {
						return false;
					}
				}

				return true;
			}
		)
	);
}

function has_blocks( string $content ): bool {
	return preg_match( '/<!--\s+wp:/', $content ) === 1;
}

function wp_strip_all_tags( string $text ): string {
	return strip_tags( $text );
}

function wp_gym_local_block_name( string $name ): string {
	return str_contains( $name, '/' ) ? $name : 'core/' . $name;
}

function parse_blocks( string $content ): array {
	preg_match_all( '/<!--\s+(\/)?wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+[^>]*)?-->/', $content, $matches, PREG_OFFSET_CAPTURE );

	$root  = array();
	$stack = array();

	foreach ( $matches[0] as $index => $match ) {
		$is_close = '/' === $matches[1][ $index ][0];
		$name     = wp_gym_local_block_name( $matches[2][ $index ][0] );
		$offset   = $match[1];

		if ( ! $is_close ) {
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
		}
	}

	while ( ! empty( $stack ) ) {
		$block              = array_pop( $stack );
		$block['innerHTML'] = substr( $content, $block['contentStart'] );
		unset( $block['contentStart'] );

		if ( ! empty( $stack ) ) {
			$parent_index = count( $stack ) - 1;
			$stack[ $parent_index ]['innerBlocks'][] = $block;
		} else {
			$root[] = $block;
		}
	}

	return $root;
}

$grader = require $grader_file;
$result = $grader();

echo json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n";
