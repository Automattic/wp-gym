<?php

require_once __DIR__ . '/../graders/failure-reasons.php';

return static function (): array {
    $page = get_page_by_title('Smoke Page', OBJECT, 'page');
    $has_page = $page instanceof WP_Post;
    $has_content = $has_page && str_contains($page->post_content, 'A fresh WordPress page is ready to review.');

    $checks = [
        [
            'id' => 'page_created',
            'passed' => $has_page,
            'score' => $has_page ? 0.5 : 0,
            'max_score' => 0.5,
        ],
        [
            'id' => 'expected_block_content',
            'passed' => $has_content,
            'score' => $has_content ? 0.5 : 0,
            'max_score' => 0.5,
        ],
    ];

    $checks = wp_gym_add_failure_reasons_to_checks($checks);
    $score = array_sum(array_column($checks, 'score'));

    return [
        'success' => $score >= 1,
        'reward' => $score,
        'done' => true,
        'failure_reasons' => wp_gym_collect_failure_reasons($checks),
        'grade' => [
            'max_score' => 1,
            'score' => $score,
            'checks' => $checks,
        ],
        'metadata' => [
            'task_id' => 'smoke-homepage',
        ],
    ];
};
