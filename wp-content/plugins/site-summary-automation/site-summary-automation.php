<?php
/**
 * Plugin Name: Site Summary Automation
 * Description: Registers a site summary ability for automation tools.
 * Version: 1.0.0
 * Author: OpenAI
 */

if (!defined('ABSPATH')) {
    exit;
}

function site_summary_automation_register_category($categories) {
    if (!is_array($categories)) {
        $categories = array();
    }

    $categories['site-tools'] = array(
        'label'       => __('Site Tools', 'site-summary-automation'),
        'description' => __('Tools for summarizing the current WordPress site.', 'site-summary-automation'),
    );

    return $categories;
}
add_action('wp_abilities_api_categories_init', 'site_summary_automation_register_category');

function site_summary_automation_register_ability() {
    if (!function_exists('wp_register_ability')) {
        return;
    }

    wp_register_ability(
        'site-tools/site-summary',
        array(
            'label'       => __('Site Summary', 'site-summary-automation'),
            'description' => __('Returns the current site name and the number of published posts.', 'site-summary-automation'),
            'category'    => 'site-tools',
            'callback'    => 'site_summary_automation_run_site_summary',
        )
    );
}
add_action('wp_abilities_api_init', 'site_summary_automation_register_ability');

function site_summary_automation_run_site_summary() {
    $site_name = get_bloginfo('name');
    $published_posts = (int) wp_count_posts('post')->publish;

    return array(
        'site_name' => $site_name,
        'published_posts' => $published_posts,
    );
}
