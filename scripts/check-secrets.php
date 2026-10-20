<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$patterns = [
    '/AKIA[0-9A-Z]{16}/',
    '/ghp_[A-Za-z0-9]{20,}/',
    '/github_pat_[A-Za-z0-9_]{20,}/',
    '/sk_live_[A-Za-z0-9]+/',
    '/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/',
];
$skip = ['.git', 'node_modules', 'public/app', 'data', 'vendor'];
$hits = [];

$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
    $path = $file->getPathname();
    $relative = str_replace('\\', '/', substr($path, strlen($root) + 1));
    $ignored = false;
    foreach ($skip as $prefix) {
        if ($relative === $prefix || str_starts_with($relative, $prefix . '/')) {
            $ignored = true;
        }
    }
    if ($ignored || !$file->isFile() || $file->getSize() > 1000000) {
        continue;
    }
    if (preg_match('/\.(png|jpg|jpeg|webp|gif|sqlite|woff2)$/i', $relative)) {
        continue;
    }
    $contents = file_get_contents($path);
    if ($contents === false) {
        continue;
    }
    foreach ($patterns as $pattern) {
        if (preg_match($pattern, $contents, $match, PREG_OFFSET_CAPTURE)) {
            $line = substr_count(substr($contents, 0, $match[0][1]), "\n") + 1;
            $hits[] = $relative . ':' . $line;
        }
    }
}

if ($hits !== []) {
    fwrite(STDERR, "Possible secrets in tracked files:\n" . implode("\n", $hits) . "\n");
    exit(1);
}

echo "No secret-shaped values found.\n";
