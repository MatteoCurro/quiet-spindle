<?php
declare(strict_types=1);

/*
 * U.Venice Transport — fallback proxy for the official ACTV static GTFS.
 * Normal operation uses the prebuilt runtime-data index; this endpoint exists
 * only for the legacy/emergency GTFS fallback already present in the app.
 */

const UV_ACTV_STATIC_TTL = 1800;
const UV_ACTV_STATIC_STALE_MAX = 604800;
const UV_ACTV_STATIC_TIMEOUT = 90;
const UV_ACTV_STATIC_CONNECT_TIMEOUT = 5;

$network = isset($_GET['network']) ? (string)$_GET['network'] : 'aut';
$upstreams = [
    'aut' => 'https://actv.avmspa.it/sites/default/files/attachments/opendata/automobilistico/actv_aut.zip',
    'nav' => 'https://actv.avmspa.it/sites/default/files/attachments/opendata/navigazione/actv_nav.zip',
];

if (!isset($upstreams[$network])) {
    failJson(400, 'Rete ACTV non valida');
}
$url = $upstreams[$network];

$cacheDir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'u-venice-actv';
if (!is_dir($cacheDir) && !@mkdir($cacheDir, 0700, true) && !is_dir($cacheDir)) {
    failJson(500, 'Cache locale ACTV non disponibile');
}
$cachePath = $cacheDir . DIRECTORY_SEPARATOR . $network . '-gtfs.zip';
$lockPath = $cachePath . '.lock';

if (freshEnough($cachePath, UV_ACTV_STATIC_TTL)) {
    serveZip($cachePath, false, $network);
}

$lock = @fopen($lockPath, 'c');
if ($lock === false || !@flock($lock, LOCK_EX)) {
    if (is_resource($lock)) {
        @fclose($lock);
    }
    serveStaleOrFail($cachePath, $network, 'Lock cache ACTV non disponibile');
}

clearstatcache(true, $cachePath);
if (freshEnough($cachePath, UV_ACTV_STATIC_TTL)) {
    @flock($lock, LOCK_UN);
    @fclose($lock);
    serveZip($cachePath, false, $network);
}

$tmp = $cachePath . '.' . getmypid() . '.tmp';
$error = null;
try {
    fetchToFile($url, $tmp);
    if (!is_file($tmp) || filesize($tmp) < 1024) {
        throw new RuntimeException('Archivio GTFS ACTV vuoto o incompleto');
    }
    if (!@rename($tmp, $cachePath)) {
        throw new RuntimeException('Pubblicazione cache GTFS ACTV fallita');
    }
    @chmod($cachePath, 0600);
} catch (Throwable $e) {
    $error = $e->getMessage();
    @unlink($tmp);
}

@flock($lock, LOCK_UN);
@fclose($lock);

if ($error !== null) {
    serveStaleOrFail($cachePath, $network, $error);
}
serveZip($cachePath, false, $network);

function freshEnough(string $path, int $maxAge): bool
{
    return is_file($path) && (time() - (int)@filemtime($path)) <= $maxAge;
}

function fetchToFile(string $url, string $target): void
{
    if (function_exists('curl_init')) {
        $fh = @fopen($target, 'wb');
        if ($fh === false) {
            throw new RuntimeException('File temporaneo GTFS ACTV non scrivibile');
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fh,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => UV_ACTV_STATIC_CONNECT_TIMEOUT,
            CURLOPT_TIMEOUT => UV_ACTV_STATIC_TIMEOUT,
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
            throw new RuntimeException('ACTV static HTTP ' . $status . ($curlError ? ': ' . $curlError : ''));
        }
        return;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => UV_ACTV_STATIC_TIMEOUT,
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
        throw new RuntimeException('ACTV static HTTP ' . $status);
    }
    if (@file_put_contents($target, $data, LOCK_EX) === false) {
        throw new RuntimeException('File temporaneo GTFS ACTV non scrivibile');
    }
}

function serveZip(string $path, bool $stale, string $network): never
{
    if (!is_file($path)) {
        failJson(502, 'GTFS ACTV non disponibile');
    }
    header('Content-Type: application/zip');
    header('Cache-Control: no-store, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('X-UV-Transit-Source: ACTV');
    header('X-UV-Transit-Network: ' . $network);
    header('X-UV-Transit-Stale: ' . ($stale ? '1' : '0'));
    $size = filesize($path);
    if ($size !== false) {
        header('Content-Length: ' . $size);
    }
    readfile($path);
    exit;
}

function serveStaleOrFail(string $path, string $network, string $reason): never
{
    clearstatcache(true, $path);
    if (freshEnough($path, UV_ACTV_STATIC_STALE_MAX)) {
        header('X-UV-Transit-Upstream-Error: transient');
        serveZip($path, true, $network);
    }
    failJson(502, 'GTFS ACTV temporaneamente non disponibile', $reason);
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
