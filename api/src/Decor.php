<?php

declare(strict_types=1);

namespace PaperTrail;

final class Decor
{
    public const KINDS = ['plant', 'fern', 'flowers', 'mug', 'candle', 'glasses', 'camera', 'stack', 'wooble'];

    public static function list(): array
    {
        $rows = Database::pdo()->query('SELECT * FROM shelf_decorations ORDER BY shelf_index, id')->fetchAll();
        return array_map(static function (array $row): array {
            return [
                'id' => (int) $row['id'],
                'shelfIndex' => (int) $row['shelf_index'],
                'slot' => (int) $row['slot'],
                'variant' => (int) ($row['variant'] ?? 0),
                'kind' => $row['kind'],
            ];
        }, $rows);
    }

    public static function add(int $shelf, string $kind, int $slot = 0): array
    {
        if ($shelf < 0 || $shelf > 12) {
            throw new HttpException(400, 'That shelf is outside the bookcase.');
        }
        if ($slot < 0 || $slot > 24) {
            throw new HttpException(400, 'That spot is not on the shelf.');
        }
        if (!in_array($kind, self::KINDS, true)) {
            throw new HttpException(400, 'That object is not in the cupboard.');
        }
        $count = Database::pdo()->prepare('SELECT COUNT(*) FROM shelf_decorations WHERE shelf_index = ?');
        $count->execute([$shelf]);
        if ((int) $count->fetchColumn() >= 4) {
            throw new HttpException(400, 'This shelf is already dressed. Remove something first.');
        }
        $variant = random_int(0, 2);
        $now = Database::now();
        Database::pdo()->prepare('INSERT INTO shelf_decorations (shelf_index, slot, kind, variant, created_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$shelf, $slot, $kind, $variant, $now]);
        return ['id' => (int) Database::pdo()->lastInsertId(), 'shelfIndex' => $shelf, 'slot' => $slot, 'variant' => $variant, 'kind' => $kind];
    }

    public static function remove(int $id): void
    {
        Database::pdo()->prepare('DELETE FROM shelf_decorations WHERE id = ?')->execute([$id]);
    }

    public static function seedDefaults(): void
    {
        $count = (int) Database::pdo()->query('SELECT COUNT(*) FROM shelf_decorations')->fetchColumn();
        if ($count > 0) {
            return;
        }
        foreach ([[0, 'plant'], [0, 'mug'], [1, 'flowers'], [2, 'candle'], [2, 'stack']] as [$shelf, $kind]) {
            self::add($shelf, $kind);
        }
    }
}
