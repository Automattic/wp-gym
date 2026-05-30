<?php

require_once __DIR__ . '/../failure-reasons.php';
require_once __DIR__ . '/../modern-wordpress-api/grader-common.php';

return function (): array {
	$checks = array();

	if ( function_exists( 'do_action' ) ) {
		do_action( 'admin_init' );
		do_action( 'admin_menu' );
	}

	$registered_settings = isset( $GLOBALS['wp_registered_settings'] ) && is_array( $GLOBALS['wp_registered_settings'] )
		? $GLOBALS['wp_registered_settings']
		: array();
	$setting             = $registered_settings['wp_gym_neighborhood_notice'] ?? null;
	$setting_registered  = is_array( $setting );
	$checks[]            = array(
		'id'        => 'setting_registered',
		'passed'    => $setting_registered,
		'score'     => $setting_registered ? 0.14 : 0,
		'max_score' => 0.14,
		'message'   => $setting_registered ? 'The wp_gym_neighborhood_notice setting is registered.' : 'Expected register_setting() for wp_gym_neighborhood_notice.',
	);

	$sanitize_callback = $setting['sanitize_callback'] ?? null;
	$has_sanitizer     = is_callable( $sanitize_callback );
	$checks[]          = array(
		'id'        => 'setting_sanitize_callback',
		'passed'    => $has_sanitizer,
		'score'     => $has_sanitizer ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $has_sanitizer ? 'The setting declares a callable sanitize_callback.' : 'Expected a callable sanitize_callback for the notice setting.',
	);

	$sanitized_ok = false;
	if ( $has_sanitizer ) {
		$sanitized    = (string) call_user_func( $sanitize_callback, '<script>alert(1)</script>Weekly <strong>market</strong> notice' );
		$sanitized_ok = false === stripos( $sanitized, '<script' )
			&& false === stripos( $sanitized, '<strong' )
			&& false !== stripos( $sanitized, 'Weekly' )
			&& false !== stripos( $sanitized, 'market' );
	}
	$checks[] = array(
		'id'        => 'setting_sanitizes_markup',
		'passed'    => $sanitized_ok,
		'score'     => $sanitized_ok ? 0.14 : 0,
		'max_score' => 0.14,
		'message'   => $sanitized_ok ? 'The sanitize callback strips markup while preserving text.' : 'Expected the sanitize callback to strip script/HTML markup and preserve notice text.',
	);

	$submenu = $GLOBALS['submenu']['options-general.php'] ?? array();
	$admin_page_registered = false;
	$admin_capability_ok   = false;
	foreach ( $submenu as $item ) {
		$title = isset( $item[0] ) ? wp_strip_all_tags( (string) $item[0] ) : '';
		$cap   = isset( $item[1] ) ? (string) $item[1] : '';
		$slug  = isset( $item[2] ) ? (string) $item[2] : '';
		if ( false !== stripos( $title, 'Notice' ) || false !== stripos( $slug, 'notice' ) ) {
			$admin_page_registered = true;
			$admin_capability_ok   = 'manage_options' === $cap;
			break;
		}
	}
	$checks[] = array(
		'id'        => 'admin_page_registered',
		'passed'    => $admin_page_registered,
		'score'     => $admin_page_registered ? 0.14 : 0,
		'max_score' => 0.14,
		'message'   => $admin_page_registered ? 'A notice settings page is registered under Settings.' : 'Expected a notice settings page under options-general.php.',
	);
	$checks[] = array(
		'id'        => 'admin_page_manage_options_capability',
		'passed'    => $admin_capability_ok,
		'score'     => $admin_capability_ok ? 0.12 : 0,
		'max_score' => 0.12,
		'message'   => $admin_capability_ok ? 'The admin page is gated by manage_options.' : 'Expected the admin settings page to require manage_options.',
	);

	$shortcode_registered = shortcode_exists( 'neighborhood_notice' );
	$checks[]             = array(
		'id'        => 'notice_shortcode_registered',
		'passed'    => $shortcode_registered,
		'score'     => $shortcode_registered ? 0.1 : 0,
		'max_score' => 0.1,
		'message'   => $shortcode_registered ? 'The neighborhood_notice shortcode is registered.' : 'Expected a neighborhood_notice shortcode.',
	);

	update_option( 'wp_gym_neighborhood_notice', 'Fresh <b>greens</b> & flowers' );
	$output         = $shortcode_registered ? do_shortcode( '[neighborhood_notice]' ) : '';
	$shortcode_safe = false !== strpos( $output, 'Fresh' )
		&& false !== strpos( $output, 'greens' )
		&& false !== strpos( $output, '&amp;' )
		&& false === strpos( $output, '<b>' )
		&& false === strpos( $output, '<script' );
	$checks[]       = array(
		'id'        => 'shortcode_outputs_escaped_notice',
		'passed'    => $shortcode_safe,
		'score'     => $shortcode_safe ? 0.14 : 0,
		'max_score' => 0.14,
		'message'   => $shortcode_safe ? 'The shortcode outputs the saved notice with escaping.' : 'Expected the shortcode to display the saved notice without raw markup.',
	);

	$checks[] = wp_gym_modern_api_plugin_author_supported_check(
		array( 'wp_gym_neighborhood_notice', 'neighborhood_notice', 'add_options_page', 'register_setting' ),
		null,
		0.05
	);

	$checks[] = wp_gym_check_no_speculative_plugin_packaging_metadata( array( 'max_score' => 0.05 ) );

	$score     = array_sum( array_map( static fn( $check ) => (float) ( $check['score'] ?? 0 ), $checks ) );
	$max_score = array_sum( array_map( static fn( $check ) => (float) ( $check['max_score'] ?? 0 ), $checks ) );
	$reward    = $max_score > 0 ? round( $score / $max_score, 4 ) : 0.0;
	$checks    = wp_gym_add_failure_reasons_to_checks(
		$checks,
		array(
			'setting_registered'                    => 'missing_setting_registration',
			'setting_sanitize_callback'             => 'missing_setting_sanitizer',
			'setting_sanitizes_markup'              => 'unsafe_setting_sanitization',
			'admin_page_registered'                 => 'missing_admin_settings_page',
			'admin_page_manage_options_capability'  => 'missing_admin_capability_gate',
			'notice_shortcode_registered'           => 'missing_frontend_notice_shortcode',
			'shortcode_outputs_escaped_notice'      => 'unsafe_frontend_output',
		)
	);

	return array(
		'success'         => $reward >= 1.0,
		'reward'          => $reward,
		'grade'           => array(
			'checks'    => $checks,
			'score'     => $score,
			'max_score' => $max_score,
		),
		'failure_reasons' => wp_gym_collect_failure_reasons( $checks ),
	);
};
