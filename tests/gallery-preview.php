<?php
declare(strict_types=1);
require __DIR__ . '/../api/gallery-lib.php';
function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
check(function_exists('imagecreatetruecolor'), 'GD is required to run these image tests.');
$image = imagecreatetruecolor(1600, 1000);
for ($x = 0; $x < 1600; $x += 8) {
    for ($y = 0; $y < 1000; $y += 8) {
        $color = imagecolorallocate($image, ($x * 17 + $y) % 256, ($y * 13) % 256, ($x + $y * 7) % 256);
        imagefilledrectangle($image, $x, $y, $x + 7, $y + 7, $color);
    }
}
ob_start(); imagejpeg($image, null, 96); $original = ob_get_clean();
[$decoded, $mime] = galleryDecode('data:image/jpeg;base64,' . base64_encode($original));
check($decoded === $original && $mime === 'image/jpeg', 'Original bytes must remain unchanged.');
$preview = galleryPreview($decoded);
$size = getimagesizefromstring($preview);
check($size[0] === 960 && $size[1] === 600, 'Landscape must be resized without cropping.');
$realPhoto = file_get_contents(__DIR__ . '/../assets/couple.jpg');
check(strlen(galleryPreview($realPhoto)) < strlen($realPhoto) / 2, 'Photographic preview must substantially reduce transfer size.');
if (function_exists('exif_read_data')) {
    // Add a minimal EXIF IFD orientation to a real JPEG.
    foreach ([1, 2, 3, 4, 5, 6, 7, 8] as $orientation) {
        $exif = "Exif\0\0II" . pack('vVv', 42, 8, 1) . pack('vvVvvV', 0x112, 3, 1, $orientation, 0, 0);
        $rotated = substr($original, 0, 2) . "\xff\xe1" . pack('n', strlen($exif) + 2) . $exif . substr($original, 2);
        $result = getimagesizefromstring(galleryPreview($rotated));
        check($result[0] === ($orientation >= 5 ? 600 : 960), 'EXIF orientation width: ' . $orientation);
        check($result[1] === ($orientation >= 5 ? 960 : 600), 'EXIF orientation height: ' . $orientation);
    }
}
$transparent = imagecreatetruecolor(100, 200);
imagealphablending($transparent, false);
imagesavealpha($transparent, true);
imagefill($transparent, 0, 0, imagecolorallocatealpha($transparent, 0, 0, 0, 127));
ob_start(); imagepng($transparent); $png = ob_get_clean();
$result = imagecreatefromstring(galleryPreview($png));
check(imagesx($result) === 100 && imagesy($result) === 200, 'Small portraits must not be upscaled.');
check((imagecolorat($result, 50, 50) & 0xFFFFFF) !== 0, 'Transparency must not become black.');
$rejected = false;
try { galleryDecode('data:text/html;base64,SGk='); } catch (Throwable $error) { $rejected = true; }
check($rejected, 'Non-image data must be rejected.');
if (getenv('GALLERY_TEST_OUTPUT')) {
    file_put_contents(getenv('GALLERY_TEST_OUTPUT') . '/original.jpg', $original);
    file_put_contents(getenv('GALLERY_TEST_OUTPUT') . '/preview.jpg', $preview);
}
echo 'Preview checks passed: dimensions, compression, EXIF orientations, transparency, original preservation, invalid input.' . PHP_EOL;
echo 'Original ' . strlen($original) . ' bytes; preview ' . strlen($preview) . ' bytes.' . PHP_EOL;
