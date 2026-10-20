<?php

declare(strict_types=1);

namespace PaperTrail;

use PDO;

final class Auth
{
    public const COOKIE = 'pt_session';

    public static function needsSetup(): bool
    {
        return (int) Database::pdo()->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0;
    }

    public static function setup(string $displayName, string $password, string $userAgent): array
    {
        $displayName = trim($displayName);
        if ($displayName === '' || strlen($displayName) > 80) {
            throw new HttpException(400, 'Please choose a display name.');
        }
        self::assertPassword($password);
        if (!self::needsSetup()) {
            throw new HttpException(409, 'This journal already has an owner.');
        }
        $now = Database::now();
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('INSERT INTO users (display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)');
        $stmt->execute([$displayName, password_hash($password, PASSWORD_DEFAULT), $now, $now]);
        $userId = (int) $pdo->lastInsertId();
        $year = (int) gmdate('Y');
        $pdo->prepare('INSERT INTO reading_goals (year, target_count) VALUES (?, ?)')->execute([$year, 24]);
        $token = self::issue($userId, $userAgent);
        return ['user' => self::publicUser($userId), 'token' => $token];
    }

    public static function login(string $password, string $ip, string $userAgent): array
    {
        if (self::needsSetup()) {
            throw new HttpException(409, 'Set up your journal before signing in.');
        }
        self::assertNotThrottled($ip);
        $user = Database::pdo()->query('SELECT * FROM users ORDER BY id ASC LIMIT 1')->fetch();
        if (!$user || !password_verify($password, (string) $user['password_hash'])) {
            self::recordFailure($ip);
            throw new HttpException(401, 'That password does not match.');
        }
        $token = self::issue((int) $user['id'], $userAgent);
        return ['user' => self::publicUser((int) $user['id']), 'token' => $token];
    }

    public static function logout(?string $token): void
    {
        if ($token === null || $token === '') {
            return;
        }
        $stmt = Database::pdo()->prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL');
        $stmt->execute([Database::now(), self::hashToken($token)]);
    }

    public static function userFromToken(?string $token): ?array
    {
        if ($token === null || $token === '') {
            return null;
        }
        $stmt = Database::pdo()->prepare(
            'SELECT u.id, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?'
        );
        $stmt->execute([self::hashToken($token), Database::now()]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        return ['id' => (int) $row['id'], 'displayName' => $row['display_name']];
    }

    public static function requireUser(?string $token): array
    {
        $user = self::userFromToken($token);
        if (!$user) {
            throw new HttpException(401, 'Please sign in to open your journal.');
        }
        return $user;
    }

    public static function updateDisplayName(int $userId, string $displayName): array
    {
        $displayName = trim($displayName);
        if ($displayName === '' || strlen($displayName) > 80) {
            throw new HttpException(400, 'Please choose a display name.');
        }
        $stmt = Database::pdo()->prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?');
        $stmt->execute([$displayName, Database::now(), $userId]);
        return self::publicUser($userId);
    }

    public static function resetPassword(string $password): void
    {
        self::assertPassword($password);
        $pdo = Database::pdo();
        $user = $pdo->query('SELECT id FROM users ORDER BY id ASC LIMIT 1')->fetch();
        if (!$user) {
            throw new HttpException(409, 'Set up the journal before resetting a password.');
        }
        $pdo->prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), Database::now(), $user['id']]);
        $pdo->prepare('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL')->execute([Database::now()]);
    }

    private static function issue(int $userId, string $userAgent): string
    {
        $token = bin2hex(random_bytes(32));
        $stmt = Database::pdo()->prepare(
            'INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, created_at) VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $userId,
            self::hashToken($token),
            gmdate('Y-m-d\TH:i:s\Z', time() + 60 * 60 * 24 * 30),
            substr($userAgent, 0, 300),
            Database::now(),
        ]);
        return $token;
    }

    private static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    private static function publicUser(int $id): array
    {
        $stmt = Database::pdo()->prepare('SELECT id, display_name FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return ['id' => (int) $row['id'], 'displayName' => $row['display_name']];
    }

    private static function assertPassword(string $password): void
    {
        if (strlen($password) < 8) {
            throw new HttpException(400, 'Use a password of at least 8 characters.');
        }
    }

    private static function assertNotThrottled(string $ip): void
    {
        $cutoff = gmdate('Y-m-d\TH:i:s\Z', time() - 15 * 60);
        $stmt = Database::pdo()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND created_at > ?');
        $stmt->execute([$ip, $cutoff]);
        if ((int) $stmt->fetchColumn() >= 8) {
            throw new HttpException(429, 'Too many attempts. Wait a few minutes and try again.');
        }
    }

    private static function recordFailure(string $ip): void
    {
        Database::pdo()->prepare('INSERT INTO login_attempts (ip, created_at) VALUES (?, ?)')
            ->execute([$ip, Database::now()]);
    }
}

function settings_get(): array
{
    $settings = ['theme' => 'light', 'shelfView' => 'shelf', 'shelfStyle' => 'mixed', 'shelfArrange' => 'free', 'shelfOrder' => ''];
    $rows = Database::pdo()->query('SELECT key, value FROM settings')->fetchAll();
    foreach ($rows as $row) {
        if ($row['key'] === 'theme' && in_array($row['value'], ['light', 'dark'], true)) {
            $settings['theme'] = $row['value'];
        }
        if ($row['key'] === 'shelfView' && in_array($row['value'], ['gallery', 'shelf'], true)) {
            $settings['shelfView'] = $row['value'];
        }
        if ($row['key'] === 'shelfStyle' && in_array($row['value'], ['spines', 'mixed', 'covers'], true)) {
            $settings['shelfStyle'] = $row['value'];
        }
        if ($row['key'] === 'shelfArrange' && in_array($row['value'], ['author', 'read', 'genre', 'free'], true)) {
            $settings['shelfArrange'] = $row['value'];
        }
        if ($row['key'] === 'shelfOrder' && is_string($row['value']) && preg_match('/^(\d+)?(,\d+)*$/', $row['value']) === 1) {
            $settings['shelfOrder'] = $row['value'];
        }
    }
    return $settings;
}

function settings_put(array $patch): array
{
    $pdo = Database::pdo();
    $stmt = $pdo->prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    if (isset($patch['theme'])) {
        if (!in_array($patch['theme'], ['light', 'dark'], true)) {
            throw new HttpException(400, 'Choose the warm light or cozy dark theme.');
        }
        $stmt->execute(['theme', $patch['theme']]);
    }
    if (isset($patch['shelfView'])) {
        if (!in_array($patch['shelfView'], ['gallery', 'shelf'], true)) {
            throw new HttpException(400, 'Choose gallery or shelf.');
        }
        $stmt->execute(['shelfView', $patch['shelfView']]);
    }
    if (isset($patch['shelfStyle'])) {
        if (!in_array($patch['shelfStyle'], ['spines', 'mixed', 'covers'], true)) {
            throw new HttpException(400, 'Choose spines, a mix, or covers.');
        }
        $stmt->execute(['shelfStyle', $patch['shelfStyle']]);
    }
    if (isset($patch['shelfArrange'])) {
        if (!in_array($patch['shelfArrange'], ['author', 'read', 'genre', 'free'], true)) {
            throw new HttpException(400, 'Choose author, date read, genre, or your own order.');
        }
        $stmt->execute(['shelfArrange', $patch['shelfArrange']]);
    }
    if (isset($patch['shelfOrder'])) {
        $order = $patch['shelfOrder'];
        if (!is_string($order) || strlen($order) > 8000 || preg_match('/^(\d+)?(,\d+)*$/', $order) !== 1) {
            throw new HttpException(400, 'That shelf order could not be saved.');
        }
        $stmt->execute(['shelfOrder', $order]);
    }
    return settings_get();
}
