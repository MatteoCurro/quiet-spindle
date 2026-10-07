<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Surrogate-Control: no-store');

const UV_ALERT_MAX_AGE = 240;
const UV_ALERT_PYTHON = '/usr/bin/python3';

$root = dirname(__DIR__);
$alertsDir = $root . '/runtime-data/alerts';
$current = $alertsDir . '/current.json';
$previous = $alertsDir . '/current.json.previous';
$lockPath = $alertsDir . '/refresh.lock';
$builder = '/srv/data/web/vhosts/unlockvenice.com/private/uv-transit/build_service_alerts.py';

if (!is_dir($alertsDir) && !@mkdir($alertsDir, 0775, true) && !is_dir($alertsDir)) {
    http_response_code(503);
    echo json_encode(['error' => 'alerts-storage-unavailable']);
    exit;
}

function uv_alert_is_fresh(string $path): bool {
    clearstatcache(true, $path);
    return is_file($path) && (time() - (int) filemtime($path)) <= UV_ALERT_MAX_AGE;
}

function uv_alert_valid_file(string $path): bool {
    if (!is_file($path) || filesize($path) < 50) return false;
    $raw = @file_get_contents($path);
    if ($raw === false) return false;
    $data = json_decode($raw, true);
    if (!is_array($data) || (int)($data['schemaVersion'] ?? 0) !== 1) return false;
    if (!is_string($data['revision'] ?? null) || strlen($data['revision']) < 8) return false;
    $telegram = $data['sourceHealth']['telegram'] ?? null;
    return is_array($telegram)
        && ($telegram['status'] ?? null) === 'ok'
        && (int)($telegram['messagesParsed'] ?? 0) > 0
        && !empty($telegram['latestPublishedAt']);
}

function uv_alert_refresh(string $builder, string $current, string $previous): bool {
    if (!function_exists('shell_exec') || !is_file($builder)) return false;
    $tmp = dirname($current) . '/current.json.refresh.' . getmypid() . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $cmd = UV_ALERT_PYTHON . ' ' . escapeshellarg($builder) . ' --output ' . escapeshellarg($tmp) . ' 2>&1';
    @set_time_limit(45);
    $output = @shell_exec($cmd);
    if (!uv_alert_valid_file($tmp)) {
        @unlink($tmp);
        error_log('UV alerts refresh failed: ' . trim((string)$output));
        return false;
    }

    if (is_file($previous)) @unlink($previous);
    if (is_file($current) && !@rename($current, $previous)) {
        @unlink($tmp);
        return false;
    }
    if (!@rename($tmp, $current)) {
        if (!is_file($current) && is_file($previous)) @rename($previous, $current);
        @unlink($tmp);
        return false;
    }
    @chmod($current, 0644);
    return true;
}

$refreshState = 'cached';
if (!uv_alert_is_fresh($current)) {
    $lock = @fopen($lockPath, 'c');
    if ($lock && @flock($lock, LOCK_EX | LOCK_NB)) {
        if (!uv_alert_is_fresh($current)) {
            $refreshState = uv_alert_refresh($builder, $current, $previous) ? 'refreshed' : 'refresh-failed';
        }
        @flock($lock, LOCK_UN);
        @fclose($lock);
    } else {
        if ($lock) @fclose($lock);
        $refreshState = 'busy';
    }
}

header('X-UV-Alerts-Refresh: ' . $refreshState);
if (!uv_alert_valid_file($current)) {
    http_response_code(503);
    echo json_encode(['error' => 'alerts-feed-unavailable', 'refresh' => $refreshState]);
    exit;
}

readfile($current);
