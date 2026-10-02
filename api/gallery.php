<?php
declare(strict_types=1);

ob_start();

// Read-only guest gallery. The existing photos.php continues to own uploads
// and moderation; no schema changes or original-image rewrites are needed.
require_once __DIR__ . '/gallery-lib.php';
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');

function galleryCleanOutput(): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
}

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        header('Allow: GET');
        galleryError(405, 'Method not allowed.');
    }
    $config = require __DIR__ . '/config.php';
    $db = new PDO('mysql:host=' . $config['db_host'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4', $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    if (isset($_GET['image'])) {
        $id = (string)$_GET['image'];
        if (!preg_match('/^[a-f0-9-]{36}$/i', $id)) galleryError(400, 'Invalid photo.');
        // Check visibility on EVERY request, including cached previews.
        $query = $db->prepare('SELECT id FROM guest_photos_lydia_habtamu WHERE id = ? AND hidden = 0 AND deleted_at IS NULL');
        $query->execute([$id]);
        if (!$query->fetch()) galleryError(404, 'Photo is no longer available.');
        $download = ($_GET['download'] ?? '') === '1';
        $preview = !$download && ($_GET['size'] ?? '') === 'preview';
        // Photo IDs are immutable. Revalidate visibility, then let the browser
        // reuse its copy without transferring the image again.
        $etag = '"' . hash('sha256', $id . ($preview ? '-preview-v2' : ($download ? '-download' : '-original'))) . '"';
        header('Cache-Control: private, no-cache');
        header('ETag: ' . $etag);
        if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
            galleryCleanOutput();
            http_response_code(304);
            exit;
        }
        $cacheDir = sys_get_temp_dir() . '/guest-gallery-' . substr(hash('sha256', __DIR__), 0, 16);
        $cachePath = $cacheDir . '/' . $id . '-v2.jpg';
        if ($preview && is_file($cachePath)) {
            galleryCleanOutput();
            header('Content-Type: image/jpeg');
            readfile($cachePath);
            exit;
        }
        $query = $db->prepare('SELECT image_data FROM guest_photos_lydia_habtamu WHERE id = ? AND hidden = 0 AND deleted_at IS NULL');
        $query->execute([$id]);
        $row = $query->fetch();
        if (!$row) galleryError(404, 'Photo is no longer available.');
        [$bytes, $mime] = galleryDecode($row['image_data']);
        if ($download) {
            $extension = $mime === 'image/jpeg' ? 'jpg' : substr($mime, 6);
            header('Content-Disposition: attachment; filename="lydia-habtamu-' . $id . '.' . $extension . '"');
        }
        if ($preview) {
            try {
                $bytes = galleryPreview($bytes);
                $mime = 'image/jpeg';
                if (is_dir($cacheDir) || @mkdir($cacheDir, 0700, true)) {
                    $temporary = tempnam($cacheDir, 'preview-');
                    if ($temporary !== false) {
                        if (file_put_contents($temporary, $bytes) !== false) @rename($temporary, $cachePath);
                        if (is_file($temporary)) @unlink($temporary);
                    }
                }
            } catch (Throwable $error) {
                header('X-Gallery-Preview-Fallback: original');
            }
        }
        galleryCleanOutput();
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . strlen($bytes));
        echo $bytes;
        exit;
    }
    // Metadata only: every public photo is discoverable, without the old 80 limit
    // or transferring image_data with the list.
    if (!class_exists('Imagick') && !function_exists('imagecreatefromstring')) {
        throw new RuntimeException('Image processing unavailable.');
    }
    $rows = $db->query('SELECT id, owner_id, created_at FROM guest_photos_lydia_habtamu WHERE hidden = 0 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC');
    $device = (string)($_GET['device_id'] ?? '');
    $photos = [];
    foreach ($rows as $row) {
        $url = 'api/gallery.php?image=' . rawurlencode($row['id']);
        $photos[] = [
            'id' => $row['id'],
            'src' => $url,
            'previewSrc' => $url . '&size=preview',
            'createdAt' => gmdate('c', strtotime($row['created_at'])),
            'canDelete' => $device !== '' && hash_equals($row['owner_id'], $device),
        ];
    }
    galleryCleanOutput();
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['photos' => $photos], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    galleryCleanOutput();
    galleryError(503, 'Guest photos are temporarily unavailable. Please try again.');
}
