<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Gallery configuration is missing.']);
    exit;
}

$config = require $configPath;

function respond($payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function pdo(array $config): PDO
{
    $dsn = 'mysql:host=' . $config['db_host'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4';
    return new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}

function ensureTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS guest_photos_lydia_habtamu (
            id CHAR(36) NOT NULL PRIMARY KEY,
            owner_id VARCHAR(120) NOT NULL,
            image_data LONGTEXT NOT NULL,
            mime_type VARCHAR(64) NOT NULL DEFAULT "image/jpeg",
            hidden TINYINT(1) NOT NULL DEFAULT 0,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX created_at_idx (created_at),
            INDEX owner_idx (owner_id),
            INDEX hidden_idx (hidden),
            INDEX deleted_at_idx (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    try {
        $pdo->exec('ALTER TABLE guest_photos_lydia_habtamu ADD COLUMN IF NOT EXISTS hidden TINYINT(1) NOT NULL DEFAULT 0');
        $pdo->exec('ALTER TABLE guest_photos_lydia_habtamu ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL DEFAULT NULL');
    } catch (Throwable $error) {
    }
}

function readJson(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function validDeviceId(string $deviceId): bool
{
    return preg_match('/^[a-zA-Z0-9._:-]{8,120}$/', $deviceId) === 1;
}

function uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

function adminKey(array $payload = []): string
{
    return (string)($payload['adminKey'] ?? $_GET['admin_key'] ?? '');
}

function isAdmin(array $config, array $payload = []): bool
{
    $expected = (string)($config['admin_key'] ?? '');
    $actual = adminKey($payload);
    return $expected !== '' && $actual !== '' && hash_equals($expected, $actual);
}

function parseDataUri(string $src): ?array
{
    if (!preg_match('/^data:image\/(jpeg|jpg|png|webp);base64,([a-zA-Z0-9+\/=\r\n]+)$/', $src, $match)) {
        return null;
    }
    $extension = $match[1] === 'jpeg' ? 'jpg' : $match[1];
    $bytes = base64_decode($match[2], true);
    if ($bytes === false) return null;
    return ['extension' => $extension, 'bytes' => $bytes];
}

function uploadedFiles(string $field): array
{
    if (!isset($_FILES[$field])) return [];
    $files = $_FILES[$field];
    $items = [];
    if (is_array($files['name'])) {
        foreach ($files['name'] as $index => $name) {
            $items[] = [
                'name' => $name,
                'type' => $files['type'][$index] ?? '',
                'tmp_name' => $files['tmp_name'][$index] ?? '',
                'error' => $files['error'][$index] ?? UPLOAD_ERR_NO_FILE,
                'size' => $files['size'][$index] ?? 0,
            ];
        }
    } else {
        $items[] = $files;
    }
    return $items;
}

function fileToDataUri(array $file): ?array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) return null;
    if (($file['size'] ?? 0) <= 0 || ($file['size'] ?? 0) > 8000000) return null;
    $tmp = (string)($file['tmp_name'] ?? '');
    if ($tmp === '' || !is_uploaded_file($tmp)) return null;
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($tmp) ?: '';
    $allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!in_array($mime, $allowed, true)) return null;
    $bytes = file_get_contents($tmp);
    if ($bytes === false) return null;
    return ['src' => 'data:' . $mime . ';base64,' . base64_encode($bytes), 'mime' => $mime];
}

function downloadZip(PDO $pdo, array $config): void
{
    if (!isAdmin($config)) respond(['error' => 'Unauthorized.'], 401);
    if (!class_exists('ZipArchive')) respond(['error' => 'ZIP downloads are not available on this server.'], 500);

    $stmt = $pdo->query('SELECT id, image_data, created_at FROM guest_photos_lydia_habtamu ORDER BY created_at DESC');
    $zipPath = tempnam(sys_get_temp_dir(), 'guest-photos-') . '.zip';
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        respond(['error' => 'Could not create ZIP file.'], 500);
    }
    $count = 0;
    foreach ($stmt->fetchAll() as $row) {
        $parsed = parseDataUri((string)$row['image_data']);
        if (!$parsed) continue;
        $date = gmdate('Ymd-His', strtotime($row['created_at']));
        $zip->addFromString($date . '-' . $row['id'] . '.' . $parsed['extension'], $parsed['bytes']);
        $count++;
    }
    $zip->close();

    header_remove('Content-Type');
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="yeabsra-christian-guest-photos.zip"');
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath);
    unlink($zipPath);
    exit;
}

function downloadPhoto(PDO $pdo, array $config): void
{
    if (!isAdmin($config)) respond(['error' => 'Unauthorized.'], 401);
    $id = (string)($_GET['id'] ?? '');
    if (!preg_match('/^[a-f0-9-]{36}$/i', $id)) respond(['error' => 'Invalid photo id.'], 400);

    $stmt = $pdo->prepare('SELECT id, image_data, created_at FROM guest_photos_lydia_habtamu WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) respond(['error' => 'Photo not found.'], 404);

    $parsed = parseDataUri((string)$row['image_data']);
    if (!$parsed) respond(['error' => 'Photo data is not available.'], 404);

    $mime = $parsed['extension'] === 'jpg' ? 'image/jpeg' : 'image/' . $parsed['extension'];
    $date = gmdate('Ymd-His', strtotime($row['created_at']));
    $filename = 'yeabsra-christian-' . $date . '-' . $row['id'] . '.' . $parsed['extension'];

    header_remove('Content-Type');
    header('Content-Type: ' . $mime);
    $disposition = !empty($_GET['inline']) ? 'inline' : 'attachment';
    header('Content-Disposition: ' . $disposition . '; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($parsed['bytes']));
    echo $parsed['bytes'];
    exit;
}

try {
    $pdo = pdo($config);
    ensureTable($pdo);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if (($_GET['download'] ?? '') === 'zip') downloadZip($pdo, $config);
        if (($_GET['download'] ?? '') === 'photo') downloadPhoto($pdo, $config);
        $deviceId = (string)($_GET['device_id'] ?? '');
        $admin = isAdmin($config);
        $stmt = $admin
            ? $pdo->query('SELECT id, owner_id, image_data, hidden, deleted_at, created_at FROM guest_photos_lydia_habtamu ORDER BY created_at DESC LIMIT 300')
            : $pdo->query('SELECT id, owner_id, image_data, hidden, deleted_at, created_at FROM guest_photos_lydia_habtamu WHERE hidden = 0 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 80');
        $photos = array_map(function ($row) use ($deviceId, $admin, $config) {
            $src = $row['image_data'];
            if ($admin) {
                $src = '/lydiahabtamu/api/photos.php?download=photo&inline=1&id='
                    . rawurlencode((string)$row['id'])
                    . '&admin_key=' . rawurlencode((string)$config['admin_key']);
            }
            return [
                'id' => $row['id'],
                'src' => $src,
                'createdAt' => gmdate('c', strtotime($row['created_at'])),
                'hidden' => (bool)$row['hidden'],
                'deleted' => $row['deleted_at'] !== null,
                'deletedAt' => $row['deleted_at'] ? gmdate('c', strtotime($row['deleted_at'])) : null,
                'canDelete' => ($admin || ($deviceId !== '' && hash_equals($row['owner_id'], $deviceId))) && $row['deleted_at'] === null,
            ];
        }, $stmt->fetchAll());
        respond(['photos' => $photos]);
    }

    if ($method === 'POST') {
        $isMultipart = stripos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') !== false;
        $payload = $isMultipart ? [] : readJson();
        $deviceId = $isMultipart ? (string)($_POST['deviceId'] ?? '') : (string)($payload['deviceId'] ?? '');
        if (!validDeviceId($deviceId)) respond(['error' => 'Invalid device id.'], 400);

        $stmt = $pdo->prepare('INSERT INTO guest_photos_lydia_habtamu (id, owner_id, image_data, mime_type) VALUES (?, ?, ?, ?)');
        $added = [];
        $skipped = 0;
        if ($isMultipart) {
            $files = uploadedFiles('photos');
            if (count($files) === 0) respond(['error' => 'No photos were uploaded.'], 400);
            if (count($files) > 12) respond(['error' => 'Upload 12 photos or fewer at once.'], 400);
            foreach ($files as $file) {
                $photo = fileToDataUri($file);
                if (!$photo || strlen($photo['src']) > 11000000) {
                    $skipped++;
                    continue;
                }
                $id = uuid();
                $stmt->execute([$id, $deviceId, $photo['src'], $photo['mime']]);
                $added[] = $id;
            }
        } else {
            $photos = $payload['photos'] ?? [];
            if (!is_array($photos) || count($photos) === 0) respond(['error' => 'No photos were uploaded.'], 400);
            if (count($photos) > 12) respond(['error' => 'Upload 12 photos or fewer at once.'], 400);
            foreach ($photos as $photo) {
                $src = is_string($photo['src'] ?? null) ? $photo['src'] : '';
                if (!preg_match('/^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-zA-Z0-9+\/=\r\n]+$/', $src)) {
                    $skipped++;
                    continue;
                }
                if (strlen($src) > 11000000) {
                    $skipped++;
                    continue;
                }
                $id = uuid();
                $mime = preg_match('/^data:(image\/[^;]+);base64,/', $src, $m) ? $m[1] : 'image/jpeg';
                $stmt->execute([$id, $deviceId, $src, $mime]);
                $added[] = $id;
            }
        }
        respond([
            'added' => count($added),
            'skipped' => $skipped,
            'ids' => $added,
            'error' => count($added) ? null : 'Photo was too large or not supported.'
        ], count($added) ? 201 : 400);
    }

    if ($method === 'DELETE') {
        $payload = readJson();
        $admin = isAdmin($config, $payload);
        $deviceId = (string)($payload['deviceId'] ?? '');
        $id = (string)($payload['id'] ?? '');
        if ($admin && ($payload['all'] ?? false)) {
            $stmt = $pdo->prepare('UPDATE guest_photos_lydia_habtamu SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)');
            $stmt->execute();
            respond(['deleted' => $stmt->rowCount()]);
        }
        if ((!$admin && !validDeviceId($deviceId)) || !preg_match('/^[a-f0-9-]{36}$/i', $id)) {
            respond(['error' => 'Invalid delete request.'], 400);
        }
        $stmt = $admin
            ? $pdo->prepare('UPDATE guest_photos_lydia_habtamu SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP) WHERE id = ?')
            : $pdo->prepare('UPDATE guest_photos_lydia_habtamu SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP) WHERE id = ? AND owner_id = ? AND deleted_at IS NULL');
        $admin ? $stmt->execute([$id]) : $stmt->execute([$id, $deviceId]);
        respond(['deleted' => $stmt->rowCount()]);
    }

    if ($method === 'PATCH') {
        $payload = readJson();
        if (!isAdmin($config, $payload)) respond(['error' => 'Unauthorized.'], 401);
        $hidden = !empty($payload['hidden']) ? 1 : 0;
        if ($payload['all'] ?? false) {
            $stmt = $pdo->prepare('UPDATE guest_photos_lydia_habtamu SET hidden = ?');
            $stmt->execute([$hidden]);
            respond(['updated' => $stmt->rowCount()]);
        }
        $id = (string)($payload['id'] ?? '');
        if (!preg_match('/^[a-f0-9-]{36}$/i', $id)) respond(['error' => 'Invalid photo id.'], 400);
        $stmt = $pdo->prepare('UPDATE guest_photos_lydia_habtamu SET hidden = ? WHERE id = ?');
        $stmt->execute([$hidden, $id]);
        respond(['updated' => $stmt->rowCount()]);
    }

    respond(['error' => 'Method not allowed.'], 405);
} catch (Throwable $error) {
    respond(['error' => 'Gallery service is temporarily unavailable.'], 500);
}
