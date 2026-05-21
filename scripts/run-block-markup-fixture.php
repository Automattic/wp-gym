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

if ( isset( $fixture['fixture_runtime'] ) && 'modern_wordpress_api' === $fixture['fixture_runtime'] ) {
	$GLOBALS['wp_gym_fixture_actions']            = array();
	$GLOBALS['wp_gym_fixture_current_actions']    = array();
	$GLOBALS['wp_gym_fixture_done_actions']       = array();
	$GLOBALS['wp_gym_fixture_rest_routes']        = array();
	$GLOBALS['wp_gym_fixture_abilities']          = array();
	$GLOBALS['wp_gym_fixture_ability_categories'] = array();

	function add_action( string $hook_name, callable $callback ): void {
		$GLOBALS['wp_gym_fixture_actions'][ $hook_name ][] = $callback;
	}

	function do_action( string $hook_name ): void {
		$GLOBALS['wp_gym_fixture_current_actions'][] = $hook_name;
		$GLOBALS['wp_gym_fixture_done_actions'][ $hook_name ] = ( $GLOBALS['wp_gym_fixture_done_actions'][ $hook_name ] ?? 0 ) + 1;

		foreach ( $GLOBALS['wp_gym_fixture_actions'][ $hook_name ] ?? array() as $callback ) {
			$callback();
		}

		array_pop( $GLOBALS['wp_gym_fixture_current_actions'] );
	}

	function did_action( string $hook_name ): int {
		return $GLOBALS['wp_gym_fixture_done_actions'][ $hook_name ] ?? 0;
	}

	function doing_action( string $hook_name ): bool {
		return in_array( $hook_name, $GLOBALS['wp_gym_fixture_current_actions'], true );
	}

	function __return_true(): bool {
		return true;
	}

	function get_bloginfo( string $show = '' ): string {
		return 'name' === $show ? 'WP Gym Fixture Site' : '';
	}

	function wp_count_posts( string $post_type = 'post' ): object {
		return (object) array( 'publish' => 'post' === $post_type ? 2 : 0 );
	}

	class WP_Gym_Fixture_Rest_Server {
		public function get_routes(): array {
			return $GLOBALS['wp_gym_fixture_rest_routes'];
		}
	}

	class WP_REST_Request {
		public string $method;
		public string $route;

		public function __construct( string $method, string $route ) {
			$this->method = strtoupper( $method );
			$this->route  = $route;
		}
	}

	class WP_REST_Response {
		private mixed $data;
		private int $status;

		public function __construct( mixed $data = null, int $status = 200 ) {
			$this->data   = $data;
			$this->status = $status;
		}

		public function get_status(): int {
			return $this->status;
		}

		public function get_data(): mixed {
			return $this->data;
		}
	}

	function rest_get_server(): WP_Gym_Fixture_Rest_Server {
		return new WP_Gym_Fixture_Rest_Server();
	}

	function wp_gym_fixture_rest_methods( mixed $methods ): array {
		$methods = is_array( $methods ) ? $methods : explode( ',', (string) $methods );
		$normalized = array();

		foreach ( $methods as $method ) {
			$normalized[ strtoupper( trim( (string) $method ) ) ] = true;
		}

		return $normalized;
	}

	function register_rest_route( string $route_namespace, string $route, array $args = array(), bool $override = false ): bool {
		$full_route = '/' . trim( $route_namespace, '/' ) . '/' . trim( $route, '/' );
		$handlers = isset( $args['callback'] ) || isset( $args['methods'] ) ? array( $args ) : $args;

		foreach ( $handlers as $handler ) {
			if ( ! is_array( $handler ) ) {
				continue;
			}

			$handler['methods'] = wp_gym_fixture_rest_methods( $handler['methods'] ?? 'GET' );
			$GLOBALS['wp_gym_fixture_rest_routes'][ $full_route ][] = $handler;
		}

		return true;
	}

	function rest_do_request( WP_REST_Request $request ): WP_REST_Response {
		foreach ( $GLOBALS['wp_gym_fixture_rest_routes'][ $request->route ] ?? array() as $handler ) {
			if ( empty( $handler['methods'][ $request->method ] ) ) {
				continue;
			}

			if ( isset( $handler['permission_callback'] ) && false === call_user_func( $handler['permission_callback'], $request ) ) {
				return new WP_REST_Response( array( 'code' => 'rest_forbidden' ), 403 );
			}

			$data = isset( $handler['callback'] ) && is_callable( $handler['callback'] ) ? call_user_func( $handler['callback'], $request ) : null;

			return $data instanceof WP_REST_Response ? $data : new WP_REST_Response( $data, 200 );
		}

		return new WP_REST_Response( array( 'code' => 'rest_no_route' ), 404 );
	}

	class WP_Gym_Fixture_Ability {
		private array $args;

		public function __construct( array $args ) {
			$this->args = $args;
		}

		public function execute( array $input = array() ): mixed {
			if ( isset( $this->args['permission_callback'] ) && false === call_user_func( $this->args['permission_callback'], $input ) ) {
				return null;
			}

			return call_user_func( $this->args['execute_callback'], $input );
		}
	}

	function wp_register_ability_category( string $slug, array $args ): ?object {
		if ( ! doing_action( 'wp_abilities_api_categories_init' ) ) {
			return null;
		}

		$GLOBALS['wp_gym_fixture_ability_categories'][ $slug ] = (object) $args;

		return $GLOBALS['wp_gym_fixture_ability_categories'][ $slug ];
	}

	function wp_get_ability_category( string $slug ): ?object {
		return $GLOBALS['wp_gym_fixture_ability_categories'][ $slug ] ?? null;
	}

	function wp_register_ability( string $name, array $args ): ?WP_Gym_Fixture_Ability {
		if ( ! doing_action( 'wp_abilities_api_init' ) || empty( $args['execute_callback'] ) || ! is_callable( $args['execute_callback'] ) ) {
			return null;
		}

		$GLOBALS['wp_gym_fixture_abilities'][ $name ] = new WP_Gym_Fixture_Ability( $args );

		return $GLOBALS['wp_gym_fixture_abilities'][ $name ];
	}

	function wp_get_ability( string $name ): ?WP_Gym_Fixture_Ability {
		return $GLOBALS['wp_gym_fixture_abilities'][ $name ] ?? null;
	}

	$source_file = $repo_root . DIRECTORY_SEPARATOR . $fixture['content_file'];
	$agent_root  = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'wp-gym-fixture-' . md5( $fixture_file );
	if ( ! is_dir( $agent_root ) ) {
		mkdir( $agent_root, 0777, true );
	}
	$agent_file = $agent_root . DIRECTORY_SEPARATOR . basename( $source_file );
	copy( $source_file, $agent_file );
	putenv( 'WP_GYM_AGENT_ROOT=' . $agent_root );
	require $agent_file;
	do_action( 'rest_api_init' );

	$grader_file = $repo_root . DIRECTORY_SEPARATOR . $fixture['grader_file'];
	$grader      = require $grader_file;
	$result      = $grader();

	echo json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n";
	exit( 0 );
}

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
