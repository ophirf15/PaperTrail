<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);
$version = trim((string) file_get_contents($root . DIRECTORY_SEPARATOR . 'VERSION'));
if (!preg_match('/^\d+\.\d+\.\d+$/', $version)) {
    fwrite(STDERR, "VERSION must look like 0.1.0\n");
    exit(1);
}
$built = $root . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'index.html';
if (!is_file($built)) {
    fwrite(STDERR, "Build the frontend first: npm run build\n");
    exit(1);
}

$stage = $root . DIRECTORY_SEPARATOR . 'dist' . DIRECTORY_SEPARATOR . 'package';
remove_tree($stage);
if (!mkdir($stage, 0775, true) && !is_dir($stage)) {
    fwrite(STDERR, "Could not create the package folder.\n");
    exit(1);
}

$include = [
    '.htaccess',
    '.env.example',
    'VERSION',
    'api',
    'public',
    'data/.htaccess',
    'scripts/reset-password.php',
];
foreach ($include as $relative) {
    $from = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    $to = $stage . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    if (is_dir($from)) {
        copy_tree($from, $to);
        continue;
    }
    if (!is_file($from)) {
        fwrite(STDERR, "Missing {$relative}\n");
        exit(1);
    }
    $parent = dirname($to);
    if (!is_dir($parent)) {
        mkdir($parent, 0775, true);
    }
    copy($from, $to);
}

$zipPath = $root . DIRECTORY_SEPARATOR . 'dist' . DIRECTORY_SEPARATOR . 'paper-trail-v' . $version . '-update.zip';
if (is_file($zipPath)) {
    unlink($zipPath);
}
$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE) !== true) {
    fwrite(STDERR, "Could not create the release zip.\n");
    exit(1);
}
$baseLength = strlen($stage) + 1;
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($stage, FilesystemIterator::SKIP_DOTS)
);
foreach ($iterator as $file) {
    if (!$file->isFile()) {
        continue;
    }
    $name = str_replace('\\', '/', substr($file->getPathname(), $baseLength));
    $zip->addFile($file->getPathname(), $name);
}
$zip->close();
remove_tree($stage);
fwrite(STDOUT, $zipPath . "\n");

function copy_tree(string $from, string $to): void
{
    if (!is_dir($to) && !mkdir($to, 0775, true) && !is_dir($to)) {
        fwrite(STDERR, "Could not create {$to}\n");
        exit(1);
    }
    $items = scandir($from);
    if ($items === false) {
        return;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $source = $from . DIRECTORY_SEPARATOR . $item;
        $dest = $to . DIRECTORY_SEPARATOR . $item;
        if (is_dir($source)) {
            copy_tree($source, $dest);
            continue;
        }
        copy($source, $dest);
    }
}

function remove_tree(string $path): void
{
    if (!is_dir($path)) {
        return;
    }
    $items = scandir($path);
    if ($items === false) {
        return;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $target = $path . DIRECTORY_SEPARATOR . $item;
        if (is_dir($target)) {
            remove_tree($target);
            continue;
        }
        unlink($target);
    }
    rmdir($path);
}
