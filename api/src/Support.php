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

    public static function driver(): string
    {
        return env('PAPER_TRAIL_DB_DRIVER') === 'mysql' ? 'mysql' : 'sqlite';
    }

    public static function disconnect(): void
    {
        self::$pdo = null;
    }

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        if (self::driver() === 'mysql') {
            $name = env('PAPER_TRAIL_DB_NAME');
            if ($name === null) {
                throw new RuntimeException('The MySQL database name is missing.');
            }
            self::$pdo = open_mysql(
                env('PAPER_TRAIL_DB_HOST') ?? 'localhost',
                (int) (env('PAPER_TRAIL_DB_PORT') ?? '3306'),
                $name,
                env('PAPER_TRAIL_DB_USER') ?? '',
                env_raw('PAPER_TRAIL_DB_PASSWORD'),
                false
            );
            return self::$pdo;
        }

        $path = env('PAPER_TRAIL_DB_PATH');
        if ($path === null || $path === '') {
            if (!database_configured()) {
                throw new RuntimeException('The database has not been chosen yet.');
            }
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
        $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
        if ($mysql) {
            $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(190) PRIMARY KEY, applied_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        } else {
            $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
        }
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
            if ($mysql) {
                foreach (split_sql(mysql_migration_sql($sql)) as $statement) {
                    $pdo->exec(mysql_statement($statement));
                }
                $stmt = $pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
                $stmt->execute([$version, self::now()]);
                continue;
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
    $value = env_raw($key);
    return $value === '' ? null : $value;
}

function env_raw(string $key): string
{
    $value = $_ENV[$key] ?? getenv($key);
    if ($value === false || $value === null) {
        return '';
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
        if ($value !== '' && $value[0] === '"' && str_ends_with($value, '"')) {
            $value = stripcslashes(substr($value, 1, -1));
        } elseif ($value !== '' && $value[0] === "'" && str_ends_with($value, "'")) {
            $value = substr($value, 1, -1);
        }
        if ($key === '' || getenv($key) !== false) {
            continue;
        }
        putenv($key . '=' . $value);
        $_ENV[$key] = $value;
    }
}

function database_configured(): bool
{
    if (Database::driver() === 'mysql') {
        return env('PAPER_TRAIL_DB_NAME') !== null && env('PAPER_TRAIL_DB_USER') !== null;
    }
    if (env('PAPER_TRAIL_DB_PATH') !== null) {
        return true;
    }
    return is_file(Database::root() . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'paper-trail.sqlite');
}

function ensure_env_file(): void
{
    if (env('PAPER_TRAIL_DB_PATH') !== null || Database::driver() === 'mysql') {
        return;
    }
    if (is_file(Database::root() . DIRECTORY_SEPARATOR . '.env')) {
        return;
    }
    write_env_file([
        'APP_KEY' => bin2hex(random_bytes(32)),
        'PAPER_TRAIL_DB_DRIVER' => 'sqlite',
        'PAPER_TRAIL_DB_PATH' => '',
        'PAPER_TRAIL_DB_HOST' => '',
        'PAPER_TRAIL_DB_PORT' => '',
        'PAPER_TRAIL_DB_NAME' => '',
        'PAPER_TRAIL_DB_USER' => '',
        'PAPER_TRAIL_DB_PASSWORD' => '',
        'GITHUB_TOKEN' => '',
    ]);
}

function configure_database(array $input): void
{
    $driver = (string) ($input['driver'] ?? 'sqlite');
    if ($driver === 'sqlite') {
        if (!extension_loaded('pdo_sqlite')) {
            throw new HttpException(400, 'Enable the PHP SQLite extension (pdo_sqlite), or choose MySQL.');
        }
        ensure_env_file();
        Database::disconnect();
        Database::migrate();
        return;
    }
    if ($driver !== 'mysql') {
        throw new HttpException(400, 'Choose MySQL or a SQLite file.');
    }
    $config = mysql_config($input);
    try {
        open_mysql($config['host'], $config['port'], $config['name'], $config['user'], $config['password'], true);
    } catch (PDOException $error) {
        throw new HttpException(400, mysql_error_message($error));
    }
    $path = Database::root() . DIRECTORY_SEPARATOR . '.env';
    write_env_file([
        'APP_KEY' => bin2hex(random_bytes(32)),
        'PAPER_TRAIL_DB_DRIVER' => 'mysql',
        'PAPER_TRAIL_DB_HOST' => $config['host'],
        'PAPER_TRAIL_DB_PORT' => (string) $config['port'],
        'PAPER_TRAIL_DB_NAME' => $config['name'],
        'PAPER_TRAIL_DB_USER' => $config['user'],
        'PAPER_TRAIL_DB_PASSWORD' => $config['password'],
        'PAPER_TRAIL_DB_PATH' => '',
        'GITHUB_TOKEN' => '',
    ]);
    try {
        Database::disconnect();
        install_mysql_tables();
    } catch (Throwable $error) {
        try {
            discard_empty_install_tables(Database::pdo());
        } catch (Throwable) {
            // The partial tables could not be removed. The message below still explains the failure.
        }
        if (is_file($path)) {
            unlink($path);
        }
        clear_database_env();
        Database::disconnect();
        throw new HttpException(400, 'MySQL accepted the login, but the shelves could not be created. ' . mysql_failure_detail($error));
    }
}

function install_mysql_tables(): void
{
    try {
        Database::migrate();
    } catch (Throwable) {
        try {
            discard_empty_install_tables(Database::pdo());
        } catch (Throwable) {
            // Dropping the half-built tables failed. The retry below reports the real error.
        }
        Database::disconnect();
        Database::migrate();
    }
}

function discard_empty_install_tables(PDO $pdo): void
{
    try {
        $count = $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        if ((int) $count > 0) {
            return;
        }
    } catch (Throwable) {
        // The owner table was never created, so the other shelf tables can be cleared.
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
    foreach ([
        'book_tags',
        'tags',
        'recommendations',
        'contacts',
        'quotes',
        'journal_entries',
        'reading_sessions',
        'library_entries',
        'books',
        'login_attempts',
        'sessions',
        'users',
        'reading_goals',
        'import_staging',
        'import_runs',
        'settings',
        'error_events',
        'shelf_decorations',
        'schema_migrations',
    ] as $table) {
        $pdo->exec('DROP TABLE IF EXISTS ' . mysql_identifier($table));
    }
    $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
}

function mysql_failure_detail(Throwable $error): string
{
    $message = preg_replace('/using password:\s*\w+/i', 'using password: [hidden]', $error->getMessage()) ?? $error->getMessage();
    $message = trim(preg_replace('/\s+/', ' ', $message) ?? $message);
    if (strlen($message) > 280) {
        $message = substr($message, 0, 277) . '...';
    }
    return $message !== '' ? $message : 'The database refused the shelf tables.';
}

function mysql_statement(string $statement): string
{
    if (preg_match('/^CREATE TABLE\b/i', $statement) === 1 && !str_contains($statement, 'ENGINE=')) {
        return $statement . ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    }
    return $statement;
}

function mysql_config(array $input): array
{
    $host = trim((string) ($input['host'] ?? 'localhost'));
    $port = (int) ($input['port'] ?? 3306);
    $name = trim((string) ($input['name'] ?? ''));
    $user = trim((string) ($input['user'] ?? ''));
    $password = (string) ($input['password'] ?? '');
    if ($host === '' || preg_match('/^[A-Za-z0-9._:-]+$/', $host) !== 1) {
        throw new HttpException(400, 'Enter the MySQL host, such as localhost.');
    }
    if ($port < 1 || $port > 65535) {
        throw new HttpException(400, 'Enter a MySQL port between 1 and 65535.');
    }
    if ($name === '' || preg_match('/^[A-Za-z0-9_-]+$/', $name) !== 1) {
        throw new HttpException(400, 'Enter the MySQL database name using letters, numbers, and underscores.');
    }
    if ($user === '' || strlen($user) > 80 || preg_match('/^[A-Za-z0-9_@.%$-]+$/', $user) !== 1) {
        throw new HttpException(400, 'Enter the MySQL username.');
    }
    if (str_contains($password, "\n") || str_contains($password, "\r")) {
        throw new HttpException(400, 'The MySQL password cannot contain a line break.');
    }
    if (!extension_loaded('pdo_mysql')) {
        throw new HttpException(400, 'Enable the PHP MySQL extension (pdo_mysql), then try again.');
    }
    return ['host' => $host, 'port' => $port, 'name' => $name, 'user' => $user, 'password' => $password];
}

function open_mysql(string $host, int $port, string $database, string $user, string $password, bool $createDatabase): PDO
{
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    if (defined('PDO::MYSQL_ATTR_CONNECT_TIMEOUT')) {
        $options[PDO::MYSQL_ATTR_CONNECT_TIMEOUT] = 5;
    }
    $dsn = 'mysql:host=' . $host . ';port=' . $port . ';dbname=' . $database . ';charset=utf8mb4';
    try {
        $pdo = new PDO($dsn, $user, $password, $options);
    } catch (PDOException $error) {
        $code = (int) ($error->errorInfo[1] ?? 0);
        if (!$createDatabase || $code !== 1049) {
            throw $error;
        }
        $server = new PDO('mysql:host=' . $host . ';port=' . $port . ';charset=utf8mb4', $user, $password, $options);
        $server->exec('CREATE DATABASE ' . mysql_identifier($database) . ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $pdo = new PDO($dsn, $user, $password, $options);
    }
    $pdo->exec('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
    return $pdo;
}

function mysql_identifier(string $name): string
{
    return '`' . str_replace('`', '``', $name) . '`';
}

function mysql_error_message(PDOException $error): string
{
    $code = (int) ($error->errorInfo[1] ?? 0);
    if ($code === 1045) {
        return 'MySQL refused that username or password.';
    }
    if ($code === 1044) {
        return 'That MySQL user cannot use this database.';
    }
    if ($code === 1049) {
        return 'That MySQL database does not exist, and it could not be created. Create it in the host panel, then try again.';
    }
    if ($code === 2002 || $code === 2003) {
        return 'Could not reach MySQL. Check the host and port.';
    }
    return 'Could not connect to MySQL. Check the host, database, username, and password.';
}

function write_env_file(array $values): void
{
    $path = Database::root() . DIRECTORY_SEPARATOR . '.env';
    $body = '';
    foreach ($values as $key => $value) {
        $body .= env_assignment((string) $key, (string) $value);
    }
    if (file_put_contents($path, $body) === false) {
        throw new HttpException(500, 'The site folder is not writable, so .env could not be created.');
    }
    load_env_file($path);
}

function env_assignment(string $key, string $value): string
{
    if ($value === '' || preg_match('/^[A-Za-z0-9._\/:-]*$/', $value) === 1) {
        return $key . '=' . $value . "\n";
    }
    return $key . '="' . str_replace(['\\', '"'], ['\\\\', '\\"'], $value) . "\"\n";
}

function clear_database_env(): void
{
    foreach ([
        'PAPER_TRAIL_DB_DRIVER',
        'PAPER_TRAIL_DB_HOST',
        'PAPER_TRAIL_DB_PORT',
        'PAPER_TRAIL_DB_NAME',
        'PAPER_TRAIL_DB_USER',
        'PAPER_TRAIL_DB_PASSWORD',
    ] as $key) {
        putenv($key);
        unset($_ENV[$key]);
    }
}

function adapt_sql(string $sql): string
{
    if (Database::driver() !== 'mysql') {
        return $sql;
    }
    $sql = str_replace(' COLLATE NOCASE', '', $sql);
    $sql = str_replace('INSERT OR IGNORE', 'INSERT IGNORE', $sql);
    $sql = str_replace(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value',
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        $sql
    );
    $sql = str_replace(
        'INSERT INTO tags (name, source) VALUES (?, ?) ON CONFLICT(name) DO NOTHING',
        'INSERT IGNORE INTO tags (name, source) VALUES (?, ?)',
        $sql
    );
    $sql = str_replace(
        'ON CONFLICT(contact_id, book_id) DO UPDATE SET note = excluded.note, shared_at = COALESCE(excluded.shared_at, recommendations.shared_at), updated_at = excluded.updated_at',
        'ON DUPLICATE KEY UPDATE note = VALUES(note), shared_at = COALESCE(VALUES(shared_at), shared_at), updated_at = VALUES(updated_at)',
        $sql
    );
    $sql = str_replace(
        'ON CONFLICT(year) DO UPDATE SET target_count = excluded.target_count',
        'ON DUPLICATE KEY UPDATE target_count = VALUES(target_count)',
        $sql
    );
    return $sql;
}

function mysql_migration_sql(string $sql): string
{
    $sql = str_replace('COLLATE NOCASE', '', $sql);
    $sql = str_replace('abs(random()) % 3', 'FLOOR(RAND() * 3)', $sql);
    $sql = str_replace(
        'CREATE UNIQUE INDEX idx_books_goodreads ON books (goodreads_book_id) WHERE goodreads_book_id IS NOT NULL',
        'CREATE UNIQUE INDEX idx_books_goodreads ON books (goodreads_book_id)',
        $sql
    );
    $sql = preg_replace('/\bid INTEGER PRIMARY KEY\b/', 'id INTEGER PRIMARY KEY AUTO_INCREMENT', $sql) ?? $sql;
    $sql = str_replace('token_hash TEXT NOT NULL UNIQUE', 'token_hash VARCHAR(64) NOT NULL UNIQUE', $sql);
    $sql = str_replace('name TEXT NOT NULL UNIQUE', 'name VARCHAR(120) NOT NULL UNIQUE', $sql);
    $sql = str_replace('token TEXT PRIMARY KEY', 'token VARCHAR(80) PRIMARY KEY', $sql);
    $sql = str_replace('key TEXT PRIMARY KEY', '`key` VARCHAR(80) PRIMARY KEY', $sql);
    $sql = str_replace('fingerprint TEXT NOT NULL', 'fingerprint VARCHAR(64) NOT NULL', $sql);
    $sql = str_replace('ip TEXT NOT NULL', 'ip VARCHAR(45) NOT NULL', $sql);
    $sql = str_replace('created_at TEXT NOT NULL', 'created_at VARCHAR(40) NOT NULL', $sql);
    $sql = str_replace('date_finished TEXT', 'date_finished VARCHAR(40)', $sql);
    $sql = str_replace(
        "status TEXT NOT NULL CHECK (status IN ('want', 'reading', 'finished', 'dnf'))",
        "status VARCHAR(20) NOT NULL CHECK (status IN ('want', 'reading', 'finished', 'dnf'))",
        $sql
    );
    $sql = str_replace('isbn10 TEXT', 'isbn10 VARCHAR(20)', $sql);
    $sql = str_replace('isbn13 TEXT', 'isbn13 VARCHAR(20)', $sql);
    $sql = str_replace('open_library_work_key TEXT', 'open_library_work_key VARCHAR(80)', $sql);
    $sql = str_replace('goodreads_book_id TEXT', 'goodreads_book_id VARCHAR(32)', $sql);
    $sql = str_replace("source TEXT NOT NULL DEFAULT 'manual'", "source VARCHAR(40) NOT NULL DEFAULT 'manual'", $sql);
    $sql = str_replace("source TEXT NOT NULL DEFAULT 'user'", "source VARCHAR(40) NOT NULL DEFAULT 'user'", $sql);
    $sql = str_replace("kind TEXT NOT NULL DEFAULT 'journal'", "kind VARCHAR(40) NOT NULL DEFAULT 'journal'", $sql);
    $sql = str_replace("TEXT NOT NULL DEFAULT '[]'", 'LONGTEXT NOT NULL', $sql);
    $sql = str_replace("TEXT NOT NULL DEFAULT ''", 'LONGTEXT NOT NULL', $sql);
    return $sql;
}

function split_sql(string $sql): array
{
    $parts = preg_split('/;\s*(?:\R|$)/', $sql) ?: [];
    $statements = [];
    foreach ($parts as $part) {
        $part = trim($part);
        if ($part !== '') {
            $statements[] = $part;
        }
    }
    return $statements;
}

function install_status(): array
{
    $phpOk = PHP_VERSION_ID >= 80100;
    $sqlite = extension_loaded('pdo_sqlite');
    $mysql = extension_loaded('pdo_mysql');
    $root = Database::root();
    $data = $root . DIRECTORY_SEPARATOR . 'data';
    $dataWritable = (is_dir($data) && is_writable($data)) || (!is_dir($data) && is_writable($root));
    $configured = database_configured();
    $needsSetup = false;
    $ready = false;
    if ($phpOk && $dataWritable && $configured) {
        try {
            $needsSetup = Auth::needsSetup();
            $ready = true;
        } catch (Throwable) {
            $ready = false;
        }
    } elseif ($phpOk && $dataWritable && ($sqlite || $mysql)) {
        $needsSetup = true;
        $ready = true;
    }
    return [
        'needsSetup' => $needsSetup,
        'configured' => $configured,
        'driver' => $configured ? Database::driver() : null,
        'php' => PHP_VERSION,
        'phpOk' => $phpOk,
        'sqlite' => $sqlite,
        'mysql' => $mysql,
        'dataWritable' => $dataWritable,
        'ready' => $ready,
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
    if (str_contains($text, 'could not find driver') || str_contains($text, 'pdo_sqlite') || str_contains($text, 'pdo_mysql')) {
        return 'Enable the PHP database extension this site is using (pdo_mysql or pdo_sqlite), then reload this page.';
    }
    if (str_contains($text, 'Access denied') || str_contains($text, '[2002]') || str_contains($text, '[2003]')) {
        return 'Could not reach MySQL. Check the host, database, username, and password in .env, then reload this page.';
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
