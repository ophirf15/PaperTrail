<?php

declare(strict_types=1);

namespace PaperTrail;

final class Transfer
{
    public static function previewGoodreads(string $csv, string $filename): array
    {
        $rows = self::parseGoodreads($csv);
        $summary = ['total' => count($rows), 'new' => 0, 'duplicates' => 0, 'invalid' => 0];
        $samples = [];
        foreach ($rows as $index => $row) {
            if ($row['title'] === '') {
                $summary['invalid']++;
                $rows[$index]['invalid'] = true;
                continue;
            }
            $existing = Library::findExisting($row['goodreadsBookId'], $row['isbn13'], $row['isbn10'], null, $row['title'], $row['authors']);
            $rows[$index]['existingId'] = $existing;
            if ($existing) {
                $summary['duplicates']++;
            } else {
                $summary['new']++;
            }
            if (count($samples) < 8) {
                $samples[] = [
                    'title' => $row['title'],
                    'authors' => $row['authors'],
                    'status' => $row['status'],
                    'rating' => $row['rating'],
                    'dateFinished' => $row['dateFinished'],
                    'existing' => $existing !== null,
                ];
            }
        }
        $token = bin2hex(random_bytes(16));
        $pdo = Database::pdo();
        $pdo->prepare('DELETE FROM import_staging WHERE expires_at < ?')->execute([Database::now()]);
        $pdo->prepare('INSERT INTO import_staging (token, payload_json, expires_at, created_at) VALUES (?, ?, ?, ?)')
            ->execute([
                $token,
                json_encode($rows),
                gmdate('Y-m-d\TH:i:s\Z', time() + 7200),
                Database::now(),
            ]);
        return [
            'token' => $token,
            'filename' => $filename,
            'counts' => $summary,
            'samples' => $samples,
            'mappings' => [
                'to-read' => 'want',
                'currently-reading' => 'reading',
                'read' => 'finished',
                'dnf' => 'dnf',
            ],
        ];
    }

    public static function commitGoodreads(string $token, string $policy): array
    {
        if (!in_array($policy, ['keep_local', 'use_import', 'fill_empty'], true)) {
            throw new HttpException(400, 'Choose how to handle differences with your journal.');
        }
        $stmt = Database::pdo()->prepare('SELECT payload_json, expires_at FROM import_staging WHERE token = ?');
        $stmt->execute([$token]);
        $staged = $stmt->fetch();
        if (!$staged || $staged['expires_at'] < Database::now()) {
            throw new HttpException(400, 'That import preview expired. Upload the file again.');
        }
        $rows = json_decode((string) $staged['payload_json'], true);
        if (!is_array($rows)) {
            throw new HttpException(400, 'The preview could not be read.');
        }
        $result = ['imported' => 0, 'updated' => 0, 'skipped' => 0, 'failed' => 0, 'protected' => []];
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            foreach ($rows as $row) {
                $pdo->exec('SAVEPOINT import_row');
                try {
                    if (!empty($row['invalid']) || ($row['title'] ?? '') === '') {
                        $result['skipped']++;
                        $pdo->exec('RELEASE SAVEPOINT import_row');
                        continue;
                    }
                    $existing = Library::findExisting($row['goodreadsBookId'] ?? null, $row['isbn13'] ?? null, $row['isbn10'] ?? null, null, $row['title'], $row['authors'] ?? []);
                    if (!$existing) {
                        $book = Library::addHit([
                            'title' => $row['title'],
                            'authors' => $row['authors'],
                            'isbn13' => $row['isbn13'],
                            'isbn10' => $row['isbn10'],
                            'publisher' => $row['publisher'],
                            'publishYear' => $row['publishYear'],
                            'pageCount' => $row['pageCount'],
                            'coverUrl' => $row['isbn13'] || $row['isbn10'] ? 'https://covers.openlibrary.org/b/isbn/' . ($row['isbn13'] ?: $row['isbn10']) . '-L.jpg' : null,
                            'goodreadsBookId' => $row['goodreadsBookId'],
                            'rating' => $row['rating'],
                            'dateAdded' => $row['dateAdded'],
                            'dateFinished' => $row['dateFinished'],
                            'tags' => $row['tags'],
                            'description' => null,
                        ], $row['status'] ?: 'want');
                        self::applyImportedReview((int) $book['id'], $row, true);
                        if (!empty($row['readCount'])) {
                            $pdo->prepare('UPDATE library_entries SET read_count = ? WHERE book_id = ?')
                                ->execute([max(1, (int) $row['readCount']), $book['id']]);
                        }
                        $result['imported']++;
                    } else {
                        self::mergeExisting($existing, $row, $policy, $result);
                        $result['updated']++;
                    }
                    $pdo->exec('RELEASE SAVEPOINT import_row');
                } catch (\Throwable) {
                    $pdo->exec('ROLLBACK TO SAVEPOINT import_row');
                    $result['failed']++;
                }
            }
            $pdo->prepare('INSERT INTO import_runs (source, filename, summary_json, created_at) VALUES (?, ?, ?, ?)')
                ->execute(['goodreads', 'goodreads.csv', json_encode($result), Database::now()]);
            $pdo->prepare('DELETE FROM import_staging WHERE token = ?')->execute([$token]);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        $result['protected'] = array_values(array_unique($result['protected']));
        return $result;
    }

    public static function exportJson(): array
    {
        $pdo = Database::pdo();
        return [
            'format' => 'paper-trail-backup',
            'version' => 1,
            'exportedAt' => Database::now(),
            'settings' => settings_get(),
            'user' => $pdo->query('SELECT display_name FROM users ORDER BY id ASC LIMIT 1')->fetch() ?: null,
            'books' => $pdo->query('SELECT * FROM books')->fetchAll(),
            'library' => $pdo->query('SELECT * FROM library_entries')->fetchAll(),
            'sessions' => $pdo->query('SELECT * FROM reading_sessions')->fetchAll(),
            'journal' => $pdo->query('SELECT * FROM journal_entries')->fetchAll(),
            'quotes' => $pdo->query('SELECT * FROM quotes')->fetchAll(),
            'contacts' => $pdo->query('SELECT * FROM contacts')->fetchAll(),
            'recommendations' => $pdo->query('SELECT * FROM recommendations')->fetchAll(),
            'goals' => $pdo->query('SELECT * FROM reading_goals')->fetchAll(),
            'tags' => $pdo->query('SELECT * FROM tags')->fetchAll(),
            'bookTags' => $pdo->query('SELECT * FROM book_tags')->fetchAll(),
        ];
    }

    public static function exportCsv(): string
    {
        $books = Library::list([]);
        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            throw new HttpException(500, 'Could not prepare the export.');
        }
        fputcsv($handle, ['Title', 'Authors', 'ISBN13', 'ISBN10', 'Status', 'Rating', 'Date Added', 'Date Started', 'Date Finished', 'Pages', 'Current Page', 'Genres', 'Tags', 'Goodreads Book Id']);
        foreach ($books as $book) {
            fputcsv($handle, [
                $book['title'],
                implode('; ', $book['authors']),
                $book['isbn13'],
                $book['isbn10'],
                $book['status'],
                $book['rating'],
                $book['dateAdded'],
                $book['dateStarted'],
                $book['dateFinished'],
                $book['pageCount'],
                $book['currentPage'],
                implode('; ', $book['genres']),
                implode('; ', $book['tags']),
                $book['goodreadsBookId'],
            ]);
        }
        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);
        return $csv === false ? '' : $csv;
    }

    public static function importBackup(string $json, bool $confirm): array
    {
        if (!$confirm) {
            throw new HttpException(400, 'Confirm that this backup should replace your current shelves.');
        }
        $data = json_decode($json, true);
        if (!is_array($data) || ($data['format'] ?? '') !== 'paper-trail-backup') {
            throw new HttpException(400, 'That file is not a Paper Trail backup.');
        }
        $pdo = Database::pdo();
        $pdo->beginTransaction();
        try {
            foreach (['recommendations', 'book_tags', 'quotes', 'journal_entries', 'reading_sessions', 'library_entries', 'books', 'contacts', 'reading_goals', 'tags'] as $table) {
                $pdo->exec('DELETE FROM ' . $table);
            }
            self::insertRows($pdo, 'books', $data['books'] ?? []);
            self::insertRows($pdo, 'library_entries', $data['library'] ?? []);
            self::insertRows($pdo, 'reading_sessions', $data['sessions'] ?? []);
            self::insertRows($pdo, 'journal_entries', $data['journal'] ?? []);
            self::insertRows($pdo, 'quotes', $data['quotes'] ?? []);
            self::insertRows($pdo, 'contacts', $data['contacts'] ?? []);
            self::insertRows($pdo, 'recommendations', $data['recommendations'] ?? []);
            self::insertRows($pdo, 'reading_goals', $data['goals'] ?? []);
            self::insertRows($pdo, 'tags', $data['tags'] ?? []);
            self::insertRows($pdo, 'book_tags', $data['bookTags'] ?? []);
            if (!empty($data['user']['display_name'])) {
                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = ?')->execute([$data['user']['display_name'], Database::now()]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw new HttpException(400, 'The backup could not be restored.');
        }
        return ['restored' => true, 'books' => count($data['books'] ?? [])];
    }

    public static function parseGoodreads(string $csv): array
    {
        if (str_starts_with($csv, "\xEF\xBB\xBF")) {
            $csv = substr($csv, 3);
        }
        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            throw new HttpException(400, 'Could not read that file.');
        }
        fwrite($handle, $csv);
        rewind($handle);
        $header = fgetcsv($handle);
        if (!$header) {
            fclose($handle);
            throw new HttpException(400, 'The file needs a header row.');
        }
        $header = array_map(static fn ($name) => strtolower(trim((string) $name)), $header);
        $rows = [];
        while (($data = fgetcsv($handle)) !== false) {
            if ($data === [null] || $data === false) {
                continue;
            }
            $record = [];
            foreach ($header as $index => $name) {
                $record[$name] = $data[$index] ?? '';
            }
            $authors = array_filter([trim((string) ($record['author'] ?? ''))]);
            $extra = trim((string) ($record['additional authors'] ?? ''));
            if ($extra !== '') {
                foreach (explode(',', $extra) as $name) {
                    $name = trim($name);
                    if ($name !== '') {
                        $authors[] = $name;
                    }
                }
            }
            $exclusive = strtolower(trim((string) ($record['exclusive shelf'] ?? '')));
            $shelves = array_values(array_filter(array_map('trim', explode(',', (string) ($record['bookshelves'] ?? '')))));
            $status = self::mapShelf($exclusive !== '' ? $exclusive : strtolower($shelves[0] ?? 'to-read'));
            $rating = (int) ($record['my rating'] ?? 0);
            $review = trim((string) ($record['my review'] ?? ''));
            $notes = trim((string) ($record['private notes'] ?? ''));
            $rows[] = [
                'goodreadsBookId' => trim((string) ($record['book id'] ?? '')) ?: null,
                'title' => trim((string) ($record['title'] ?? '')),
                'authors' => array_values($authors),
                'isbn13' => clean_isbn($record['isbn13'] ?? null),
                'isbn10' => clean_isbn($record['isbn'] ?? null),
                'publisher' => trim((string) ($record['publisher'] ?? '')) ?: null,
                'publishYear' => (int) ($record['year published'] ?? 0) ?: null,
                'pageCount' => (int) ($record['number of pages'] ?? 0) ?: null,
                'status' => $status,
                'rating' => $rating > 0 ? (float) $rating : null,
                'dateAdded' => self::looseDate($record['date added'] ?? null),
                'dateFinished' => self::looseDate($record['date read'] ?? null),
                'readCount' => (int) ($record['read count'] ?? 0),
                'tags' => array_values(array_filter($shelves, static fn ($shelf) => !in_array(strtolower($shelf), ['to-read', 'currently-reading', 'read', 'dnf'], true))),
                'review' => $review,
                'privateNotes' => $notes,
                'invalid' => false,
            ];
        }
        fclose($handle);
        return $rows;
    }

    public static function mapShelf(string $shelf): string
    {
        return match (strtolower(trim($shelf))) {
            'read', 'finished' => 'finished',
            'currently-reading', 'currently reading', 'reading' => 'reading',
            'dnf', 'did-not-finish', 'did not finish' => 'dnf',
            default => 'want',
        };
    }

    private static function mergeExisting(int $id, array $row, string $policy, array &$result): void
    {
        $pdo = Database::pdo();
        $current = $pdo->prepare('SELECT * FROM library_entries WHERE book_id = ?');
        $current->execute([$id]);
        $entry = $current->fetch();
        if (!$entry) {
            return;
        }
        $status = $entry['status'];
        $rating = $entry['rating'];
        $started = $entry['date_started'];
        $finished = $entry['date_finished'];
        $added = $entry['date_added'];
        $readCount = (int) $entry['read_count'];
        $apply = static function (mixed $local, mixed $incoming) use ($policy): mixed {
            $localEmpty = $local === null || $local === '';
            if ($policy === 'use_import') {
                return $incoming !== null && $incoming !== '' ? $incoming : $local;
            }
            if ($policy === 'fill_empty') {
                return $localEmpty ? $incoming : $local;
            }
            return $local;
        };
        if ($policy !== 'keep_local') {
            $status = $apply($entry['status'], $row['status']);
            $rating = $apply($entry['rating'], $row['rating']);
            $finished = $apply($entry['date_finished'], $row['dateFinished']);
            $added = $apply($entry['date_added'], $row['dateAdded']);
            if ($row['readCount'] && ($policy === 'use_import' || $readCount === 0)) {
                $readCount = max($readCount, (int) $row['readCount']);
            }
        }
        $pdo->prepare('UPDATE library_entries SET status = ?, rating = ?, date_added = ?, date_started = ?, date_finished = ?, read_count = ?, updated_at = ? WHERE book_id = ?')
            ->execute([$status, $rating, $added, $started, $finished, $readCount, Database::now(), $id]);
        $book = $pdo->prepare('SELECT goodreads_book_id, page_count, publisher, publish_year, cover_url, isbn13 FROM books WHERE id = ?');
        $book->execute([$id]);
        $meta = $book->fetch();
        $sets = [];
        $params = [];
        foreach ([
            'goodreads_book_id' => $row['goodreadsBookId'],
            'page_count' => $row['pageCount'],
            'publisher' => $row['publisher'],
            'publish_year' => $row['publishYear'],
            'isbn13' => $row['isbn13'],
            'cover_url' => ($meta['cover_url'] ?? null) ?: ($row['isbn13'] ? 'https://covers.openlibrary.org/b/isbn/' . $row['isbn13'] . '-L.jpg' : null),
        ] as $column => $value) {
            if (($meta[$column] === null || $meta[$column] === '') && $value) {
                $sets[] = $column . ' = ?';
                $params[] = $value;
            }
        }
        if ($sets !== []) {
            $params[] = $id;
            $pdo->prepare('UPDATE books SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        }
        foreach ($row['tags'] as $tag) {
            Library::attachTag($pdo, $id, $tag, 'goodreads');
        }
        self::applyImportedReview($id, $row, false);
        $result['protected'][] = 'journal';
        $result['protected'][] = 'quotes';
        $result['protected'][] = 'recommendations';
    }

    private static function applyImportedReview(int $bookId, array $row, bool $createJournalIfEmpty): void
    {
        $text = trim($row['review'] . ($row['privateNotes'] !== '' ? "\n\n" . $row['privateNotes'] : ''));
        if ($text === '') {
            return;
        }
        Database::pdo()->prepare('UPDATE library_entries SET imported_review = ? WHERE book_id = ?')->execute([$text, $bookId]);
        if (!$createJournalIfEmpty) {
            return;
        }
        $stmt = Database::pdo()->prepare('SELECT COUNT(*) FROM journal_entries WHERE book_id = ?');
        $stmt->execute([$bookId]);
        if ((int) $stmt->fetchColumn() > 0) {
            return;
        }
        $html = '<p>' . htmlspecialchars($text, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '</p>';
        $now = Database::now();
        Database::pdo()->prepare("INSERT INTO journal_entries (book_id, kind, body_html, created_at, updated_at) VALUES (?, 'journal', ?, ?, ?)")
            ->execute([$bookId, $html, $now, $now]);
    }

    private static function looseDate(mixed $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        $value = str_replace('/', '-', $value);
        $dt = \DateTimeImmutable::createFromFormat('Y-m-d', substr($value, 0, 10));
        return $dt ? $dt->format('Y-m-d') : null;
    }

    private static function insertRows(\PDO $pdo, string $table, array $rows): void
    {
        if ($rows === []) {
            return;
        }
        $columns = array_keys($rows[0]);
        $placeholders = implode(',', array_fill(0, count($columns), '?'));
        $sql = 'INSERT INTO ' . $table . ' (' . implode(',', $columns) . ') VALUES (' . $placeholders . ')';
        $stmt = $pdo->prepare($sql);
        foreach ($rows as $row) {
            $values = [];
            foreach ($columns as $column) {
                $values[] = $row[$column] ?? null;
            }
            $stmt->execute($values);
        }
    }
}
