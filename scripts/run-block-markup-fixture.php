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
	public int $ID;
	public string $post_title;
	public string $post_content;
	public string $post_type;
	public string $post_status;

	public function __construct( string $title, string $content, array $args = array() ) {
		$this->ID           = (int) ( $args['ID'] ?? 1 );
		$this->post_title   = $title;
		$this->post_content = $content;
		$this->post_type    = (string) ( $args['post_type'] ?? 'page' );
		$this->post_status  = (string) ( $args['post_status'] ?? 'publish' );
	}
}

$GLOBALS['wp_gym_fixture_state'] = $fixture['wordpress_state'] ?? array();
$GLOBALS['wp_gym_fixture_posts'] = array();

foreach ( $GLOBALS['wp_gym_fixture_state']['posts'] ?? array() as $index => $post ) {
	$GLOBALS['wp_gym_fixture_posts'][] = new WP_Post(
		(string) ( $post['title'] ?? 'Fixture Post ' . ( $index + 1 ) ),
		(string) ( $post['content'] ?? '' ),
		array(
			'ID'          => $post['ID'] ?? ( $index + 1 ),
			'post_type'   => $post['post_type'] ?? 'page',
			'post_status' => $post['post_status'] ?? 'publish',
		)
	);
}

if ( empty( $GLOBALS['wp_gym_fixture_posts'] ) ) {
	$GLOBALS['wp_gym_fixture_posts'][] = new WP_Post( $title, $content );
}

function get_posts( array $args ): array {
	$posts = $GLOBALS['wp_gym_fixture_posts'];

	if ( isset( $args['post_type'] ) ) {
		$allowed = (array) $args['post_type'];
		$posts   = array_values(
			array_filter(
				$posts,
				static fn( WP_Post $post ): bool => in_array( $post->post_type, $allowed, true )
			)
		);
	}

	if ( isset( $args['title'] ) ) {
		$posts = array_values(
			array_filter(
				$posts,
				static fn( WP_Post $post ): bool => $post->post_title === $args['title']
			)
		);
	}

	return $posts;
}

function get_option( string $name ) {
	if ( 'page_on_front' === $name ) {
		return $GLOBALS['wp_gym_fixture_state']['page_on_front'] ?? 0;
	}

	return null;
}

function get_post( int $id ) {
	foreach ( $GLOBALS['wp_gym_fixture_posts'] as $post ) {
		if ( $post->ID === $id ) {
			return $post;
		}
	}

	return null;
}

function has_nav_menu( string $location ): bool {
	return 'primary' === $location && ! empty( $GLOBALS['wp_gym_fixture_state']['has_primary_nav_menu'] );
}

function wp_is_block_theme(): bool {
	return ! empty( $GLOBALS['wp_gym_fixture_state']['is_block_theme'] );
}

function get_stylesheet_directory(): string {
	return ! empty( $GLOBALS['wp_gym_fixture_state']['has_theme_json'] ) ? __DIR__ . '/fixture-theme-with-theme-json' : __DIR__;
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

function parse_blocks( string $content ): array {
	preg_match_all( '/<!--\s+(\/)?wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+[^>]*)?-->/', $content, $matches, PREG_OFFSET_CAPTURE );
	if ( empty( $matches[0] ) ) {
		return '' === trim( $content ) ? array() : array(
			array(
				'blockName'   => null,
				'innerHTML'   => $content,
				'innerBlocks' => array(),
			),
		);
	}

	$root  = array();
	$stack = array();

	foreach ( $matches[0] as $index => $match ) {
		$is_close = '/' === $matches[1][ $index ][0];
		$name     = wp_gym_fixture_block_name( $matches[2][ $index ][0] );
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
		$block = array_pop( $stack );
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

class WP_Block_Type_Registry {
	private static ?WP_Block_Type_Registry $instance = null;

	public static function get_instance(): WP_Block_Type_Registry {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	public function is_registered( string $name ): bool {
		$registered = $GLOBALS['wp_gym_fixture_state']['registered_blocks'] ?? array(
			'core/paragraph',
			'core/heading',
			'core/buttons',
			'core/button',
			'core/group',
			'core/columns',
			'core/column',
			'core/navigation',
			'core/html',
		);

		return in_array( $name, $registered, true );
	}
}

$grader_file = $repo_root . DIRECTORY_SEPARATOR . $fixture['grader_file'];
$grader      = require $grader_file;
$result      = $grader();

echo json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n";
