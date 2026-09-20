<?php
declare(strict_types=1);

function galleryError(int $status, string $message): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
    exit;
}

function galleryDecode(string $source): array
{
    if (!preg_match('/^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,(.+)$/s', $source, $match)) {
        throw new RuntimeException('Unsupported photo.');
    }
    $bytes = base64_decode($match[2], true);
    if ($bytes === false) throw new RuntimeException('Invalid photo.');
    return [$bytes, $match[1] === 'image/jpg' ? 'image/jpeg' : $match[1]];
}

function galleryPreview(string $bytes): string
{
    $size = @getimagesizefromstring($bytes);
    // Bound decompression memory before either image processor reads pixels.
    if (!$size || $size[0] * $size[1] > 50000000) throw new RuntimeException('Photo dimensions too large.');
    if (class_exists('Imagick')) {
        $image = new Imagick();
        $image->readImageBlob($bytes);
        $image->setIteratorIndex(0);
        $image = $image->getImage();
        $image->autoOrientImage();
        $image->thumbnailImage(960, 960, true, true);
        $image->setImageBackgroundColor('#F1E7D3');
        $image = $image->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
        $image->setImageFormat('jpeg');
        $image->setImageCompressionQuality(78);
        $image->stripImage();
        return $image->getImageBlob();
    }
    if (!function_exists('imagecreatefromstring')) throw new RuntimeException('Image processing unavailable.');
    $image = @imagecreatefromstring($bytes);
    if (!$image) throw new RuntimeException('Invalid image.');
    if (function_exists('exif_read_data') && $size[2] === IMAGETYPE_JPEG) {
        $stream = fopen('php://temp', 'w+b');
        fwrite($stream, $bytes);
        rewind($stream);
        $exif = @exif_read_data($stream);
        fclose($stream);
        $orientation = (int)($exif['Orientation'] ?? 1);
        if (in_array($orientation, [2, 4, 5, 7], true)) imageflip($image, IMG_FLIP_HORIZONTAL);
        $angle = [3 => 180, 4 => 180, 5 => 90, 6 => -90, 7 => -90, 8 => 90][$orientation] ?? 0;
        if ($angle) {
            $rotated = imagerotate($image, $angle, 0);
            imagedestroy($image);
            $image = $rotated;
        }
    }
    $width = imagesx($image);
    $height = imagesy($image);
    $scale = min(1, 960 / max($width, $height));
    $preview = imagecreatetruecolor(max(1, (int)round($width * $scale)), max(1, (int)round($height * $scale)));
    imagefill($preview, 0, 0, imagecolorallocate($preview, 241, 231, 211));
    imagecopyresampled($preview, $image, 0, 0, 0, 0, imagesx($preview), imagesy($preview), $width, $height);
    ob_start();
    imagejpeg($preview, null, 78);
    $result = ob_get_clean();
    imagedestroy($image);
    imagedestroy($preview);
    return $result;
}
