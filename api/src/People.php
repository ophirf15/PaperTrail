<?php

declare(strict_types=1);

namespace PaperTrail;

final class People
{
    public static function list(): array
    {
        $rows = Database::pdo()->query('SELECT * FROM contacts ORDER BY name COLLATE NOCASE')->fetchAll();
        return array_map([self::class, 'present'], $rows);
    }

    public static function get(int $id): array
    {
        $contact = self::require($id);
        $stmt = Database::pdo()->prepare(
            'SELECT r.*, b.title, b.authors_json, b.cover_url, e.status FROM recommendations r
             JOIN books b ON b.id = r.book_id JOIN library_entries e ON e.book_id = b.id
             WHERE r.contact_id = ? ORDER BY r.created_at DESC'
        );
        $stmt->execute([$id]);
        $books = array_map(static function (array $row): array {
            return [
                'id' => (int) $row['id'],
                'bookId' => (int) $row['book_id'],
                'title' => $row['title'],
                'authors' => json_list($row['authors_json']),
                'coverUrl' => $row['cover_url'],
                'note' => $row['note'],
                'sharedAt' => $row['shared_at'],
                'status' => $row['status'],
            ];
        }, $stmt->fetchAll());
        $contact['recommendations'] = $books;
        return $contact;
    }

    public static function create(array $input): array
    {
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '' || strlen($name) > 80) {
            throw new HttpException(400, 'A person needs a name.');
        }
        $now = Database::now();
        Database::pdo()->prepare('INSERT INTO contacts (name, nickname, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([
                $name,
                self::optional($input['nickname'] ?? null, 80),
                self::email($input['email'] ?? null),
                self::optional($input['notes'] ?? null, 2000),
                $now,
                $now,
            ]);
        return self::present(self::row((int) Database::pdo()->lastInsertId()));
    }

    public static function update(int $id, array $input): array
    {
        self::require($id);
        $current = self::row($id);
        $name = array_key_exists('name', $input) ? trim((string) $input['name']) : $current['name'];
        if ($name === '') {
            throw new HttpException(400, 'A person needs a name.');
        }
        Database::pdo()->prepare('UPDATE contacts SET name = ?, nickname = ?, email = ?, notes = ?, updated_at = ? WHERE id = ?')
            ->execute([
                $name,
                array_key_exists('nickname', $input) ? self::optional($input['nickname'], 80) : $current['nickname'],
                array_key_exists('email', $input) ? self::email($input['email']) : $current['email'],
                array_key_exists('notes', $input) ? self::optional($input['notes'], 2000) : $current['notes'],
                Database::now(),
                $id,
            ]);
        return self::get($id);
    }

    public static function delete(int $id): void
    {
        self::require($id);
        Database::pdo()->prepare('DELETE FROM contacts WHERE id = ?')->execute([$id]);
    }

    public static function recommend(int $bookId, array $input): array
    {
        $stmt = Database::pdo()->prepare('SELECT id FROM books WHERE id = ?');
        $stmt->execute([$bookId]);
        if (!$stmt->fetchColumn()) {
            throw new HttpException(404, 'That book is not on your shelves.');
        }
        $contactId = (int) ($input['contactId'] ?? 0);
        self::require($contactId);
        $note = self::optional($input['note'] ?? null, 1000);
        $shared = !empty($input['shared']) ? Database::today() : null;
        $now = Database::now();
        Database::pdo()->prepare(
            'INSERT INTO recommendations (contact_id, book_id, note, shared_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(contact_id, book_id) DO UPDATE SET note = excluded.note, shared_at = COALESCE(excluded.shared_at, recommendations.shared_at), updated_at = excluded.updated_at'
        )->execute([$contactId, $bookId, $note, $shared, $now, $now]);
        $row = Database::pdo()->prepare('SELECT id FROM recommendations WHERE contact_id = ? AND book_id = ?');
        $row->execute([$contactId, $bookId]);
        return ['id' => (int) $row->fetchColumn(), 'contactId' => $contactId, 'bookId' => $bookId, 'note' => $note, 'sharedAt' => $shared];
    }

    public static function updateRecommendation(int $id, array $input): array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM recommendations WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new HttpException(404, 'That recommendation is gone.');
        }
        $note = array_key_exists('note', $input) ? self::optional($input['note'], 1000) : $row['note'];
        $shared = $row['shared_at'];
        if (array_key_exists('shared', $input)) {
            $shared = $input['shared'] ? ($row['shared_at'] ?: Database::today()) : null;
        }
        Database::pdo()->prepare('UPDATE recommendations SET note = ?, shared_at = ?, updated_at = ? WHERE id = ?')
            ->execute([$note, $shared, Database::now(), $id]);
        return ['id' => $id, 'contactId' => (int) $row['contact_id'], 'bookId' => (int) $row['book_id'], 'note' => $note, 'sharedAt' => $shared];
    }

    public static function deleteRecommendation(int $id): void
    {
        Database::pdo()->prepare('DELETE FROM recommendations WHERE id = ?')->execute([$id]);
    }

    private static function require(int $id): array
    {
        $row = self::row($id);
        if (!$row) {
            throw new HttpException(404, 'That person is not in your journal.');
        }
        return self::present($row);
    }

    private static function row(int $id): array|false
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM contacts WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    private static function present(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'nickname' => $row['nickname'],
            'email' => $row['email'],
            'notes' => $row['notes'],
        ];
    }

    private static function optional(mixed $value, int $max): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);
        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    private static function email(mixed $value): ?string
    {
        $value = self::optional($value, 200);
        if ($value === null) {
            return null;
        }
        if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw new HttpException(400, 'That email does not look quite right.');
        }
        return $value;
    }
}
