<?php
declare(strict_types=1);

/*
 * Bounded raw transit feed archive.
 *
 * The archive is diagnostic-only and fail-open: callers must never make live
 * transit availability depend on successful archive writes.
 */

function uvActvArchiveMaybe(
    string $sourcePath,
    string $network,
    string $feed,
    int $now,
    string $cacheDir
): array {
    try {
        if (!uvActvArchiveEnabled()) {
            return ['status' => 'disabled'];
        }
        if (!is_file($sourcePath) || (int)@filesize($sourcePath) <= 0) {
            return ['status' => 'error', 'reason' => 'source_missing'];
        }

        $root = uvActvArchiveRoot($cacheDir);
        $scopeDir = $root . DIRECTORY_SEPARATOR . $network . DIRECTORY_SEPARATOR . $feed;
        if (!is_dir($scopeDir) && !@mkdir($scopeDir, 0700, true) && !is_dir($scopeDir)) {
            return ['status' => 'error', 'reason' => 'mkdir_failed'];
        }

        $marker = $scopeDir . DIRECTORY_SEPARATOR . '.last';
        $interval = uvActvArchiveInterval();
        clearstatcache(true, $marker);
        if (is_file($marker) && ($now - (int)@filemtime($marker)) < $interval) {
            return ['status' => 'skipped_interval'];
        }

        $hash = @hash_file('sha256', $sourcePath);
        if (!is_string($hash) || $hash === '') {
            return ['status' => 'error', 'reason' => 'hash_failed'];
        }

        $stamp = gmdate('Ymd\THis\Z', $now);
        $base = $network . '-' . $feed . '-' . $stamp . '-' . substr($hash, 0, 12);
        $raw = @file_get_contents($sourcePath);
        if ($raw === false) {
            return ['status' => 'error', 'reason' => 'read_failed'];
        }

        $payload = function_exists('gzencode') ? @gzencode($raw, 6) : false;
        $compressed = is_string($payload);
        if (!$compressed) {
            $payload = $raw;
        }
        $target = $scopeDir . DIRECTORY_SEPARATOR . $base . ($compressed ? '.pb.gz' : '.pb');
        $tmp = $target . '.' . getmypid() . '.tmp';

        if (@file_put_contents($tmp, $payload, LOCK_EX) === false) {
            @unlink($tmp);
            return ['status' => 'error', 'reason' => 'write_failed'];
        }
        @chmod($tmp, 0600);
        if (!@rename($tmp, $target)) {
            @unlink($tmp);
            return ['status' => 'error', 'reason' => 'publish_failed'];
        }
        @chmod($target, 0600);
        @touch($marker, $now);

        $pruned = uvActvArchivePrune($scopeDir, $now);
        return [
            'status' => 'archived',
            'file' => basename($target),
            'bytes' => (int)@filesize($target),
            'sha256' => $hash,
            'compressed' => $compressed,
            'pruned' => $pruned,
        ];
    } catch (Throwable $e) {
        return ['status' => 'error', 'reason' => 'exception'];
    }
}

function uvActvArchivePrune(string $scopeDir, int $now): int
{
    $retention = uvActvArchiveRetention();
    $maxFiles = uvActvArchiveMaxFiles();
    $files = array_values(array_filter(
        glob($scopeDir . DIRECTORY_SEPARATOR . '*.pb*') ?: [],
        static fn(string $path): bool => is_file($path)
    ));

    usort($files, static function (string $a, string $b): int {
        return ((int)@filemtime($a)) <=> ((int)@filemtime($b));
    });

    $removed = 0;
    $kept = [];
    foreach ($files as $path) {
        $mtime = (int)@filemtime($path);
        if ($mtime > 0 && ($now - $mtime) > $retention) {
            if (@unlink($path)) {
                $removed++;
            }
        } else {
            $kept[] = $path;
        }
    }

    $excess = count($kept) - $maxFiles;
    if ($excess > 0) {
        for ($i = 0; $i < $excess; $i++) {
            if (@unlink($kept[$i])) {
                $removed++;
            }
        }
    }
    return $removed;
}

function uvActvArchiveEnabled(): bool
{
    $value = getenv('UV_ACTV_ARCHIVE_ENABLED');
    if ($value === false || trim((string)$value) === '') {
        return true;
    }
    return !in_array(strtolower(trim((string)$value)), ['0', 'false', 'off', 'no'], true);
}

function uvActvArchiveRoot(string $cacheDir): string
{
    $value = getenv('UV_ACTV_ARCHIVE_DIR');
    if ($value !== false && trim((string)$value) !== '') {
        return rtrim(trim((string)$value), DIRECTORY_SEPARATOR);
    }
    return rtrim($cacheDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'archive';
}

function uvActvArchiveInterval(): int
{
    return uvActvArchiveIntEnv('UV_ACTV_ARCHIVE_INTERVAL_SEC', 30, 5, 3600);
}

function uvActvArchiveRetention(): int
{
    return uvActvArchiveIntEnv('UV_ACTV_ARCHIVE_RETENTION_SEC', 21600, 300, 604800);
}

function uvActvArchiveMaxFiles(): int
{
    return uvActvArchiveIntEnv('UV_ACTV_ARCHIVE_MAX_FILES', 720, 10, 10000);
}

function uvActvArchiveIntEnv(string $name, int $default, int $min, int $max): int
{
    $value = getenv($name);
    if ($value === false || !is_numeric($value)) {
        return $default;
    }
    return max($min, min($max, (int)$value));
}
