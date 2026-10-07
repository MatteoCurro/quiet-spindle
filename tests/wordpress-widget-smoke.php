<?php
declare(strict_types=1);

define('ABSPATH', __DIR__);
define('WPMU_PLUGIN_DIR', dirname(__DIR__) . '/wordpress');

$GLOBALS['uv_shortcodes'] = [];
$GLOBALS['uv_rest_routes'] = [];
$GLOBALS['uv_styles'] = [];

function apply_filters($tag, $value) {
    if ($tag === 'wpml_current_language') return 'en';
    return $value;
}
function add_action($hook, $callback) {
    if (in_array($hook, ['init', 'rest_api_init'], true)) $callback();
}
function add_shortcode($tag, $callback) { $GLOBALS['uv_shortcodes'][$tag] = $callback; }
function shortcode_exists($tag) { return isset($GLOBALS['uv_shortcodes'][$tag]); }
function shortcode_atts($pairs, $atts, $shortcode = '') { return array_merge($pairs, $atts); }
function sanitize_text_field($value) { return trim(strip_tags((string)$value)); }
function sanitize_title($value) {
    $value = strtolower(trim((string)$value));
    $value = preg_replace('/[^a-z0-9]+/', '-', $value);
    return trim((string)$value, '-');
}
function get_queried_object() { return (object)['post_name' => 'test-article']; }
function determine_locale() { return 'it_IT'; }
function get_locale() { return 'it_IT'; }
function wp_enqueue_style($handle, $src, $deps = [], $ver = null) {
    $GLOBALS['uv_styles'][$handle] = [$src, $ver];
}
function plugins_url($path, $file) {
    return 'https://www.unlockvenice.com/wp-content/mu-plugins/uv-transport-shortcodes/' . ltrim((string)$path, '/');
}
function esc_url($value) { return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_attr($value) { return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_html($value) { return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function do_action($hook, ...$args) {}
function register_rest_route($namespace, $route, $args) {
    $GLOBALS['uv_rest_routes'][$namespace . $route] = $args;
}
function __return_true() { return true; }

require dirname(__DIR__) . '/wordpress/uv-transport-shortcodes/uv-transport-shortcodes.php';

function expect_true($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

expect_true(shortcode_exists('uv_route'), 'uv_route shortcode not registered');
expect_true(shortcode_exists('uv_transport_widget'), 'uv_transport_widget shortcode not registered');

$link = uv_transport_wp_route_shortcode(['to' => 'poi:uv_venice_san_marco']);
expect_true(str_contains($link, '/trasporti/go/p/uv_venice_san_marco?'), 'entity deep link missing');
expect_true(str_contains($link, 'lang=en'), 'WPML language not applied');
expect_true(str_contains($link, 'ref=wp_article'), 'wp_article attribution missing');
expect_true(str_contains($link, 'campaign=test-article'), 'article campaign missing');
expect_true(str_contains($link, 'from=current'), 'current origin missing');
expect_true(str_contains($link, 'Find route · St Mark&#039;s Square'), 'localized automatic label missing');

$de = uv_transport_wp_route_shortcode([
    'to' => 'poi:uv_venice_rialto_bridge',
    'lang' => 'de',
    'label' => 'Zum Rialto',
]);
expect_true(str_contains($de, 'lang=de'), 'explicit language override missing');
expect_true(str_contains($de, '>Zum Rialto</a>'), 'explicit label override missing');

$route = uv_transport_wp_route_shortcode(['route' => 'uv_mestre_station_san_marco']);
expect_true(str_contains($route, '/trasporti/go/r/uv_mestre_station_san_marco?'), 'stable route link missing');

$fromEntity = uv_transport_wp_route_shortcode([
    'from' => 'hub:uv_mestre_station',
    'to' => 'poi:uv_venice_san_marco',
]);
expect_true(str_contains($fromEntity, 'from=hub%3Auv_mestre_station'), 'stable origin entity missing');

expect_true(uv_transport_wp_route_shortcode(['to' => 'poi:missing']) === '', 'unknown entity must fail closed');
expect_true(uv_transport_wp_route_shortcode(['route' => 'missing']) === '', 'unknown route must fail closed');

$widget = uv_transport_wp_widget_shortcode(['destination' => 'poi:uv_venice_san_marco']);
expect_true(str_contains($widget, 'class="uv-transport-widget"'), 'widget wrapper missing');
expect_true(str_contains($widget, 'St Mark&#039;s Square'), 'widget destination missing');
expect_true(str_contains($widget, '>Find route</a>'), 'widget CTA missing');
expect_true(!str_contains($widget, '<script'), 'widget must remain server-side/no-JS');

expect_true(isset($GLOBALS['uv_styles']['uv-transport-shortcodes']), 'widget stylesheet not enqueued');

$health = $GLOBALS['uv_rest_routes']['uv-transport/v1/health'] ?? null;
expect_true(is_array($health) && is_callable($health['callback'] ?? null), 'health REST route missing');
$payload = $health['callback']();
expect_true(($payload['schemaVersion'] ?? null) === 1, 'health schema version mismatch');
expect_true(($payload['locales'] ?? 0) === 4, 'health locale count mismatch');
expect_true(($payload['entities'] ?? 0) >= 40, 'health entity count too low');
expect_true(($payload['routes'] ?? 0) >= 5, 'health route count too low');
expect_true(($payload['shortcodes']['uv_route'] ?? false) === true, 'health uv_route false');
expect_true(($payload['shortcodes']['uv_transport_widget'] ?? false) === true, 'health widget false');

echo "RESULT: WordPress shortcodes generate stable multilingual deep links, preserve attribution, fail closed on unknown IDs and render accessible no-JS output.\n";
