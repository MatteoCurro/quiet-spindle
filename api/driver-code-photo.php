<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function fail_json(int $status, string $message): never {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail_json(405, 'Metodo non consentito.');
}

$script = (string)($_SERVER['SCRIPT_NAME'] ?? '');
$enabled = str_contains($script, '/t-sand/') || getenv('UV_DRIVER_UPLOAD_ENABLED') === '1';
if (!$enabled) {
    fail_json(403, 'Invio foto non ancora abilitato in produzione.');
}

$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '' && !preg_match('~^https://(?:www\.)?unlockvenice\.com$~i', $origin)) {
    fail_json(403, 'Origine non consentita.');
}

if (!isset($_FILES['photo']) || !is_array($_FILES['photo'])) {
    fail_json(400, 'Foto mancante.');
}
$file = $_FILES['photo'];
if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    fail_json(400, 'Caricamento della foto non riuscito.');
}

$size = (int)($file['size'] ?? 0);
if ($size < 1024 || $size > 12 * 1024 * 1024) {
    fail_json(413, 'La foto deve essere compresa tra 1 KB e 12 MB.');
}

$tmp = (string)($file['tmp_name'] ?? '');
if ($tmp === '' || !is_uploaded_file($tmp)) {
    fail_json(400, 'Upload non valido.');
}

$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = (string)$finfo->file($tmp);
$allowed = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'image/heic' => 'heic',
    'image/heif' => 'heif',
];
if (!isset($allowed[$mime])) {
    fail_json(415, 'Formato non supportato. Usa JPEG, PNG, WebP o HEIC.');
}

$route = trim((string)($_POST['route'] ?? ''));
$sector = trim((string)($_POST['sector'] ?? ''));
$note = trim((string)($_POST['note'] ?? ''));
if (mb_strlen($route) > 20 || mb_strlen($sector) > 80 || mb_strlen($note) > 500) {
    fail_json(400, 'Metadati troppo lunghi.');
}

$uploadDir = __DIR__ . '/driver-code-submissions';
if (!is_dir($uploadDir) && !mkdir($uploadDir, 0750, true) && !is_dir($uploadDir)) {
    fail_json(500, 'Directory di raccolta non disponibile.');
}
$deny = $uploadDir . '/.htaccess';
if (!is_file($deny)) {
    @file_put_contents($deny, "Require all denied\nDeny from all\n", LOCK_EX);
    @chmod($deny, 0640);
}

$id = gmdate('Ymd-His') . '-' . bin2hex(random_bytes(8));
$ext = $allowed[$mime];
$imagePath = $uploadDir . '/' . $id . '.' . $ext;
$metaPath = $uploadDir . '/' . $id . '.json';

if (!move_uploaded_file($tmp, $imagePath)) {
    fail_json(500, 'Impossibile salvare la foto.');
}
@chmod($imagePath, 0640);

$meta = [
    'schema' => 1,
    'id' => $id,
    'receivedAt' => gmdate('c'),
    'originalName' => basename((string)($file['name'] ?? 'photo')),
    'mime' => $mime,
    'bytes' => $size,
    'route' => $route,
    'sector' => $sector,
    'note' => $note,
    'reviewStatus' => 'pending',
    'remoteAddressHash' => hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? '') . '|' . $id),
];
if (file_put_contents($metaPath, json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", LOCK_EX) === false) {
    @unlink($imagePath);
    fail_json(500, 'Impossibile salvare i metadati.');
}
@chmod($metaPath, 0640);

$isTest = str_contains($script, '/t-sand/') && (string)($_POST['test'] ?? '') === '1';
if ($isTest) {
    @unlink($imagePath);
    @unlink($metaPath);
}

http_response_code(201);
echo json_encode(['ok' => true, 'id' => $id, 'status' => $isTest ? 'test-cleaned' : 'pending'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
