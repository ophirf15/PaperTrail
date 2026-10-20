<?php

declare(strict_types=1);

namespace PaperTrail;

final class Updater
{
    public const ALLOWED_HOSTS = [
        'api.github.com',
        'github.com',
        'objects.githubusercontent.com',
        'release-assets.githubusercontent.com',
    ];

    public static function isAllowedAssetUrl(string $url): bool
    {
        $parts = parse_url($url);
        if (!is_array($parts)) {
            return false;
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        return $scheme === 'https' && in_array($host, self::ALLOWED_HOSTS, true);
    }

    public static function preserved(string $relative): bool
    {
        $relative = str_replace('\\', '/', $relative);
        $relative = ltrim($relative, '/');
        if ($relative === '.env' || str_starts_with($relative, '.env')) {
            return true;
        }
        foreach (['data/', 'storage/', 'node_modules/', '.git/'] as $prefix) {
            if ($relative === rtrim($prefix, '/') || str_starts_with($relative, $prefix)) {
                return true;
            }
        }
        return false;
    }

    public static function safeZipPath(string $name): bool
    {
        $name = str_replace('\\', '/', $name);
        if ($name === '' || str_contains($name, '../') || str_starts_with($name, '/')) {
            return false;
        }
        return true;
    }

    public static function check(): array
    {
        $repo = env('PAPER_TRAIL_GITHUB_REPO');
        $current = version();
        if ($repo === null || !preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', $repo)) {
            return ['configured' => false, 'current' => $current, 'update' => null];
        }
        $url = 'https://api.github.com/repos/' . $repo . '/releases/latest';
        if (!self::isAllowedAssetUrl($url)) {
            throw new HttpException(400, 'The update source is not on the allowed list.');
        }
        $context = stream_context_create([
            'http' => [
                'timeout' => 12,
                'header' => "User-Agent: PaperTrail\r\nAccept: application/vnd.github+json\r\n",
            ],
        ]);
        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            throw new HttpException(502, 'Could not reach GitHub releases.');
        }
        $release = json_decode($body, true);
        if (!is_array($release)) {
            throw new HttpException(502, 'GitHub returned an unexpected response.');
        }
        $asset = null;
        foreach ($release['assets'] ?? [] as $item) {
            $name = (string) ($item['name'] ?? '');
            $download = (string) ($item['browser_download_url'] ?? '');
            if (str_ends_with($name, '-update.zip') && self::isAllowedAssetUrl($download)) {
                $asset = ['name' => $name, 'url' => $download];
                break;
            }
        }
        $tag = ltrim((string) ($release['tag_name'] ?? ''), 'v');
        return [
            'configured' => true,
            'current' => $current,
            'latest' => $tag,
            'updateAvailable' => $tag !== '' && version_compare($tag, $current, '>'),
            'asset' => $asset,
            'notes' => substr(strip_tags((string) ($release['body'] ?? '')), 0, 500),
            'applyEnabled' => env('PAPER_TRAIL_UPDATES_ENABLED') === 'true',
        ];
    }

    public static function apply(string $confirmVersion): array
    {
        if (env('PAPER_TRAIL_UPDATES_ENABLED') !== 'true') {
            throw new HttpException(403, 'Updates are locked. Set PAPER_TRAIL_UPDATES_ENABLED=true on the server first.');
        }
        $check = self::check();
        if (empty($check['asset']['url'])) {
            throw new HttpException(404, 'No update package was published.');
        }
        if ($confirmVersion !== ($check['latest'] ?? '')) {
            throw new HttpException(400, 'Type the new version to confirm the update.');
        }
        $url = (string) $check['asset']['url'];
        if (!self::isAllowedAssetUrl($url)) {
            throw new HttpException(400, 'That download is not from an allowed host.');
        }
        self::backupDatabase();
        $zipPath = self::download($url);
        $count = self::overlay($zipPath);
        @unlink($zipPath);
        return ['updatedFiles' => $count, 'version' => $check['latest'], 'backup' => true];
    }

    private static function backupDatabase(): void
    {
        if (Database::driver() === 'mysql') {
            self::backupMysql();
            return;
        }
        $source = env('PAPER_TRAIL_DB_PATH') ?: Database::root() . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'paper-trail.sqlite';
        if (!is_file($source)) {
            return;
        }
        $dir = Database::root() . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'backups';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $dest = $dir . DIRECTORY_SEPARATOR . 'pre-update-' . gmdate('Ymd-His') . '.sqlite';
        if (!copy($source, $dest)) {
            throw new HttpException(500, 'The pre-update backup could not be written. The update was not applied.');
        }
    }

    private static function backupMysql(): void
    {
        $pdo = Database::pdo();
        $dir = Database::root() . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'backups';
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new HttpException(500, 'The pre-update backup could not be written. The update was not applied.');
        }
        $dest = $dir . DIRECTORY_SEPARATOR . 'pre-update-' . gmdate('Ymd-His') . '.sql';
        $dump = "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n";
        $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        foreach ($tables as $table) {
            if (!is_string($table) || preg_match('/^[A-Za-z0-9_]+$/', $table) !== 1) {
                continue;
            }
            $quoted = mysql_identifier($table);
            $create = $pdo->query('SHOW CREATE TABLE ' . $quoted)->fetch();
            if (!is_array($create) || !isset($create['Create Table'])) {
                throw new HttpException(500, 'The pre-update backup could not be written. The update was not applied.');
            }
            $dump .= 'DROP TABLE IF EXISTS ' . $quoted . ";\n" . $create['Create Table'] . ";\n";
            $rows = $pdo->query('SELECT * FROM ' . $quoted);
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                $columns = array_map(mysql_identifier(...), array_keys($row));
                $values = array_map(static function (mixed $value) use ($pdo): string {
                    return $value === null ? 'NULL' : $pdo->quote((string) $value);
                }, array_values($row));
                $dump .= 'INSERT INTO ' . $quoted . ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $values) . ");\n";
            }
        }
        $dump .= "SET FOREIGN_KEY_CHECKS=1;\n";
        if (file_put_contents($dest, $dump) === false) {
            throw new HttpException(500, 'The pre-update backup could not be written. The update was not applied.');
        }
    }

    private static function download(string $url): string
    {
        $dir = Database::root() . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'updates';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $path = $dir . DIRECTORY_SEPARATOR . 'update.zip';
        $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 60, 'header' => "User-Agent: PaperTrail\r\n"]]));
        if ($body === false || file_put_contents($path, $body) === false) {
            throw new HttpException(502, 'The update package could not be downloaded.');
        }
        return $path;
    }

    private static function overlay(string $zipPath): int
    {
        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new HttpException(400, 'The update package could not be opened.');
        }
        $root = Database::root();
        $written = 0;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string) $zip->getNameIndex($i);
            if (!self::safeZipPath($name) || self::preserved($name) || str_ends_with($name, '/')) {
                continue;
            }
            $target = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $name);
            $parent = dirname($target);
            if (!is_dir($parent)) {
                mkdir($parent, 0775, true);
            }
            $contents = $zip->getFromIndex($i);
            if ($contents === false) {
                continue;
            }
            file_put_contents($target, $contents);
            $written++;
        }
        $zip->close();
        return $written;
    }
}
