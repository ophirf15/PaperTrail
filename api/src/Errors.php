<?php

declare(strict_types=1);

namespace PaperTrail;

final class Errors
{
    public static function capture(string $source, string $message, ?string $stack, ?string $url, ?int $userId = null, ?string $userAgent = null, array $breadcrumbs = []): void
    {
        try {
            $message = substr(redact($message), 0, 2000);
            $stack = $stack !== null ? substr(redact($stack), 0, 8000) : null;
            $url = scrub_url($url);
            $crumbs = [];
            foreach (array_slice($breadcrumbs, -20) as $crumb) {
                if (!is_array($crumb)) {
                    continue;
                }
                $crumbs[] = [
                    'at' => substr((string) ($crumb['at'] ?? ''), 0, 40),
                    'label' => substr(redact((string) ($crumb['label'] ?? '')), 0, 180),
                ];
            }
            $fingerprint = hash('sha256', $source . '|' . preg_replace('/\d+/', '#', $message));
            $pdo = Database::pdo();
            $cutoff = gmdate('Y-m-d\TH:i:s\Z', time() - 30 * 24 * 60 * 60);
            $pdo->prepare('DELETE FROM error_events WHERE created_at < ?')->execute([$cutoff]);
            $pdo->prepare(
                'INSERT INTO error_events (source, message, stack, url, user_agent, user_id, breadcrumbs_json, fingerprint, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $source,
                $message,
                $stack,
                $url,
                $userAgent !== null ? substr($userAgent, 0, 300) : null,
                $userId,
                json_encode($crumbs),
                $fingerprint,
                Database::now(),
            ]);
        } catch (\Throwable) {
            // Error reporting must not take the journal down with it.
        }
    }

    public static function list(): array
    {
        $rows = Database::pdo()->query(
            'SELECT id, source, message, url, fingerprint, created_at FROM error_events ORDER BY id DESC LIMIT 40'
        )->fetchAll();
        return array_map(static function (array $row): array {
            return [
                'id' => (int) $row['id'],
                'source' => $row['source'],
                'message' => $row['message'],
                'url' => $row['url'],
                'fingerprint' => $row['fingerprint'],
                'createdAt' => $row['created_at'],
            ];
        }, $rows);
    }
}
