<?php

declare(strict_types=1);

namespace PaperTrail;

final class Journal
{
    public static function saveJournal(int $bookId, string $html): array
    {
        self::requireBook($bookId);
        $clean = Html::sanitize($html);
        $pdo = Database::pdo();
        $now = Database::now();
        $stmt = $pdo->prepare("SELECT id FROM journal_entries WHERE book_id = ? AND kind = 'journal' ORDER BY id ASC LIMIT 1");
        $stmt->execute([$bookId]);
        $id = $stmt->fetchColumn();
        if ($id) {
            $pdo->prepare('UPDATE journal_entries SET body_html = ?, updated_at = ? WHERE id = ?')->execute([$clean, $now, $id]);
        } else {
            $pdo->prepare('INSERT INTO journal_entries (book_id, kind, body_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([$bookId, 'journal', $clean, $now, $now]);
        }
        return ['journalHtml' => $clean, 'savedAt' => $now];
    }

    public static function addNote(int $bookId, string $html): array
    {
        self::requireBook($bookId);
        $clean = Html::sanitize($html);
        if (Html::plain($clean) === '') {
            throw new HttpException(400, 'Write a few words first.');
        }
        $now = Database::now();
        Database::pdo()->prepare('INSERT INTO journal_entries (book_id, kind, body_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$bookId, 'note', $clean, $now, $now]);
        return ['id' => (int) Database::pdo()->lastInsertId(), 'bodyHtml' => $clean, 'createdAt' => $now];
    }

    public static function quotesCreate(int $bookId, array $input): array
    {
        self::requireBook($bookId);
        $body = trim((string) ($input['body'] ?? ''));
        if ($body === '') {
            throw new HttpException(400, 'A quote needs words.');
        }
        if (strlen($body) > 5000) {
            throw new HttpException(400, 'That quote is too long to keep in one card.');
        }
        $now = Database::now();
        Database::pdo()->prepare('INSERT INTO quotes (book_id, body, location, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([
                $bookId,
                $body,
                self::short($input['location'] ?? null, 80),
                self::short($input['note'] ?? null, 1000),
                $now,
                $now,
            ]);
        return self::quote((int) Database::pdo()->lastInsertId());
    }

    public static function quotesUpdate(int $id, array $input): array
    {
        $quote = self::quote($id);
        $body = array_key_exists('body', $input) ? trim((string) $input['body']) : $quote['body'];
        if ($body === '') {
            throw new HttpException(400, 'A quote needs words.');
        }
        Database::pdo()->prepare('UPDATE quotes SET body = ?, location = ?, note = ?, updated_at = ? WHERE id = ?')->execute([
            $body,
            array_key_exists('location', $input) ? self::short($input['location'], 80) : $quote['location'],
            array_key_exists('note', $input) ? self::short($input['note'], 1000) : $quote['note'],
            Database::now(),
            $id,
        ]);
        return self::quote($id);
    }

    public static function quotesDelete(int $id): void
    {
        self::quote($id);
        Database::pdo()->prepare('DELETE FROM quotes WHERE id = ?')->execute([$id]);
    }

    public static function timeline(array $query): array
    {
        $bookId = isset($query['bookId']) && $query['bookId'] !== '' ? (int) $query['bookId'] : null;
        $year = isset($query['year']) && $query['year'] !== '' ? (string) $query['year'] : null;
        $events = [];
        $pdo = Database::pdo();

        $entries = $pdo->query(
            'SELECT e.*, b.title, b.authors_json, b.cover_url FROM library_entries e JOIN books b ON b.id = e.book_id'
        )->fetchAll();
        foreach ($entries as $entry) {
            if ($entry['date_started']) {
                $events[] = self::event('started', $entry['date_started'], $entry, 'Started reading');
            }
            if ($entry['date_finished'] && $entry['status'] === 'finished') {
                $events[] = self::event('finished', $entry['date_finished'], $entry, 'Finished');
            }
            if ($entry['rating_updated_at'] && $entry['rating'] !== null) {
                $events[] = self::event('rated', substr((string) $entry['rating_updated_at'], 0, 10), $entry, 'Rated ' . $entry['rating']);
            }
        }
        $quotes = $pdo->query(
            'SELECT q.*, b.title, b.authors_json, b.cover_url FROM quotes q JOIN books b ON b.id = q.book_id'
        )->fetchAll();
        foreach ($quotes as $quote) {
            $events[] = self::event('quote', substr($quote['created_at'], 0, 10), $quote, $quote['body']);
        }
        $notes = $pdo->query(
            'SELECT j.*, b.title, b.authors_json, b.cover_url FROM journal_entries j JOIN books b ON b.id = j.book_id'
        )->fetchAll();
        foreach ($notes as $note) {
            $plain = Html::plain($note['body_html']);
            if ($plain === '') {
                continue;
            }
            $events[] = self::event($note['kind'] === 'journal' ? 'journal' : 'note', substr($note['updated_at'], 0, 10), $note, $plain);
        }

        $events = array_values(array_filter($events, static function (array $event) use ($bookId, $year): bool {
            if ($bookId !== null && $event['bookId'] !== $bookId) {
                return false;
            }
            if ($year !== null && !str_starts_with($event['at'], $year)) {
                return false;
            }
            return true;
        }));
        usort($events, static fn ($a, $b) => strcmp($b['at'], $a['at']));
        return $events;
    }

    public static function stats(int $year): array
    {
        $pdo = Database::pdo();
        $finished = $pdo->prepare(
            "SELECT b.*, e.rating, e.date_finished, e.status FROM books b JOIN library_entries e ON e.book_id = b.id
             WHERE e.status = 'finished' AND substr(e.date_finished, 1, 4) = ? ORDER BY e.date_finished DESC"
        );
        $finished->execute([(string) $year]);
        $rows = $finished->fetchAll();
        $months = array_fill(1, 12, 0);
        $ratings = [];
        $pages = 0;
        $books = [];
        foreach ($rows as $row) {
            $month = (int) substr((string) $row['date_finished'], 5, 2);
            if ($month >= 1 && $month <= 12) {
                $months[$month]++;
            }
            if ($row['rating'] !== null) {
                $ratings[] = (float) $row['rating'];
            }
            if ($row['page_count']) {
                $pages += (int) $row['page_count'];
            }
            $presented = Library::present($row + [
                'date_added' => null,
                'date_started' => null,
                'current_page' => null,
                'progress_percent' => 100,
                'read_count' => 1,
                'imported_review' => null,
            ], []);
            $books[] = $presented;
        }
        $goalStmt = $pdo->prepare('SELECT target_count, celebrated_at FROM reading_goals WHERE year = ?');
        $goalStmt->execute([$year]);
        $goal = $goalStmt->fetch();
        $allFinished = (int) $pdo->query("SELECT COUNT(*) FROM library_entries WHERE status = 'finished'")->fetchColumn();
        $reading = (int) $pdo->query("SELECT COUNT(*) FROM library_entries WHERE status = 'reading'")->fetchColumn();
        $want = (int) $pdo->query("SELECT COUNT(*) FROM library_entries WHERE status = 'want'")->fetchColumn();
        $avgStmt = $pdo->query('SELECT AVG(rating) FROM library_entries WHERE rating IS NOT NULL');
        $avg = $avgStmt->fetchColumn();
        $allPages = (int) $pdo->query(
            "SELECT COALESCE(SUM(b.page_count), 0) FROM books b JOIN library_entries e ON e.book_id = b.id WHERE e.status = 'finished' AND b.page_count IS NOT NULL"
        )->fetchColumn();
        $favorites = array_values(array_filter($books, static fn ($book) => ($book['rating'] ?? 0) >= 4));
        usort($favorites, static fn ($a, $b) => ($b['rating'] <=> $a['rating']));
        return [
            'year' => $year,
            'finishedThisYear' => count($books),
            'months' => array_values($months),
            'goal' => $goal ? (int) $goal['target_count'] : null,
            'goalCelebrated' => $goal && $goal['celebrated_at'] !== null,
            'favorites' => array_slice($favorites, 0, 8),
            'yearPages' => $pages,
            'yearAverage' => $ratings === [] ? null : round(array_sum($ratings) / count($ratings), 2),
            'totalFinished' => $allFinished,
            'currentlyReading' => $reading,
            'wantToRead' => $want,
            'averageRating' => $avg !== null ? round((float) $avg, 2) : null,
            'totalPages' => $allPages,
            'finishedBooks' => $books,
        ];
    }

    public static function goal(int $year, ?int $target = null): array
    {
        if ($year < 1970 || $year > 2100) {
            throw new HttpException(400, 'Choose a real reading year.');
        }
        $pdo = Database::pdo();
        if ($target !== null) {
            if ($target < 1 || $target > 500) {
                throw new HttpException(400, 'Set a goal between 1 and 500 books.');
            }
            $pdo->prepare(adapt_sql(
                'INSERT INTO reading_goals (year, target_count) VALUES (?, ?)
                 ON CONFLICT(year) DO UPDATE SET target_count = excluded.target_count'
            ))->execute([$year, $target]);
        }
        $stmt = $pdo->prepare('SELECT year, target_count, celebrated_at FROM reading_goals WHERE year = ?');
        $stmt->execute([$year]);
        $row = $stmt->fetch();
        if (!$row) {
            return ['year' => $year, 'target' => null, 'celebrated' => false];
        }
        return ['year' => (int) $row['year'], 'target' => (int) $row['target_count'], 'celebrated' => $row['celebrated_at'] !== null];
    }

    private static function event(string $type, string $at, array $row, string $text): array
    {
        $authors = json_list($row['authors_json']);
        return [
            'type' => $type,
            'at' => $at,
            'bookId' => (int) $row['book_id'],
            'title' => $row['title'],
            'authors' => $authors,
            'coverUrl' => $row['cover_url'],
            'text' => mb_substr($text, 0, 280),
            'rating' => isset($row['rating']) && $row['rating'] !== null ? (float) $row['rating'] : null,
        ];
    }

    private static function quote(int $id): array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM quotes WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new HttpException(404, 'That quote has already been let go.');
        }
        return [
            'id' => (int) $row['id'],
            'bookId' => (int) $row['book_id'],
            'body' => $row['body'],
            'location' => $row['location'],
            'note' => $row['note'],
            'createdAt' => $row['created_at'],
        ];
    }

    private static function requireBook(int $id): void
    {
        $stmt = Database::pdo()->prepare('SELECT id FROM books WHERE id = ?');
        $stmt->execute([$id]);
        if (!$stmt->fetchColumn()) {
            throw new HttpException(404, 'That book is not on your shelves.');
        }
    }

    private static function short(mixed $value, int $max): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        return mb_substr($value, 0, $max);
    }
}
