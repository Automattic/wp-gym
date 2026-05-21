<?php

require_once __DIR__ . '/../failure-reasons.php';

return static function (): array {
	$show_on_front = (string) get_option( 'show_on_front' );
	$page_on_front  = (int) get_option( 'page_on_front' );
	$final_answer   = wp_gym_investigation_final_answer_text();
	$tool_evidence  = wp_gym_investigation_tool_evidence_text();

	$lower_answer  = strtolower( $final_answer );
	$lower_tools   = strtolower( $tool_evidence );
	$has_answer    = '' !== trim( $final_answer );
	$used_wp_cli   = false !== strpos( $lower_tools, 'run_wp_cli' )
		|| false !== strpos( $lower_tools, 'wp option get' )
		|| false !== strpos( $lower_answer, 'wp option get' );

	$show_on_front_reported = false !== strpos( $lower_answer, 'show_on_front' )
		&& (
			false !== strpos( $lower_answer, $show_on_front )
			|| ( 'posts' === $show_on_front && false !== strpos( $lower_answer, 'latest posts' ) )
			|| ( 'posts' === $show_on_front && false !== strpos( $lower_answer, 'blog posts' ) )
		);

	$page_on_front_reported = false !== strpos( $lower_answer, 'page_on_front' )
		&& (
			false !== strpos( $lower_answer, (string) $page_on_front )
			|| ( 0 === $page_on_front && false !== strpos( $lower_answer, 'unset' ) )
			|| ( 0 === $page_on_front && false !== strpos( $lower_answer, 'not set' ) )
			|| ( 0 === $page_on_front && false !== strpos( $lower_answer, 'no static page' ) )
		);

	$diagnosis_correct = false !== strpos( $lower_answer, 'latest posts' )
		|| false !== strpos( $lower_answer, 'blog posts' )
		|| false !== strpos( $lower_answer, 'posts page' );

	$remediation_present = false !== strpos( $lower_answer, 'show_on_front' )
		&& false !== strpos( $lower_answer, 'page_on_front' )
		&& (
			false !== strpos( $lower_answer, 'static' )
			|| false !== strpos( $lower_answer, 'front page' )
			|| false !== strpos( $lower_answer, 'set' )
		);

	$checks = array(
		array(
			'id'        => 'final_answer_available',
			'passed'    => $has_answer,
			'score'     => $has_answer ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => $has_answer ? 'Final answer artifact was available.' : 'Expected a final answer artifact for investigation grading.',
		),
		array(
			'id'        => 'used_wp_cli',
			'passed'    => $used_wp_cli,
			'score'     => $used_wp_cli ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => $used_wp_cli ? 'Answer or episode evidence shows WP-CLI usage.' : 'Expected command-derived WP-CLI evidence.',
		),
		array(
			'id'        => 'show_on_front_reported',
			'passed'    => $show_on_front_reported,
			'score'     => $show_on_front_reported ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => $show_on_front_reported ? 'Answer reported the current show_on_front value.' : 'Expected final answer to cite show_on_front=' . $show_on_front . '.',
		),
		array(
			'id'        => 'page_on_front_reported',
			'passed'    => $page_on_front_reported,
			'score'     => $page_on_front_reported ? 0.15 : 0,
			'max_score' => 0.15,
			'message'   => $page_on_front_reported ? 'Answer reported the current page_on_front value.' : 'Expected final answer to cite page_on_front=' . $page_on_front . '.',
		),
		array(
			'id'        => 'diagnosis_correct',
			'passed'    => $diagnosis_correct,
			'score'     => $diagnosis_correct ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => $diagnosis_correct ? 'Answer explains the homepage is using the latest posts/blog listing behavior.' : 'Expected answer to identify latest-posts homepage behavior.',
		),
		array(
			'id'        => 'static_homepage_remediation',
			'passed'    => $remediation_present,
			'score'     => $remediation_present ? 0.15 : 0,
			'max_score' => 0.15,
			'message'   => $remediation_present ? 'Answer explains how to switch to a static homepage.' : 'Expected remediation mentioning show_on_front/page_on_front static homepage settings.',
		),
	);

	return wp_gym_investigation_grade( $checks );
};

function wp_gym_investigation_final_answer_text(): string {
	$text = wp_gym_investigation_env_text(
		array(
			'WP_GYM_FINAL_RESPONSE',
			'WP_GYM_AGENT_FINAL_RESPONSE',
			'HOMEBOY_FINAL_RESPONSE',
		),
		array(
			'WP_GYM_FINAL_RESPONSE_FILE',
			'WP_GYM_AGENT_FINAL_RESPONSE_FILE',
			'HOMEBOY_FINAL_RESPONSE_FILE',
		)
	);

	if ( '' !== $text ) {
		return $text;
	}

	return wp_gym_investigation_artifact_text(
		array(
			'final-response.txt',
			'final_response.txt',
			'final-response.md',
			'final_response.md',
			'agent-final-response.md',
		)
	);
}

function wp_gym_investigation_tool_evidence_text(): string {
	$text = wp_gym_investigation_env_text(
		array(
			'WP_GYM_TOOL_SUMMARY_JSON',
			'HOMEBOY_TOOL_SUMMARY_JSON',
		),
		array(
			'WP_GYM_EPISODE_JSONL_FILE',
			'WP_GYM_EPISODE_JSONL',
			'HOMEBOY_EPISODE_JSONL_FILE',
			'HOMEBOY_TOOL_SUMMARY_JSON_FILE',
		)
	);

	if ( '' !== $text ) {
		return $text;
	}

	return wp_gym_investigation_artifact_text(
		array(
			'episode.jsonl',
			'episode_jsonl.jsonl',
			'tool-summary.json',
			'tool_summary.json',
		)
	);
}

function wp_gym_investigation_env_text( array $text_envs, array $file_envs ): string {
	$chunks = array();

	foreach ( $text_envs as $env ) {
		$value = getenv( $env );
		if ( is_string( $value ) && '' !== trim( $value ) ) {
			$chunks[] = $value;
		}
	}

	foreach ( $file_envs as $env ) {
		$value = getenv( $env );
		if ( is_string( $value ) && '' !== trim( $value ) ) {
			$chunks[] = wp_gym_investigation_read_file( $value );
		}
	}

	return trim( implode( "\n", array_filter( $chunks ) ) );
}

function wp_gym_investigation_artifact_text( array $relative_paths ): string {
	$artifact_dir = getenv( 'WP_GYM_ARTIFACT_DIR' ) ?: getenv( 'HOMEBOY_ARTIFACT_DIR' );
	if ( ! is_string( $artifact_dir ) || '' === trim( $artifact_dir ) ) {
		return '';
	}

	$chunks = array();
	foreach ( $relative_paths as $relative_path ) {
		$chunks[] = wp_gym_investigation_read_file( rtrim( $artifact_dir, '/\\' ) . DIRECTORY_SEPARATOR . $relative_path );
	}

	return trim( implode( "\n", array_filter( $chunks ) ) );
}

function wp_gym_investigation_read_file( string $path ): string {
	if ( '' === trim( $path ) || ! is_readable( $path ) || ! is_file( $path ) ) {
		return '';
	}

	$content = file_get_contents( $path );

	return false === $content ? '' : $content;
}

function wp_gym_investigation_grade( array $checks ): array {
	$score           = 0.0;
	$max_score       = 0.0;
	$failure_reasons = array();

	$checks = wp_gym_add_failure_reasons_to_checks( $checks );

	foreach ( $checks as &$check ) {
		$check['passed']    = ! empty( $check['passed'] );
		$check['score']     = (float) ( $check['score'] ?? 0 );
		$check['max_score'] = (float) ( $check['max_score'] ?? 0 );
		$score             += $check['score'];
		$max_score         += $check['max_score'];

		if ( ! $check['passed'] && ! empty( $check['failure_reason'] ) ) {
			$failure_reasons[] = $check['failure_reason'];
		}
	}
	unset( $check );

	$reward = $max_score > 0 ? $score / $max_score : 0;

	return array(
		'success'         => $reward >= 1,
		'reward'          => $reward,
		'failure_reasons' => array_values( array_unique( $failure_reasons ) ),
		'grade'           => array(
			'score'     => $score,
			'max_score' => $max_score,
			'checks'    => $checks,
		),
	);
}

function wp_gym_investigation_failure_reason_for_check( array $check ): string {
	return wp_gym_failure_reason_for_check_id( (string) ( $check['id'] ?? '' ) );
}
