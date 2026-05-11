<?php

return static function (): array {
    $page_id = wp_insert_post([
        'post_type' => 'page',
        'post_title' => 'Smoke Page',
        'post_status' => 'publish',
        'post_content' => '<!-- wp:paragraph --><p>A fresh WordPress page is ready to review.</p><!-- /wp:paragraph -->',
    ], true);

    if (is_wp_error($page_id)) {
        throw new RuntimeException($page_id->get_error_message());
    }

    return [
        'metadata' => [
            'created_page_id' => (int) $page_id,
        ],
    ];
};
