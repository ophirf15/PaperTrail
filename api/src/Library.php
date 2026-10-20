<?php

declare(strict_types=1);

namespace PaperTrail;

use PDO;

final class Library
{
    public static function list(array $query): array
    {
        $sql = 'SELECT b.*, e.status, e.rating, e.date_added, e.date_started, e.date_finished, e.current_page,
                       e.progress_percent, e.read_count, e.imported_review, e.rating_updated_at
                FROM books b JOIN library_entries e ON e.book_id = b.id WHERE 1 = 1';
        $params = [];
        $status = $query['status'] ?? '';
        if ($status !== '') {
            $sql .= ' AND e.status = ?';
            $params[] = assert_status((string) $status);
        }
        $q = trim((string) ($query['q'] ?? ''));
        if ($q !== '') {
            $sql .= ' AND (b.title LIKE ? OR b.authors_json LIKE ? OR IFNULL(b.isbn13, \'\') LIKE ? OR IFNULL(b.isbn10, \'\') LIKE ?)';
            $like = '%' . $q . '%';
            array_push($params, $like, $like, $like, $like);
        }
        $genre = trim((string) ($query['genre'] ?? ''));
        if ($genre !== '') {
            $sql .= ' AND b.genres_json LIKE ?';
            $params[] = '%' . $genre . '%';
        }
        $sort = (string) ($query['sort'] ?? 'added');
        $sql .= match ($sort) {
            'title' => ' ORDER BY b.title COLLATE NOCASE ASC',
            'author' => ' ORDER BY b.authors_json COLLATE NOCASE ASC',
            'finished' => ' ORDER BY CASE WHEN e.date_finished IS NULL THEN 1 ELSE 0 END, e.date_finished DESC',
            'rating' => ' ORDER BY CASE WHEN e.rating IS NULL THEN 1 ELSE 0 END, e.rating DESC, b.title COLLATE NOCASE ASC',
            default => ' ORDER BY e.date_added DESC, b.id DESC',
        };
        $stmt = Database::pdo()->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $tags = self::tagsFor(array_map(static fn ($row) => (int) $row['id'], $rows));
        return array_map(static fn ($row) => self::present($row, $tags[(int) $row['id']] ?? []), $rows);
    }

    public static function get(int $id): array
    {
        $book = self::requireRow($id);
        $tags = self::tagsFor([$id]);
        $presented = self::present($book, $tags[$id] ?? []);
        $presented['journalHtml'] = self::journalHtml($id);
        $presented['quotes'] = self::quotes($id);
        $presented['recommendations'] = self::recommendations($id);
        $presented['sessions'] = self::sessions($id);
        return $presented;
    }

    public static function addHit(array $hit, string $status, bool $sample = false): array
    {
        $status = assert_status($status);
        $provider = new OpenLibrary();
        try {
            $hit = $provider->hydrate($hit);
        } catch (\Throwable) {
            // The search card is enough to start a shelf.
        }
        $existing = self::findExisting(
            $hit['goodreadsBookId'] ?? null,
            $hit['isbn13'] ?? null,
            $hit['isbn10'] ?? null,
            $hit['workKey'] ?? null,
            (string) ($hit['title'] ?? ''),
            $hit['authors'] ?? []
        );
        if ($existing) {
            $book = self::get($existing);
            $book['alreadyOwned'] = true;
            return $book;
        }
        $title = trim((string) ($hit['title'] ?? ''));
        if ($title === '') {
            throw new HttpException(400, 'A book needs a title.');
        }
        $authors = json_list($hit['authors'] ?? []);
        if ($authors === []) {
            $authors = ['Unknown author'];
        }
        $now = Database::now();
        $today = Database::today();
        $pdo = Database::pdo();
        $ownsTransaction = !$pdo->inTransaction();
        if ($ownsTransaction) {
            $pdo->beginTransaction();
        }
        try {
            $pdo->prepare(
                'INSERT INTO books (title, authors_json, isbn10, isbn13, publisher, publish_year, description, page_count, genres_json, cover_url, open_library_work_key, goodreads_book_id, source, is_sample, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $title,
                json_encode(array_values($authors)),
                clean_isbn($hit['isbn10'] ?? null),
                clean_isbn($hit['isbn13'] ?? null),
                self::nullableString($hit['publisher'] ?? null),
                isset($hit['publishYear']) && $hit['publishYear'] !== '' ? (int) $hit['publishYear'] : null,
                self::nullableString($hit['description'] ?? null),
                isset($hit['pageCount']) && $hit['pageCount'] !== '' ? (int) $hit['pageCount'] : null,
                json_encode(array_slice(json_list($hit['genres'] ?? []), 0, 8)),
                self::nullableString($hit['coverUrl'] ?? null),
                self::nullableString($hit['workKey'] ?? null),
                self::nullableString($hit['goodreadsBookId'] ?? null),
                $sample ? 'sample' : (!empty($hit['goodreadsBookId']) ? 'goodreads' : (empty($hit['workKey']) ? 'manual' : 'openlibrary')),
                $sample ? 1 : 0,
                $now,
                $now,
            ]);
            $bookId = (int) $pdo->lastInsertId();
            $dateStarted = $status === 'reading' ? $today : null;
            $dateFinished = $status === 'finished' ? ($hit['dateFinished'] ?? $today) : null;
            $rating = isset($hit['rating']) ? valid_rating($hit['rating']) : null;
            $pdo->prepare(
                'INSERT INTO library_entries (book_id, status, rating, date_added, date_started, date_finished, current_page, progress_percent, read_count, rating_updated_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $bookId,
                $status,
                $rating,
                $hit['dateAdded'] ?? $today,
                $dateStarted,
                $dateFinished,
                null,
                $status === 'finished' ? 100 : null,
                $status === 'finished' ? 1 : 0,
                $rating !== null ? $now : null,
                $now,
                $now,
            ]);
            if ($status === 'reading' || $status === 'finished') {
                self::openSession($pdo, $bookId, $dateStarted ?? $today, $status === 'finished', false);
            }
            foreach (json_list($hit['tags'] ?? []) as $tag) {
                self::attachTag($pdo, $bookId, $tag, 'user');
            }
            if ($ownsTransaction) {
                $pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($ownsTransaction && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        $book = self::get($bookId);
        $book['alreadyOwned'] = false;
        return $book;
    }

    public static function updateMetadata(int $id, array $input): array
    {
        self::requireRow($id);
        $fields = [];
        $params = [];
        if (array_key_exists('title', $input)) {
            $title = trim((string) $input['title']);
            if ($title === '') {
                throw new HttpException(400, 'A book needs a title.');
            }
            $fields[] = 'title = ?';
            $params[] = $title;
        }
        if (array_key_exists('authors', $input)) {
            $authors = json_list($input['authors']);
            if ($authors === []) {
                throw new HttpException(400, 'Add at least one author.');
            }
            $fields[] = 'authors_json = ?';
            $params[] = json_encode($authors);
        }
        foreach (['publisher' => 'publisher', 'description' => 'description', 'coverUrl' => 'cover_url'] as $key => $column) {
            if (array_key_exists($key, $input)) {
                $fields[] = $column . ' = ?';
                $params[] = self::nullableString($input[$key]);
            }
        }
        if (array_key_exists('publishYear', $input)) {
            $fields[] = 'publish_year = ?';
            $params[] = $input['publishYear'] === null || $input['publishYear'] === '' ? null : (int) $input['publishYear'];
        }
        if (array_key_exists('pageCount', $input)) {
            $fields[] = 'page_count = ?';
            $params[] = $input['pageCount'] === null || $input['pageCount'] === '' ? null : max(0, (int) $input['pageCount']);
        }
        if (array_key_exists('isbn13', $input)) {
            $fields[] = 'isbn13 = ?';
            $params[] = clean_isbn(is_string($input['isbn13']) ? $input['isbn13'] : null);
        }
        if (array_key_exists('genres', $input)) {
            $fields[] = 'genres_json = ?';
            $params[] = json_encode(array_slice(json_list($input['genres']), 0, 8));
        }
        if ($fields !== []) {
            $fields[] = 'updated_at = ?';
            $params[] = Database::now();
            $params[] = $id;
            Database::pdo()->prepare('UPDATE books SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
        }
        return self::get($id);
    }

    public static function updateEntry(int $id, array $input): array
    {
        $row = self::requireRow($id);
        $pdo = Database::pdo();
        $goalReached = false;
        if (isset($input['status'])) {
            $result = self::setStatus($id, (string) $input['status'], $input['dateFinished'] ?? null);
            $goalReached = $result['goalReached'];
            $row = self::requireRow($id);
        }
        $sets = [];
        $params = [];
        if (array_key_exists('rating', $input)) {
            $rating = valid_rating($input['rating']);
            $sets[] = 'rating = ?';
            $params[] = $rating;
            $sets[] = 'rating_updated_at = ?';
            $params[] = Database::now();
        }
        foreach (['dateStarted' => 'date_started', 'dateFinished' => 'date_finished', 'dateAdded' => 'date_added'] as $key => $column) {
            if (array_key_exists($key, $input) && !($key === 'dateFinished' && isset($input['status']))) {
                $sets[] = $column . ' = ?';
                $params[] = valid_date($input[$key] !== null ? (string) $input[$key] : null);
            }
        }
        if (array_key_exists('currentPage', $input)) {
            $page = $input['currentPage'] === null || $input['currentPage'] === '' ? null : max(0, (int) $input['currentPage']);
            $sets[] = 'current_page = ?';
            $params[] = $page;
            if ($page !== null && $row['page_count']) {
                $sets[] = 'progress_percent = ?';
                $params[] = min(100, round($page / (int) $row['page_count'] * 100, 1));
            }
        }
        if (array_key_exists('progressPercent', $input)) {
            $percent = $input['progressPercent'] === null || $input['progressPercent'] === '' ? null : min(100, max(0, (float) $input['progressPercent']));
            $sets[] = 'progress_percent = ?';
            $params[] = $percent;
            if ($percent !== null && $row['page_count']) {
                $sets[] = 'current_page = ?';
                $params[] = (int) round(((int) $row['page_count']) * $percent / 100);
            }
        }
        if ($sets !== []) {
            $sets[] = 'updated_at = ?';
            $params[] = Database::now();
            $params[] = $id;
            $pdo->prepare('UPDATE library_entries SET ' . implode(', ', $sets) . ' WHERE book_id = ?')->execute($params);
        }
        $book = self::get($id);
        $book['goalReached'] = $goalReached;
        return $book;
    }

    public static function setStatus(int $id, string $status, ?string $finishedDate = null): array
    {
        $status = assert_status($status);
        $row = self::requireRow($id);
        $today = Database::today();
        $pdo = Database::pdo();
        $goalReached = false;
        $previous = $row['status'];
        $readCount = (int) $row['read_count'];
        $dateStarted = $row['date_started'];
        $dateFinished = $row['date_finished'];
        $progress = $row['progress_percent'];
        $current = $row['current_page'];
        if ($status === 'reading' && $previous !== 'reading') {
            $reread = $previous === 'finished' || $readCount > 0;
            $dateStarted = $today;
            if ($reread) {
                $dateFinished = null;
                $progress = null;
                $current = 0;
            }
            self::openSession($pdo, $id, $today, false, $reread);
        }
        if ($status === 'finished' && $previous !== 'finished') {
            $dateFinished = valid_date($finishedDate) ?? $today;
            $dateStarted = $dateStarted ?: $dateFinished;
            $readCount++;
            $progress = 100;
            if ($row['page_count']) {
                $current = (int) $row['page_count'];
            }
            self::closeSession($pdo, $id, $dateFinished, $current !== null ? (int) $current : null);
        }
        if ($status === 'dnf' && $previous === 'reading') {
            self::closeSession($pdo, $id, $today, $current !== null ? (int) $current : null);
        }
        $pdo->prepare(
            'UPDATE library_entries SET status = ?, date_started = ?, date_finished = ?, read_count = ?, progress_percent = ?, current_page = ?, updated_at = ? WHERE book_id = ?'
        )->execute([$status, $dateStarted, $dateFinished, $readCount, $progress, $current, Database::now(), $id]);
        if ($status === 'finished' && $previous !== 'finished' && $dateFinished) {
            $goalReached = self::celebrate((int) substr((string) $dateFinished, 0, 4));
        }
        return ['goalReached' => $goalReached];
    }

    public static function delete(int $id): void
    {
        self::requireRow($id);
        Database::pdo()->prepare('DELETE FROM books WHERE id = ?')->execute([$id]);
    }

    public static function refresh(int $id, bool $coversOnly = false): array
    {
        $row = self::requireRow($id);
        $authors = json_list($row['authors_json']);
        $hit = (new OpenLibrary())->lookup($row['title'], $authors, $row['isbn13'], $row['isbn10']);
        if ($hit === []) {
            return self::get($id);
        }
        try {
            $hit = (new OpenLibrary())->hydrate($hit);
        } catch (\Throwable) {
        }
        $sets = [];
        $params = [];
        $fill = [
            'cover_url' => $hit['coverUrl'] ?? null,
            'description' => $coversOnly ? null : ($hit['description'] ?? null),
            'publisher' => $coversOnly ? null : ($hit['publisher'] ?? null),
            'isbn13' => $coversOnly ? null : ($hit['isbn13'] ?? null),
            'isbn10' => $coversOnly ? null : ($hit['isbn10'] ?? null),
            'open_library_work_key' => $coversOnly ? null : ($hit['workKey'] ?? null),
        ];
        foreach ($fill as $column => $value) {
            if (($row[$column] === null || $row[$column] === '') && $value) {
                $sets[] = $column . ' = ?';
                $params[] = $value;
            }
        }
        if (!$coversOnly && ($row['page_count'] === null || $row['page_count'] === '') && !empty($hit['pageCount'])) {
            $sets[] = 'page_count = ?';
            $params[] = (int) $hit['pageCount'];
        }
        if (!$coversOnly && ($row['publish_year'] === null || $row['publish_year'] === '') && !empty($hit['publishYear'])) {
            $sets[] = 'publish_year = ?';
            $params[] = (int) $hit['publishYear'];
        }
        if (!$coversOnly && ($row['genres_json'] === '[]' || $row['genres_json'] === '') && !empty($hit['genres'])) {
            $sets[] = 'genres_json = ?';
            $params[] = json_encode(array_slice(json_list($hit['genres']), 0, 8));
        }
        if ($sets !== []) {
            $sets[] = 'updated_at = ?';
            $params[] = Database::now();
            $params[] = $id;
            Database::pdo()->prepare('UPDATE books SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        }
        return self::get($id);
    }

    public static function refreshMissing(int $limit = 20): array
    {
        $stmt = Database::pdo()->prepare("SELECT id FROM books WHERE cover_url IS NULL OR cover_url = '' ORDER BY id ASC LIMIT ?");
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        $updated = 0;
        $checked = 0;
        foreach ($stmt->fetchAll() as $row) {
            $checked++;
            $before = Database::pdo()->prepare('SELECT cover_url FROM books WHERE id = ?');
            $before->execute([(int) $row['id']]);
            $old = $before->fetchColumn();
            try {
                self::refresh((int) $row['id'], true);
            } catch (\Throwable) {
                continue;
            }
            $after = Database::pdo()->prepare('SELECT cover_url FROM books WHERE id = ?');
            $after->execute([(int) $row['id']]);
            if ($after->fetchColumn() && !$old) {
                $updated++;
            }
        }
        $remain = (int) Database::pdo()->query("SELECT COUNT(*) FROM books WHERE cover_url IS NULL OR cover_url = ''")->fetchColumn();
        return ['checked' => $checked, 'updated' => $updated, 'remaining' => $remain];
    }

    public static function seedSamples(): array
    {
        $year = gmdate('Y');
        $samples = self::sampleCatalog($year);
        $added = 0;
        $byTitle = [];
        foreach ($samples as $sample) {
            $sample['coverUrl'] = 'https://covers.openlibrary.org/b/isbn/' . $sample['isbn13'] . '-L.jpg';
            $sample['tags'] = ['Sample shelf'];
            $book = self::addHit($sample, $sample['status'], true);
            $byTitle[$sample['title']] = (int) $book['id'];
            if (empty($book['alreadyOwned'])) {
                $added++;
            }
            self::fillSampleBlanks((int) $book['id'], $book, $sample);
        }
        self::sampleStories($byTitle);
        self::samplePeople($byTitle);
        Decor::seedDefaults();
        return ['added' => $added, 'books' => count($byTitle)];
    }

    public static function clearSamples(): array
    {
        $pdo = Database::pdo();
        $books = $pdo->prepare('DELETE FROM books WHERE is_sample = 1');
        $books->execute();
        $people = $pdo->prepare('DELETE FROM contacts WHERE is_sample = 1');
        $people->execute();
        return ['removed' => $books->rowCount(), 'people' => $people->rowCount()];
    }

    private static function fillSampleBlanks(int $id, array $book, array $sample): void
    {
        $meta = [];
        if (empty($book['description']) && !empty($sample['description'])) {
            $meta['description'] = $sample['description'];
        }
        if (empty($book['genres']) && !empty($sample['genres'])) {
            $meta['genres'] = $sample['genres'];
        }
        if ($meta !== []) {
            self::updateMetadata($id, $meta);
        }
        $patch = [];
        if (empty($book['dateStarted']) && !empty($sample['dateStarted'])) {
            $patch['dateStarted'] = $sample['dateStarted'];
        }
        if (($book['currentPage'] ?? null) === null && !empty($sample['currentHint'])) {
            $patch['currentPage'] = $sample['currentHint'];
        }
        if ($patch !== []) {
            self::updateEntry($id, $patch);
        }
    }

    private static function sampleCatalog(string $year): array
    {
        return [
            ['title' => 'Pride and Prejudice', 'authors' => ['Jane Austen'], 'isbn13' => '9780141439518', 'status' => 'finished', 'rating' => 5, 'dateFinished' => $year . '-01-12', 'dateStarted' => $year . '-01-02', 'pageCount' => 279, 'publishYear' => 1813, 'genres' => ['Classic', 'Romance'], 'description' => 'A sample copy of Austen’s novel, kept here so the finished shelf and a public-domain line can be tried.'],
            ['title' => 'The Song of Achilles', 'authors' => ['Madeline Miller'], 'isbn13' => '9780062060624', 'status' => 'finished', 'rating' => 5, 'dateFinished' => $year . '-02-08', 'dateStarted' => $year . '-01-20', 'pageCount' => 352, 'publishYear' => 2011, 'genres' => ['Myth', 'Fiction'], 'description' => 'A sample record for a February finish and a recommendation note.'],
            ['title' => 'Circe', 'authors' => ['Madeline Miller'], 'isbn13' => '9780316556347', 'status' => 'finished', 'rating' => 4.5, 'dateFinished' => $year . '-03-02', 'dateStarted' => $year . '-02-14', 'pageCount' => 393, 'publishYear' => 2018, 'genres' => ['Myth', 'Fiction'], 'description' => 'A sample record with a journal page and a saved line.'],
            ['title' => 'Hamnet', 'authors' => ['Maggie O\'Farrell'], 'isbn13' => '9781472223791', 'status' => 'finished', 'rating' => 4.5, 'dateFinished' => $year . '-04-19', 'dateStarted' => $year . '-04-01', 'pageCount' => 372, 'publishYear' => 2020, 'genres' => ['Historical', 'Fiction'], 'description' => 'A sample April finish, useful for the year chart.'],
            ['title' => 'A Gentleman in Moscow', 'authors' => ['Amor Towles'], 'isbn13' => '9780670026197', 'status' => 'finished', 'rating' => 5, 'dateFinished' => $year . '-05-21', 'dateStarted' => $year . '-04-28', 'pageCount' => 462, 'publishYear' => 2016, 'genres' => ['Historical', 'Fiction'], 'description' => 'A sample favorite, marked to share.'],
            ['title' => 'The Vanishing Half', 'authors' => ['Brit Bennett'], 'isbn13' => '9780525536291', 'status' => 'finished', 'rating' => 4, 'dateFinished' => $year . '-06-11', 'dateStarted' => $year . '-05-27', 'pageCount' => 352, 'publishYear' => 2020, 'genres' => ['Fiction'], 'description' => 'A sample June book with an average-leaning rating.'],
            ['title' => 'Normal People', 'authors' => ['Sally Rooney'], 'isbn13' => '9781984822178', 'status' => 'finished', 'rating' => 4, 'dateFinished' => $year . '-07-03', 'dateStarted' => $year . '-06-18', 'pageCount' => 273, 'publishYear' => 2018, 'genres' => ['Fiction'], 'description' => 'A sample summer finish.'],
            ['title' => 'Exhalation', 'authors' => ['Ted Chiang'], 'isbn13' => '9781101947883', 'status' => 'finished', 'rating' => 5, 'dateFinished' => $year . '-08-16', 'dateStarted' => $year . '-08-01', 'pageCount' => 368, 'publishYear' => 2019, 'genres' => ['Stories', 'Science fiction'], 'description' => 'A sample story collection on the August shelf.'],
            ['title' => 'The Left Hand of Darkness', 'authors' => ['Ursula K. Le Guin'], 'isbn13' => '9780441478125', 'status' => 'finished', 'rating' => 5, 'dateFinished' => $year . '-09-09', 'dateStarted' => $year . '-08-22', 'pageCount' => 304, 'publishYear' => 1969, 'genres' => ['Science fiction'], 'description' => 'A sample September finish with a quote card.'],
            ['title' => 'Beloved', 'authors' => ['Toni Morrison'], 'isbn13' => '9781400033416', 'status' => 'finished', 'rating' => 5, 'dateFinished' => $year . '-10-04', 'dateStarted' => $year . '-09-18', 'pageCount' => 324, 'publishYear' => 1987, 'genres' => ['Fiction', 'Classic'], 'description' => 'A sample October finish.'],
            ['title' => 'Piranesi', 'authors' => ['Susanna Clarke'], 'isbn13' => '9781635575637', 'status' => 'reading', 'dateStarted' => $year . '-10-06', 'pageCount' => 245, 'publishYear' => 2020, 'currentHint' => 96, 'genres' => ['Fantasy'], 'description' => 'A sample book in progress, partway through the halls.'],
            ['title' => 'The Midnight Library', 'authors' => ['Matt Haig'], 'isbn13' => '9780525559474', 'status' => 'reading', 'dateStarted' => $year . '-10-11', 'pageCount' => 304, 'publishYear' => 2020, 'currentHint' => 40, 'genres' => ['Fiction'], 'description' => 'A second sample currently on the nightstand.'],
            ['title' => 'Tomorrow, and Tomorrow, and Tomorrow', 'authors' => ['Gabrielle Zevin'], 'isbn13' => '9780593321201', 'status' => 'reading', 'dateStarted' => $year . '-10-15', 'pageCount' => 401, 'publishYear' => 2022, 'currentHint' => 28, 'genres' => ['Fiction'], 'description' => 'A sample just begun, so progress can be updated.'],
            ['title' => 'The Atlas Six', 'authors' => ['Olivie Blake'], 'isbn13' => '9781250854513', 'status' => 'dnf', 'dateStarted' => $year . '-07-20', 'pageCount' => 384, 'publishYear' => 2020, 'currentHint' => 70, 'genres' => ['Fantasy'], 'description' => 'A sample did-not-finish, so that shelf is not empty.'],
            ['title' => 'The Night Circus', 'authors' => ['Erin Morgenstern'], 'isbn13' => '9780307744432', 'status' => 'want', 'pageCount' => 387, 'publishYear' => 2011, 'genres' => ['Fantasy'], 'description' => 'Waiting on the want-to-read shelf.'],
            ['title' => 'The House in the Cerulean Sea', 'authors' => ['TJ Klune'], 'isbn13' => '9781250217288', 'status' => 'want', 'pageCount' => 398, 'publishYear' => 2020, 'genres' => ['Fantasy'], 'description' => 'A sample waiting to be started.'],
            ['title' => 'Klara and the Sun', 'authors' => ['Kazuo Ishiguro'], 'isbn13' => '9780593318171', 'status' => 'want', 'pageCount' => 303, 'publishYear' => 2021, 'genres' => ['Fiction'], 'description' => 'A sample still on the list.'],
            ['title' => 'Station Eleven', 'authors' => ['Emily St. John Mandel'], 'isbn13' => '9780385353304', 'status' => 'want', 'pageCount' => 333, 'publishYear' => 2014, 'genres' => ['Fiction'], 'description' => 'A sample for the waiting shelf.'],
            ['title' => 'The Starless Sea', 'authors' => ['Erin Morgenstern'], 'isbn13' => '9780385541213', 'status' => 'want', 'pageCount' => 498, 'publishYear' => 2019, 'genres' => ['Fantasy'], 'description' => 'A longer sample, so its spine is wider.'],
            ['title' => 'Mexican Gothic', 'authors' => ['Silvia Moreno-Garcia'], 'isbn13' => '9780525620785', 'status' => 'want', 'pageCount' => 301, 'publishYear' => 2020, 'genres' => ['Gothic', 'Fiction'], 'description' => 'A sample gothic for the genre filter.'],
            ['title' => 'Rebecca', 'authors' => ['Daphne du Maurier'], 'isbn13' => '9780380730407', 'status' => 'want', 'pageCount' => 449, 'publishYear' => 1938, 'genres' => ['Gothic', 'Classic'], 'description' => 'A sample classic still unread.'],
            ['title' => 'Braiding Sweetgrass', 'authors' => ['Robin Wall Kimmerer'], 'isbn13' => '9781571313560', 'status' => 'want', 'pageCount' => 408, 'publishYear' => 2013, 'genres' => ['Essays', 'Nature'], 'description' => 'A sample essay collection on the list.'],
        ];
    }

    private static function sampleStories(array $byTitle): void
    {
        $notes = [
            'Circe' => ['journal' => '<p>A sample margin: power, loneliness, and the choice to stay.</p>', 'quote' => 'She made a life from what the island offered.', 'location' => 'Sample note'],
            'Pride and Prejudice' => ['journal' => '<p>A sample page for the journal timeline.</p>', 'quote' => 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', 'location' => 'Chapter 1'],
            'Piranesi' => ['journal' => '<p>Still walking the halls. The tide is the clock.</p>', 'quote' => 'The house remembers every visitor.', 'location' => 'Early pages'],
            'The Left Hand of Darkness' => ['journal' => '<p>A sample reflection about trust in a winter country.</p>', 'quote' => 'The king was a stranger, and then a companion.', 'location' => 'Sample note'],
            'A Gentleman in Moscow' => ['journal' => '<p>The hotel becomes a whole country.</p>'],
        ];
        foreach ($notes as $title => $story) {
            $id = $byTitle[$title] ?? null;
            if (!$id) {
                continue;
            }
            $existing = Database::pdo()->prepare("SELECT COUNT(*) FROM journal_entries WHERE book_id = ? AND kind = 'journal'");
            $existing->execute([$id]);
            if ((int) $existing->fetchColumn() === 0 && !empty($story['journal'])) {
                Journal::saveJournal($id, $story['journal']);
            }
            if (!empty($story['quote'])) {
                $dup = Database::pdo()->prepare('SELECT COUNT(*) FROM quotes WHERE book_id = ? AND body = ?');
                $dup->execute([$id, $story['quote']]);
                if ((int) $dup->fetchColumn() === 0) {
                    Journal::quotesCreate($id, ['body' => $story['quote'], 'location' => $story['location'] ?? null, 'note' => 'Sample']);
                }
            }
        }
    }

    private static function samplePeople(array $byTitle): void
    {
        $people = [
            'Sarah' => ['nickname' => 'S', 'notes' => 'Sample reader', 'books' => ['Circe' => 'She would love a woman who chooses her own power.', 'The Song of Achilles' => 'For the friendship at the center.']],
            'Jonah' => ['nickname' => null, 'notes' => 'Sample reader', 'books' => ['Piranesi' => 'He likes strange houses and quiet puzzles.', 'Exhalation' => 'Short pieces he can read on a train.']],
            'Mina' => ['nickname' => 'Mom', 'notes' => 'Sample reader', 'books' => ['A Gentleman in Moscow' => 'Already shared.', 'Rebecca' => 'A classic she has mentioned.']],
        ];
        $pdo = Database::pdo();
        foreach ($people as $name => $person) {
            $stmt = $pdo->prepare('SELECT id FROM contacts WHERE name = ? AND is_sample = 1');
            $stmt->execute([$name]);
            $id = $stmt->fetchColumn();
            if (!$id) {
                $now = Database::now();
                $pdo->prepare('INSERT INTO contacts (name, nickname, email, notes, is_sample, created_at, updated_at) VALUES (?, ?, NULL, ?, 1, ?, ?)')
                    ->execute([$name, $person['nickname'], $person['notes'], $now, $now]);
                $id = (int) $pdo->lastInsertId();
            }
            foreach ($person['books'] as $title => $note) {
                $bookId = $byTitle[$title] ?? null;
                if (!$bookId) {
                    continue;
                }
                $shared = $title === 'A Gentleman in Moscow';
                People::recommend((int) $bookId, ['contactId' => (int) $id, 'note' => $note, 'shared' => $shared]);
            }
        }
    }

    public static function findExisting(?string $goodreads, ?string $isbn13, ?string $isbn10, ?string $work, string $title, array $authors): ?int
    {
        $pdo = Database::pdo();
        if ($goodreads) {
            $stmt = $pdo->prepare('SELECT id FROM books WHERE goodreads_book_id = ?');
            $stmt->execute([$goodreads]);
            $id = $stmt->fetchColumn();
            if ($id) {
                return (int) $id;
            }
        }
        foreach (['isbn13' => clean_isbn($isbn13), 'isbn10' => clean_isbn($isbn10)] as $column => $isbn) {
            if (!$isbn) {
                continue;
            }
            $stmt = $pdo->prepare("SELECT id FROM books WHERE $column = ?");
            $stmt->execute([$isbn]);
            $id = $stmt->fetchColumn();
            if ($id) {
                return (int) $id;
            }
        }
        if ($work) {
            $stmt = $pdo->prepare('SELECT id FROM books WHERE open_library_work_key = ?');
            $stmt->execute([$work]);
            $id = $stmt->fetchColumn();
            if ($id) {
                return (int) $id;
            }
        }
        $normalTitle = norm($title);
        $normalAuthor = norm($authors[0] ?? '');
        if ($normalTitle === '' || $normalAuthor === '') {
            return null;
        }
        $stmt = $pdo->prepare('SELECT id, title, authors_json FROM books');
        $stmt->execute();
        foreach ($stmt->fetchAll() as $row) {
            if (norm($row['title']) !== $normalTitle) {
                continue;
            }
            $rowAuthors = json_list($row['authors_json']);
            if (norm($rowAuthors[0] ?? '') === $normalAuthor) {
                return (int) $row['id'];
            }
        }
        return null;
    }

    public static function attachTag(PDO $pdo, int $bookId, string $name, string $source): void
    {
        $name = trim($name);
        if ($name === '' || strlen($name) > 80) {
            return;
        }
        $pdo->prepare('INSERT INTO tags (name, source) VALUES (?, ?) ON CONFLICT(name) DO NOTHING')->execute([$name, $source]);
        $stmt = $pdo->prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
        $stmt->execute([$name]);
        $tagId = $stmt->fetchColumn();
        if ($tagId) {
            $pdo->prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)')->execute([$bookId, $tagId]);
        }
    }

    public static function present(array $row, array $tags): array
    {
        return [
            'id' => (int) $row['id'],
            'title' => $row['title'],
            'authors' => json_list($row['authors_json']),
            'isbn10' => $row['isbn10'],
            'isbn13' => $row['isbn13'],
            'publisher' => $row['publisher'],
            'publishYear' => $row['publish_year'] !== null ? (int) $row['publish_year'] : null,
            'description' => $row['description'],
            'pageCount' => $row['page_count'] !== null ? (int) $row['page_count'] : null,
            'genres' => json_list($row['genres_json']),
            'coverUrl' => $row['cover_url'],
            'workKey' => $row['open_library_work_key'],
            'goodreadsBookId' => $row['goodreads_book_id'],
            'source' => $row['source'],
            'isSample' => (bool) $row['is_sample'],
            'status' => $row['status'],
            'rating' => $row['rating'] !== null ? (float) $row['rating'] : null,
            'dateAdded' => $row['date_added'],
            'dateStarted' => $row['date_started'],
            'dateFinished' => $row['date_finished'],
            'currentPage' => $row['current_page'] !== null ? (int) $row['current_page'] : null,
            'progressPercent' => $row['progress_percent'] !== null ? (float) $row['progress_percent'] : null,
            'readCount' => (int) $row['read_count'],
            'importedReview' => $row['imported_review'],
            'tags' => $tags,
        ];
    }

    private static function requireRow(int $id): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT b.*, e.status, e.rating, e.date_added, e.date_started, e.date_finished, e.current_page, e.progress_percent, e.read_count, e.imported_review, e.rating_updated_at
             FROM books b JOIN library_entries e ON e.book_id = b.id WHERE b.id = ?'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new HttpException(404, 'That book is not on your shelves.');
        }
        return $row;
    }

    private static function tagsFor(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = Database::pdo()->prepare(
            "SELECT bt.book_id, t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id IN ($placeholders) ORDER BY t.name"
        );
        $stmt->execute($ids);
        $grouped = [];
        foreach ($stmt->fetchAll() as $row) {
            $grouped[(int) $row['book_id']][] = $row['name'];
        }
        return $grouped;
    }

    private static function journalHtml(int $bookId): string
    {
        $stmt = Database::pdo()->prepare("SELECT body_html FROM journal_entries WHERE book_id = ? AND kind = 'journal' ORDER BY id ASC LIMIT 1");
        $stmt->execute([$bookId]);
        $html = $stmt->fetchColumn();
        return $html ? (string) $html : '';
    }

    private static function quotes(int $bookId): array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM quotes WHERE book_id = ? ORDER BY id DESC');
        $stmt->execute([$bookId]);
        return array_map(static function (array $row): array {
            return [
                'id' => (int) $row['id'],
                'body' => $row['body'],
                'location' => $row['location'],
                'note' => $row['note'],
                'createdAt' => $row['created_at'],
            ];
        }, $stmt->fetchAll());
    }

    private static function recommendations(int $bookId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT r.*, c.name, c.nickname FROM recommendations r JOIN contacts c ON c.id = r.contact_id WHERE r.book_id = ? ORDER BY c.name'
        );
        $stmt->execute([$bookId]);
        return array_map(static function (array $row): array {
            return [
                'id' => (int) $row['id'],
                'contactId' => (int) $row['contact_id'],
                'name' => $row['name'],
                'nickname' => $row['nickname'],
                'note' => $row['note'],
                'sharedAt' => $row['shared_at'],
            ];
        }, $stmt->fetchAll());
    }

    private static function sessions(int $bookId): array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM reading_sessions WHERE book_id = ? ORDER BY id DESC');
        $stmt->execute([$bookId]);
        return array_map(static function (array $row): array {
            return [
                'id' => (int) $row['id'],
                'startedAt' => $row['started_at'],
                'finishedAt' => $row['finished_at'],
                'status' => $row['status'],
                'isReread' => (bool) $row['is_reread'],
            ];
        }, $stmt->fetchAll());
    }

    private static function openSession(PDO $pdo, int $bookId, string $started, bool $finished, bool $reread): void
    {
        $pdo->prepare(
            'INSERT INTO reading_sessions (book_id, started_at, finished_at, status, is_reread, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$bookId, $started, $finished ? $started : null, $finished ? 'finished' : 'reading', $reread ? 1 : 0, Database::now()]);
    }

    private static function closeSession(PDO $pdo, int $bookId, string $finished, ?int $page): void
    {
        $stmt = $pdo->prepare("SELECT id FROM reading_sessions WHERE book_id = ? AND status = 'reading' ORDER BY id DESC LIMIT 1");
        $stmt->execute([$bookId]);
        $id = $stmt->fetchColumn();
        if ($id) {
            $pdo->prepare('UPDATE reading_sessions SET finished_at = ?, status = ?, ending_page = ? WHERE id = ?')
                ->execute([$finished, 'finished', $page, $id]);
            return;
        }
        $pdo->prepare(
            'INSERT INTO reading_sessions (book_id, started_at, finished_at, status, ending_page, is_reread, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
        )->execute([$bookId, $finished, $finished, 'finished', $page, Database::now()]);
    }

    private static function celebrate(int $year): bool
    {
        $pdo = Database::pdo();
        $goal = $pdo->prepare('SELECT target_count, celebrated_at FROM reading_goals WHERE year = ?');
        $goal->execute([$year]);
        $row = $goal->fetch();
        if (!$row || $row['celebrated_at']) {
            return false;
        }
        $count = $pdo->prepare("SELECT COUNT(*) FROM library_entries WHERE status = 'finished' AND substr(date_finished, 1, 4) = ?");
        $count->execute([(string) $year]);
        if ((int) $count->fetchColumn() < (int) $row['target_count']) {
            return false;
        }
        $pdo->prepare('UPDATE reading_goals SET celebrated_at = ? WHERE year = ?')->execute([Database::now(), $year]);
        return true;
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);
        return $value === '' ? null : $value;
    }
}
