<?php

return static function (): array {
    $page = get_page_by_title('Smoke Eval', OBJECT, 'page');
    $has_page = $page instanceof WP_Post;
    $has_content = $has_page && str_contains($page->post_content, 'wp-rl smoke eval ready');

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

    $score = array_sum(array_column($checks, 'score'));

    return [
        'success' => $score >= 1,
        'reward' => $score,
        'done' => true,
        'grade' => [
            'max_score' => 1,
            'score' => $score,
            'checks' => $checks,
        ],
        'metadata' => [
            'scenario_id' => 'smoke-homepage',
        ],
    ];
};
