<?php
declare(strict_types=1);

/* U.Venice 9.0 operational deep-link gateway.
   Converts readable /go/... paths into app-shell query parameters.
   No external redirect target is ever accepted. */
header('X-Robots-Tag: noindex, follow');

function uv_decode(string $value): string {
    return trim(rawurldecode(str_replace('+', ' ', $value)));
}
function uv_join(array $parts): string {
    return uv_decode(implode('/', $parts));
}
function uv_entity_token(string $value): string {
    $value = uv_decode($value);
    return preg_match('/^(poi|hub|airport):/i', $value) === 1 ? $value : 'poi:' . $value;
}

$requestPath = (string)(parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?? '');
$scriptName = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/go/index.php'));
$appBase = rtrim(str_replace('\\', '/', dirname(dirname($scriptName))), '/');
if ($appBase === '/' || $appBase === '.') {
    $appBase = '';
}

$marker = '/go/';
$pos = strpos($requestPath, $marker);
$tail = $pos === false ? '' : substr($requestPath, $pos + strlen($marker));
$segments = array_values(array_filter(explode('/', trim($tail, '/')), static fn($part) => $part !== ''));
$params = [];

if ($segments) {
    $head = strtolower($segments[0]);
    if ($head === 'p' && isset($segments[1])) {
        $params['to'] = uv_entity_token(uv_join(array_slice($segments, 1)));
    } elseif ($head === 'r' && isset($segments[1])) {
        $params['route'] = uv_join(array_slice($segments, 1));
    } elseif (($head === 'to' || $head === 'poi') && isset($segments[1])) {
        $params['to'] = uv_join(array_slice($segments, 1));
    } elseif ($head === 'from') {
        $toIndex = null;
        foreach ($segments as $index => $segment) {
            if ($index > 1 && strtolower($segment) === 'to') {
                $toIndex = $index;
                break;
            }
        }
        if ($toIndex !== null) {
            $params['from'] = uv_join(array_slice($segments, 1, $toIndex - 1));
            $params['to'] = uv_join(array_slice($segments, $toIndex + 1));
        }
    }
}

foreach (['lang', 'ref', 'campaign', 'mode', 'from', 'to', 'route'] as $key) {
    if (array_key_exists($key, $_GET) && is_scalar($_GET[$key])) {
        $value = trim((string)$_GET[$key]);
        if ($value !== '') {
            $params[$key] = $value;
        }
    }
}

$target = ($appBase !== '' ? $appBase : '') . '/';
if ($params) {
    $target .= '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

header('Cache-Control: no-store, max-age=0');
header('Location: ' . $target, true, 302);
exit;
