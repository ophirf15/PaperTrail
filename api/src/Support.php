<?php

declare(strict_types=1);

namespace PaperTrail;

use PDO;
use RuntimeException;
use Throwable;

final class HttpException extends RuntimeException
{
    public function __construct(public int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Database
{
    private static ?PDO $pdo = null;

    public static function root(): string
    {
        return dirname(__DIR__, 2);
    }

    public static function now(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z');
    }

    public static function today(): string
    {
        return gmdate('Y-m-d');
    }

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $path = env('PAPER_TRAIL_DB_PATH');
        if ($path === null || $path === '') {
            $dir = self::root() . DIRECTORY_SEPARATOR . 'data';
            if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
                throw new RuntimeException('Could not create the data directory.');
            }
            $path = $dir . DIRECTORY_SEPARATOR . 'paper-trail.sqlite';
        } else {
            $parent = dirname($path);
            if (!is_dir($parent) && !mkdir($parent, 0775, true) && !is_dir($parent)) {
                throw new RuntimeException('Could not create the database directory.');
            }
        }

        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        try {
            $pdo->exec('PRAGMA journal_mode = WAL');
        } catch (Throwable) {
            // Some hosts reject WAL. The default journal is enough.
        }
        self::$pdo = $pdo;
        return $pdo;
    }

    public static function resetForTests(string $path): void
    {
        self::$pdo = null;
        putenv('PAPER_TRAIL_DB_PATH=' . $path);
        $_ENV['PAPER_TRAIL_DB_PATH'] = $path;
    }

    public static function migrate(?PDO $pdo = null): void
    {
        $pdo ??= self::pdo();
        $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
        $files = glob(dirname(__DIR__) . '/migrations/*.sql') ?: [];
        sort($files);
        $have = $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        foreach ($files as $file) {
            $version = basename($file);
            if (in_array($version, $have, true)) {
                continue;
            }
            $sql = file_get_contents($file);
            if ($sql === false) {
                throw new RuntimeException('Could not read migration ' . $version);
            }
            $pdo->beginTransaction();
            try {
                $pdo->exec($sql);
                $stmt = $pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
                $stmt->execute([$version, self::now()]);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
        }
    }
}

function env(string $key): ?string
{
    $value = $_ENV[$key] ?? getenv($key);
    if ($value === false || $value === null || $value === '') {
        return null;
    }
    return (string) $value;
}

function load_env_file(string $path): void
{
    if (!is_file($path)) {
        return;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) {
        return;
    }
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $eq = strpos($line, '=');
        if ($eq === false) {
            continue;
        }
        $key = trim(substr($line, 0, $eq));
        $value = trim(substr($line, $eq + 1));
        if ($value !== '' && ($value[0] === '"' || $value[0] === "'")) {
            $value = trim($value, "\"'");
        }
        if ($key === '' || getenv($key) !== false) {
            continue;
        }
        putenv($key . '=' . $value);
        $_ENV[$key] = $value;
    }
}

function ensure_env_file(): void
{
    if (env('PAPER_TRAIL_DB_PATH') !== null) {
        return;
    }
    $path = Database::root() . DIRECTORY_SEPARATOR . '.env';
    if (is_file($path)) {
        return;
    }
    $body = "APP_KEY=" . bin2hex(random_bytes(32)) . "\n"
        . "PAPER_TRAIL_DB_PATH=\n"
        . "PAPER_TRAIL_GITHUB_REPO=\n"
        . "GITHUB_TOKEN=\n"
        . "PAPER_TRAIL_UPDATES_ENABLED=false\n";
    if (file_put_contents($path, $body) === false) {
        throw new HttpException(500, 'The site folder is not writable, so .env could not be created.');
    }
    load_env_file($path);
}

function install_status(): array
{
    $phpOk = PHP_VERSION_ID >= 80100;
    $sqlite = extension_loaded('pdo_sqlite');
    $root = Database::root();
    $data = $root . DIRECTORY_SEPARATOR . 'data';
    $dataWritable = (is_dir($data) && is_writable($data)) || (!is_dir($data) && is_writable($root));
    $needsSetup = false;
    if ($phpOk && $sqlite && $dataWritable) {
        try {
            $needsSetup = Auth::needsSetup();
        } catch (Throwable) {
            $dataWritable = false;
        }
    }
    return [
        'needsSetup' => $needsSetup,
        'php' => PHP_VERSION,
        'phpOk' => $phpOk,
        'sqlite' => $sqlite,
        'dataWritable' => $dataWritable,
        'ready' => $phpOk && $sqlite && $dataWritable,
    ];
}

function render_startup_failure(Throwable $error): void
{
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $message = startup_message($error);
    if (str_starts_with($uri, '/api')) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => $message]);
        return;
    }
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    $safe = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
    echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Install Paper Trail</title>
  <style>
    body { margin: 0; background: #f3eee4; color: #2f2924; font: 18px/1.5 "Segoe UI", sans-serif; }
    main { max-width: 36rem; margin: 12vh auto; padding: 0 1.2rem; }
    h1 { font-family: Palatino, serif; font-weight: 600; font-size: 2.4rem; line-height: 1; }
  </style>
</head>
<body>
  <main>
    <p>Paper Trail</p>
    <h1>The installer cannot start yet.</h1>
    <p>{$safe}</p>
  </main>
</body>
</html>
HTML;
}

function startup_message(Throwable $error): string
{
    $text = $error->getMessage();
    if (str_contains($text, 'could not find driver') || str_contains($text, 'pdo_sqlite')) {
        return 'Enable the PHP SQLite extension (pdo_sqlite), then reload this page.';
    }
    if (str_contains($text, 'data directory') || str_contains($text, 'database directory') || str_contains($text, 'not writable')) {
        return 'Make this folder writable by PHP so data/ and .env can be created, then reload this page.';
    }
    return 'Something needed for the first run is missing. Check that PHP 8.1 and SQLite are enabled.';
}

function version(): string
{
    $file = Database::root() . DIRECTORY_SEPARATOR . 'VERSION';
    $value = is_file($file) ? trim((string) file_get_contents($file)) : '';
    return $value !== '' ? $value : '0.0.0';
}

function norm(string $value): string
{
    $value = strtolower($value);
    $value = preg_replace('/[^a-z0-9]+/', ' ', $value) ?? '';
    return trim($value);
}

function clean_isbn(?string $value): ?string
{
    if ($value === null) {
        return null;
    }
    $value = trim($value, "=\"' \t\n\r");
    $value = strtoupper(preg_replace('/[^0-9X]/i', '', $value) ?? '');
    if ($value === '') {
        return null;
    }
    return $value;
}

function json_list(mixed $value): array
{
    if (is_array($value)) {
        return array_values(array_filter(array_map(static fn ($item) => trim((string) $item), $value), static fn ($item) => $item !== ''));
    }
    if (!is_string($value) || $value === '') {
        return [];
    }
    $decoded = json_decode($value, true);
    return is_array($decoded) ? json_list($decoded) : [];
}

function redact(string $text): string
{
    $text = preg_replace('/(password|token|authorization|cookie|secret|session|app_key)(["\'\s:=]+)[^\s,"\']+/i', '$1$2[redacted]', $text) ?? $text;
    return $text;
}

function scrub_url(?string $url): ?string
{
    if ($url === null || $url === '') {
        return null;
    }
    $parts = parse_url($url);
    if ($parts === false) {
        return null;
    }
    $path = $parts['path'] ?? '';
    return ($parts['scheme'] ?? 'http') . '://' . ($parts['host'] ?? 'local') . $path;
}

function assert_status(string $status): string
{
    if (!in_array($status, ['want', 'reading', 'finished', 'dnf'], true)) {
        throw new HttpException(400, 'Unknown reading status.');
    }
    return $status;
}

function valid_rating(mixed $rating): ?float
{
    if ($rating === null || $rating === '') {
        return null;
    }
    if (!is_numeric($rating)) {
        throw new HttpException(400, 'Rating must be a number.');
    }
    $value = (float) $rating;
    if ($value < 0.5 || $value > 5 || abs($value * 2 - round($value * 2)) > 0.001) {
        throw new HttpException(400, 'Rating must be between 0.5 and 5 in half-star steps.');
    }
    return $value;
}

function valid_date(?string $value): ?string
{
    if ($value === null || trim($value) === '') {
        return null;
    }
    $value = str_replace('/', '-', trim($value));
    $dt = \DateTimeImmutable::createFromFormat('Y-m-d', substr($value, 0, 10));
    if (!$dt) {
        throw new HttpException(400, 'Dates should look like 2026-04-03.');
    }
    return $dt->format('Y-m-d');
}
