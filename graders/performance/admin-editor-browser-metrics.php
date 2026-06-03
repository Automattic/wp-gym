<?php

require_once __DIR__ . '/../failure-reasons.php';

return static function (): array {
	$final_answer  = wp_gym_performance_final_answer_text();
	$tool_evidence = wp_gym_performance_tool_evidence_text();
	$combined      = strtolower( $final_answer . "\n" . $tool_evidence );

	$has_answer = '' !== trim( $final_answer );
	$mentions_browser_metrics = false !== strpos( $combined, 'browser_metrics' )
		|| false !== strpos( $combined, 'browser metrics' )
		|| false !== strpos( $combined, 'wp-codebox/browser-metrics/v1' );
	$mentions_metric_values = false !== strpos( $combined, 'browser_resource_count' )
		|| false !== strpos( $combined, 'resource count' )
		|| false !== strpos( $combined, 'browser_transfer_size_bytes' )
		|| false !== strpos( $combined, 'transfer size' );
	$avoids_duration_guess = false === strpos( $combined, 'duration_ms is enough' )
		&& false === strpos( $combined, 'estimated from duration' );

	$checks = array(
		array(
			'id'        => 'final_answer_available',
			'passed'    => $has_answer,
			'score'     => $has_answer ? 0.2 : 0,
			'max_score' => 0.2,
			'message'   => $has_answer ? 'Final answer artifact was available.' : 'Expected a final answer artifact.',
		),
		array(
			'id'        => 'codebox_browser_metrics_referenced',
			'passed'    => $mentions_browser_metrics,
			'score'     => $mentions_browser_metrics ? 0.4 : 0,
			'max_score' => 0.4,
			'message'   => $mentions_browser_metrics ? 'Answer or evidence references Codebox browser metrics.' : 'Expected Codebox browser metrics evidence.',
		),
		array(
			'id'        => 'metric_values_reported',
			'passed'    => $mentions_metric_values,
			'score'     => $mentions_metric_values ? 0.3 : 0,
			'max_score' => 0.3,
			'message'   => $mentions_metric_values ? 'Answer reports concrete browser metric fields.' : 'Expected concrete metric fields such as resource count or transfer size.',
		),
		array(
			'id'        => 'no_duration_guess',
			'passed'    => $avoids_duration_guess,
			'score'     => $avoids_duration_guess ? 0.1 : 0,
			'max_score' => 0.1,
			'message'   => $avoids_duration_guess ? 'Answer does not substitute duration for browser metrics.' : 'Duration-only metric substitution is not accepted.',
		),
	);

	return wp_gym_investigation_grade( $checks );
};

function wp_gym_performance_final_answer_text(): string {
	return wp_gym_performance_env_text(
		array( 'WP_GYM_FINAL_RESPONSE', 'WP_GYM_AGENT_FINAL_RESPONSE', 'HOMEBOY_FINAL_RESPONSE' ),
		array( 'WP_GYM_FINAL_RESPONSE_FILE', 'WP_GYM_AGENT_FINAL_RESPONSE_FILE', 'HOMEBOY_FINAL_RESPONSE_FILE' )
	);
}

function wp_gym_performance_tool_evidence_text(): string {
	return wp_gym_performance_env_text(
		array( 'WP_GYM_TOOL_SUMMARY_JSON', 'HOMEBOY_TOOL_SUMMARY_JSON' ),
		array( 'WP_GYM_EPISODE_JSONL_FILE', 'WP_GYM_EPISODE_JSONL', 'HOMEBOY_EPISODE_JSONL_FILE', 'HOMEBOY_TOOL_SUMMARY_JSON_FILE' )
	);
}

function wp_gym_performance_env_text( array $text_envs, array $file_envs ): string {
	$chunks = array();
	foreach ( $text_envs as $env ) {
		$value = getenv( $env );
		if ( is_string( $value ) && '' !== trim( $value ) ) {
			$chunks[] = $value;
		}
	}
	foreach ( $file_envs as $env ) {
		$value = getenv( $env );
		if ( is_string( $value ) && '' !== trim( $value ) && is_readable( $value ) ) {
			$chunks[] = (string) file_get_contents( $value );
		}
	}
	return trim( implode( "\n", array_filter( $chunks ) ) );
}
