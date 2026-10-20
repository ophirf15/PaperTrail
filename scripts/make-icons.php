<?php

declare(strict_types=1);

if (!function_exists('imagecreatetruecolor')) {
    fwrite(STDERR, "GD is not available; SVG icon remains.\n");
    exit(0);
}

$dir = dirname(__DIR__) . '/frontend/public';
foreach ([192, 512] as $size) {
    $image = imagecreatetruecolor($size, $size);
    if ($image === false) {
        exit(1);
    }
    $sage = imagecolorallocate($image, 79, 98, 73);
    $paper = imagecolorallocate($image, 246, 240, 230);
    $ink = imagecolorallocate($image, 79, 98, 73);
    imagefilledrectangle($image, 0, 0, $size, $size, $sage);
    $left = (int) ($size * 0.22);
    $top = (int) ($size * 0.16);
    $right = (int) ($size * 0.78);
    $bottom = (int) ($size * 0.84);
    imagefilledrectangle($image, $left, $top, $right, $bottom, $paper);
    $y = (int) ($size * 0.34);
    imagesetthickness($image, max(2, (int) ($size / 64)));
    foreach ([0.34, 0.44, 0.54] as $ratio) {
        $y = (int) ($size * $ratio);
        imageline($image, (int) ($size * 0.32), $y, (int) ($size * 0.68), $y, $ink);
    }
    imagepng($image, $dir . "/icon-{$size}.png");
    imagedestroy($image);
}

echo "icons written\n";
