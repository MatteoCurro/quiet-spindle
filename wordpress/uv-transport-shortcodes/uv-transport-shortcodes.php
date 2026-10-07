<?php
/**
 * Plugin Name: U.Venice Transport Shortcodes
 * Description: Server-side Unlock Venice transport links and compact widgets backed by the U.Venice entity catalog.
 * Version: 1.0.0
 * Author: Unlock Venice
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

const UV_TRANSPORT_SHORTCODES_VERSION = '1.0.0';

function uv_transport_wp_catalog_path(): string {
    $path = __DIR__ . '/data/catalog.json';
    return (string) apply_filters('uv_transport_catalog_path', $path);
}

function uv_transport_wp_catalog(): array {
    static $catalog = null;
    if (is_array($catalog)) {
        return $catalog;
    }

    $path = uv_transport_wp_catalog_path();
    if (!is_readable($path)) {
        $catalog = [];
        return $catalog;
    }

    $decoded = json_decode((string) file_get_contents($path), true);
    if (
        !is_array($decoded)
        || ($decoded['schemaVersion'] ?? null) !== 1
        || !is_array($decoded['entities'] ?? null)
        || !is_array($decoded['routes'] ?? null)
    ) {
        $catalog = [];
        return $catalog;
    }

    $catalog = $decoded;
    return $catalog;
}

function uv_transport_wp_normalize_lang(string $value): string {
    $value = strtolower(trim($value));
    if ($value === '') {
        return '';
    }
    $value = preg_split('/[-_]/', $value)[0] ?? '';
    return in_array($value, ['it', 'en', 'fr', 'de'], true) ? $value : '';
}

function uv_transport_wp_current_lang(string $override = ''): string {
    $explicit = uv_transport_wp_normalize_lang($override);
    if ($explicit !== '') {
        return $explicit;
    }

    $wpml = apply_filters('wpml_current_language', null);
    if (is_string($wpml)) {
        $normalized = uv_transport_wp_normalize_lang($wpml);
        if ($normalized !== '') {
            return $normalized;
        }
    }

    if (defined('ICL_LANGUAGE_CODE')) {
        $normalized = uv_transport_wp_normalize_lang((string) ICL_LANGUAGE_CODE);
        if ($normalized !== '') {
            return $normalized;
        }
    }

    if (function_exists('pll_current_language')) {
        $polylang = pll_current_language('slug');
        if (is_string($polylang)) {
            $normalized = uv_transport_wp_normalize_lang($polylang);
            if ($normalized !== '') {
                return $normalized;
            }
        }
    }

    $locale = function_exists('determine_locale') ? determine_locale() : get_locale();
    $normalized = uv_transport_wp_normalize_lang((string) $locale);
    return $normalized !== '' ? $normalized : 'it';
}

function uv_transport_wp_campaign(): string {
    $object = function_exists('get_queried_object') ? get_queried_object() : null;
    $slug = '';

    if (is_object($object) && isset($object->post_name) && is_string($object->post_name)) {
        $slug = $object->post_name;
    } elseif (function_exists('get_post')) {
        $post = get_post();
        if (is_object($post) && isset($post->post_name) && is_string($post->post_name)) {
            $slug = $post->post_name;
        }
    }

    return $slug !== '' ? sanitize_title($slug) : '';
}

function uv_transport_wp_text(array $catalog, string $lang, string $key): string {
    $value = $catalog['strings'][$lang][$key] ?? '';
    return is_string($value) && trim($value) !== '' ? trim($value) : '';
}

function uv_transport_wp_entity(array $catalog, string $id): ?array {
    $entity = $catalog['entities'][$id] ?? null;
    return is_array($entity) ? $entity : null;
}

function uv_transport_wp_route(array $catalog, string $id): ?array {
    $route = $catalog['routes'][$id] ?? null;
    return is_array($route) ? $route : null;
}

function uv_transport_wp_localized_name(array $item, string $lang): string {
    $name = $item['names'][$lang] ?? $item['names']['it'] ?? '';
    return is_string($name) ? trim($name) : '';
}

function uv_transport_wp_url(array $params): string {
    $catalog = uv_transport_wp_catalog();
    if (!$catalog) {
        return '';
    }

    $lang = uv_transport_wp_current_lang((string) ($params['lang'] ?? ''));
    $campaign = uv_transport_wp_campaign();
    $mode = strtolower(trim((string) ($params['mode'] ?? '')));
    if (!in_array($mode, ['', 'all', 'aut', 'nav'], true)) {
        return '';
    }

    $query = [
        'lang' => $lang,
        'ref' => 'wp_article',
    ];
    if ($campaign !== '') {
        $query['campaign'] = $campaign;
    }
    if ($mode !== '' && $mode !== 'all') {
        $query['mode'] = $mode;
    }

    $base = rtrim((string) ($catalog['operationalBase'] ?? ''), '/');
    if ($base === '') {
        return '';
    }

    $routeId = trim((string) ($params['route'] ?? ''));
    $to = trim((string) ($params['to'] ?? ''));
    if ($routeId !== '') {
        if ($to !== '' || uv_transport_wp_route($catalog, $routeId) === null) {
            return '';
        }
        return $base . '/r/' . rawurlencode($routeId) . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    }

    if ($to === '') {
        return '';
    }

    $target = uv_transport_wp_entity($catalog, $to);
    if ($target === null || !isset($target['token'])) {
        return '';
    }

    $from = trim((string) ($params['from'] ?? 'current'));
    if ($from === '') {
        $from = 'current';
    }
    if ($from !== 'current' && uv_transport_wp_entity($catalog, $from) === null) {
        return '';
    }
    $query['from'] = $from;

    return $base . '/p/' . rawurlencode((string) $target['token']) . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
}

function uv_transport_wp_default_label(array $catalog, string $lang, array $params): string {
    $find = uv_transport_wp_text($catalog, $lang, 'findRoute');
    $routeId = trim((string) ($params['route'] ?? ''));
    if ($routeId !== '') {
        $route = uv_transport_wp_route($catalog, $routeId);
        $name = $route ? uv_transport_wp_localized_name($route, $lang) : '';
        return $name !== '' ? $find . ' · ' . $name : $find;
    }

    $entity = uv_transport_wp_entity($catalog, trim((string) ($params['to'] ?? '')));
    $name = $entity ? uv_transport_wp_localized_name($entity, $lang) : '';
    return $name !== '' ? $find . ' · ' . $name : $find;
}

function uv_transport_wp_enqueue_assets(): void {
    wp_enqueue_style(
        'uv-transport-shortcodes',
        plugins_url('assets/uv-transport.css', __FILE__),
        [],
        UV_TRANSPORT_SHORTCODES_VERSION
    );
}

function uv_transport_wp_route_shortcode($atts = []): string {
    $atts = shortcode_atts([
        'to' => '',
        'from' => 'current',
        'route' => '',
        'label' => '',
        'lang' => '',
        'mode' => '',
    ], is_array($atts) ? $atts : [], 'uv_route');

    $params = [
        'to' => sanitize_text_field((string) $atts['to']),
        'from' => sanitize_text_field((string) $atts['from']),
        'route' => sanitize_text_field((string) $atts['route']),
        'lang' => sanitize_text_field((string) $atts['lang']),
        'mode' => sanitize_text_field((string) $atts['mode']),
    ];

    $url = uv_transport_wp_url($params);
    if ($url === '') {
        do_action('uv_transport_shortcode_invalid', 'uv_route', $params);
        return '';
    }

    $catalog = uv_transport_wp_catalog();
    $lang = uv_transport_wp_current_lang($params['lang']);
    $label = trim((string) $atts['label']);
    if ($label === '') {
        $label = uv_transport_wp_default_label($catalog, $lang, $params);
    }

    uv_transport_wp_enqueue_assets();

    return sprintf(
        '<a class="uv-route-link" href="%s" aria-label="%s" data-uv-ref="wp_article">%s</a>',
        esc_url($url),
        esc_attr($label),
        esc_html($label)
    );
}

function uv_transport_wp_widget_shortcode($atts = []): string {
    $atts = shortcode_atts([
        'destination' => '',
        'label' => '',
        'lang' => '',
        'mode' => '',
    ], is_array($atts) ? $atts : [], 'uv_transport_widget');

    $destination = sanitize_text_field((string) $atts['destination']);
    $catalog = uv_transport_wp_catalog();
    $entity = uv_transport_wp_entity($catalog, $destination);
    if ($entity === null) {
        do_action('uv_transport_shortcode_invalid', 'uv_transport_widget', ['destination' => $destination]);
        return '';
    }

    $lang = uv_transport_wp_current_lang(sanitize_text_field((string) $atts['lang']));
    $url = uv_transport_wp_url([
        'to' => $destination,
        'from' => 'current',
        'lang' => $lang,
        'mode' => sanitize_text_field((string) $atts['mode']),
    ]);
    if ($url === '') {
        return '';
    }

    $name = uv_transport_wp_localized_name($entity, $lang);
    $button = trim((string) $atts['label']);
    if ($button === '') {
        $button = uv_transport_wp_text($catalog, $lang, 'findRoute', 'Find route');
    }
    $destinationLabel = uv_transport_wp_text($catalog, $lang, 'destination');
    $aria = $button . ($name !== '' ? ' · ' . $name : '');

    uv_transport_wp_enqueue_assets();

    return sprintf(
        '<aside class="uv-transport-widget" aria-label="%s"><span class="uv-transport-widget__eyebrow">%s</span><strong class="uv-transport-widget__destination">%s</strong><a class="uv-transport-widget__cta" href="%s" aria-label="%s" data-uv-ref="wp_article">%s</a></aside>',
        esc_attr($aria),
        esc_html($destinationLabel),
        esc_html($name),
        esc_url($url),
        esc_attr($aria),
        esc_html($button)
    );
}

function uv_transport_wp_register_shortcodes(): void {
    add_shortcode('uv_route', 'uv_transport_wp_route_shortcode');
    add_shortcode('uv_transport_widget', 'uv_transport_wp_widget_shortcode');
}
add_action('init', 'uv_transport_wp_register_shortcodes');

function uv_transport_wp_register_health_route(): void {
    register_rest_route('uv-transport/v1', '/health', [
        'methods' => 'GET',
        'callback' => static function () {
            $catalog = uv_transport_wp_catalog();
            return [
                'version' => UV_TRANSPORT_SHORTCODES_VERSION,
                'schemaVersion' => $catalog['schemaVersion'] ?? null,
                'locales' => count($catalog['locales'] ?? []),
                'entities' => count($catalog['entities'] ?? []),
                'routes' => count($catalog['routes'] ?? []),
                'shortcodes' => [
                    'uv_route' => shortcode_exists('uv_route'),
                    'uv_transport_widget' => shortcode_exists('uv_transport_widget'),
                ],
            ];
        },
        'permission_callback' => '__return_true',
    ]);
}
add_action('rest_api_init', 'uv_transport_wp_register_health_route');
