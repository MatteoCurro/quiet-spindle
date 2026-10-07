<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/transit-archive.php';

/*
 * U.Venice Transport — ACTV official GTFS-Realtime proxy.
 *
 * Purpose:
 * - keep the browser same-origin (no dependency on upstream CORS);
 * - fetch only the two documented ACTV GTFS-RT endpoints;
 * - coalesce bursts with a tiny local cache;
 * - serve a recent stale copy if ACTV has a transient network failure.
 *
 * The payload is not transformed here: it remains standard GTFS-RT protobuf.
 */

const UV_ACTV_RT_TTL = 2;
const UV_ACTV_RT_STALE_MAX = 45;
const UV_ACTV_RT_TIMEOUT = 8;
const UV_ACTV_RT_CONNECT_TIMEOUT = 3;

$network = isset($_GET['network']) ? (string)$_GET['network'] : 'aut';
$feed = isset($_GET['feed']) ? (string)$_GET['feed'] : '';

$upstreams = [
    'aut' => [
        'vehiclePositions' => 'https://tpl.actv.it/aut/GTFSRT/vehiclePositions',
        'tripUpdates' => 'https://tpl.actv.it/aut/GTFSRT/tripUpdates',
    ],
    'nav' => [
        'vehiclePositions' => 'https://tpl.actv.it/nav/GTFSRT/vehiclePositions',
        'tripUpdates' => 'https://tpl.actv.it/nav/GTFSRT/tripUpdates',
    ],
];

if (!isset($upstreams[$network]) || !isset($upstreams[$network][$feed])) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Parametri ACTV non validi'], JSON_UNESCAPED_SLASHES);
    exit;
}

$url = $upstreams[$network][$feed];
$cacheDir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'u-venice-actv';
if (!is_dir($cacheDir) && !@mkdir($cacheDir, 0700, true) && !is_dir($cacheDir)) {
    failJson(500, 'Cache locale ACTV non disponibile');
}
$cachePath = $cacheDir . DIRECTORY_SEPARATOR . $network . '-' . $feed . '.pb';
$lockPath = $cachePath . '.lock';

$now = time();
if (is_file($cachePath) && ($now - (int)@filemtime($cachePath)) <= UV_ACTV_RT_TTL) {
    serveFile($cachePath, false, $network, $feed);
}

$lock = @fopen($lockPath, 'c');
if ($lock === false) {
    serveStaleOrFail($cachePath, $network, $feed, 'Lock cache ACTV non disponibile');
}

if (!@flock($lock, LOCK_EX)) {
    @fclose($lock);
    serveStaleOrFail($cachePath, $network, $feed, 'Lock cache ACTV non acquisibile');
}

/* Another request may have refreshed the file while we were waiting. */
clearstatcache(true, $cachePath);
if (is_file($cachePath) && ($now - (int)@filemtime($cachePath)) <= UV_ACTV_RT_TTL) {
    @flock($lock, LOCK_UN);
    @fclose($lock);
    serveFile($cachePath, false, $network, $feed);
}

$tmp = $cachePath . '.' . getmypid() . '.tmp';
$error = null;
try {
    fetchToFile($url, $tmp);
    if (!is_file($tmp) || filesize($tmp) <= 0) {
        throw new RuntimeException('Feed ACTV vuoto');
    }
    /* Diagnostic archive is deliberately fail-open and sampled independently
       from the 2-second serving cache. It receives only fresh official bytes. */
    $archiveResult = uvActvArchiveMaybe($tmp, $network, $feed, $now, $cacheDir);
    if (!@rename($tmp, $cachePath)) {
        throw new RuntimeException('Pubblicazione cache ACTV fallita');
    }
    @chmod($cachePath, 0600);
} catch (Throwable $e) {
    $error = $e->getMessage();
    @unlink($tmp);
}

@flock($lock, LOCK_UN);
@fclose($lock);

if ($error !== null) {
    serveStaleOrFail($cachePath, $network, $feed, $error);
}
if (isset($archiveResult['status'])) {
    header('X-UV-Transit-Archive: ' . (string)$archiveResult['status']);
}
serveFile($cachePath, false, $network, $feed);

function fetchToFile(string $url, string $target): void
{
    if (function_exists('curl_init')) {
        $fh = @fopen($target, 'wb');
        if ($fh === false) {
            throw new RuntimeException('File temporaneo ACTV non scrivibile');
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fh,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => UV_ACTV_RT_CONNECT_TIMEOUT,
            CURLOPT_TIMEOUT => UV_ACTV_RT_TIMEOUT,
            CURLOPT_USERAGENT => 'U.VeniceTransport/ACTV-direct',
            CURLOPT_HTTP_VERSION => defined('CURL_HTTP_VERSION_1_1') ? CURL_HTTP_VERSION_1_1 : 2,
            CURLOPT_FAILONERROR => false,
            CURLOPT_HEADER => false,
        ]);
        $ok = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        fclose($fh);
        if ($ok === false || $status < 200 || $status >= 300) {
            @unlink($target);
            throw new RuntimeException('ACTV HTTP ' . $status . ($curlError ? ': ' . $curlError : ''));
        }
        return;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => UV_ACTV_RT_TIMEOUT,
            'ignore_errors' => true,
            'header' => "User-Agent: U.VeniceTransport/ACTV-direct\r\nConnection: close\r\n",
        ],
    ]);
    $data = @file_get_contents($url, false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $line) {
        if (preg_match('~^HTTP/\S+\s+(\d{3})~', $line, $m)) {
            $status = (int)$m[1];
        }
    }
    if ($data === false || $status < 200 || $status >= 300) {
        throw new RuntimeException('ACTV HTTP ' . $status);
    }
    if (@file_put_contents($target, $data, LOCK_EX) === false) {
        throw new RuntimeException('File temporaneo ACTV non scrivibile');
    }
}

function serveFile(string $path, bool $stale, string $network, string $feed): never
{
    clearstatcache(true, $path);
    if (!is_file($path)) {
        failJson(502, 'Feed ACTV non disponibile');
    }
    header('Content-Type: application/x-protobuf');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('X-UV-Transit-Source: ACTV');
    header('X-UV-Transit-Network: ' . $network);
    header('X-UV-Transit-Feed: ' . $feed);
    header('X-UV-Transit-Stale: ' . ($stale ? '1' : '0'));
    $size = filesize($path);
    if ($size !== false) {
        header('Content-Length: ' . $size);
    }
    readfile($path);
    exit;
}

function serveStaleOrFail(string $path, string $network, string $feed, string $reason): never
{
    clearstatcache(true, $path);
    if (is_file($path)) {
        $age = time() - (int)@filemtime($path);
        if ($age <= UV_ACTV_RT_STALE_MAX) {
            header('X-UV-Transit-Upstream-Error: transient');
            serveFile($path, true, $network, $feed);
        }
    }
    failJson(502, 'Feed ACTV temporaneamente non disponibile', $reason);
}

function failJson(int $status, string $message, ?string $detail = null): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    $payload = ['error' => $message];
    if ($detail !== null) {
        $payload['detail'] = $detail;
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
