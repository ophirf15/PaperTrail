<?php

declare(strict_types=1);

namespace PaperTrail;

final class OpenLibrary
{
    public function search(string $query): array
    {
        $query = trim($query);
        if (strlen($query) < 2) {
            throw new HttpException(400, 'Type a little more of the title, author, or ISBN.');
        }
        $url = 'https://openlibrary.org/search.json?' . http_build_query([
            'q' => $query,
            'limit' => 12,
            'fields' => 'key,title,author_name,cover_i,first_publish_year,isbn,publisher,number_of_pages_median,subject',
        ]);
        $payload = $this->getJson($url);
        $docs = is_array($payload['docs'] ?? null) ? $payload['docs'] : [];
        $hits = [];
        foreach ($docs as $doc) {
            if (!is_array($doc) || empty($doc['title'])) {
                continue;
            }
            $hits[] = $this->hitFromDoc($doc);
        }
        return $hits;
    }

    public function hydrate(array $hit): array
    {
        $workKey = (string) ($hit['workKey'] ?? '');
        if ($workKey === '' || !str_starts_with($workKey, '/works/')) {
            return $hit;
        }
        try {
            $work = $this->getJson('https://openlibrary.org' . $workKey . '.json');
        } catch (\Throwable) {
            return $hit;
        }
        $description = $work['description'] ?? null;
        if (is_array($description)) {
            $description = $description['value'] ?? '';
        }
        if (is_string($description) && trim($description) !== '' && empty($hit['description'])) {
            $hit['description'] = Html::plain($description);
        }
        if (empty($hit['genres']) && is_array($work['subjects'] ?? null)) {
            $hit['genres'] = array_slice(array_values(array_filter($work['subjects'], 'is_string')), 0, 6);
        }
        return $hit;
    }

    public function lookup(string $title, array $authors, ?string $isbn13, ?string $isbn10): array
    {
        $isbn = $isbn13 ?: $isbn10;
        $query = $isbn ? 'isbn:' . $isbn : trim($title . ' ' . ($authors[0] ?? ''));
        if ($query === '') {
            return [];
        }
        try {
            $hits = $this->search($query);
        } catch (\Throwable) {
            return [];
        }
        return $hits[0] ?? [];
    }

    private function hitFromDoc(array $doc): array
    {
        $isbn13 = null;
        $isbn10 = null;
        foreach ($doc['isbn'] ?? [] as $isbn) {
            $clean = clean_isbn((string) $isbn);
            if ($clean === null) {
                continue;
            }
            if (strlen($clean) === 13 && $isbn13 === null) {
                $isbn13 = $clean;
            }
            if (strlen($clean) === 10 && $isbn10 === null) {
                $isbn10 = $clean;
            }
        }
        $cover = null;
        if (!empty($doc['cover_i'])) {
            $cover = 'https://covers.openlibrary.org/b/id/' . (int) $doc['cover_i'] . '-L.jpg';
        } elseif ($isbn13 || $isbn10) {
            $cover = 'https://covers.openlibrary.org/b/isbn/' . ($isbn13 ?: $isbn10) . '-L.jpg';
        }
        $publisher = $doc['publisher'][0] ?? null;
        return [
            'workKey' => (string) ($doc['key'] ?? ''),
            'title' => (string) $doc['title'],
            'authors' => array_values(array_filter($doc['author_name'] ?? [], 'is_string')),
            'publishYear' => isset($doc['first_publish_year']) ? (int) $doc['first_publish_year'] : null,
            'isbn13' => $isbn13,
            'isbn10' => $isbn10,
            'publisher' => is_string($publisher) ? $publisher : null,
            'pageCount' => isset($doc['number_of_pages_median']) ? (int) $doc['number_of_pages_median'] : null,
            'genres' => array_slice(array_values(array_filter($doc['subject'] ?? [], 'is_string')), 0, 6),
            'coverUrl' => $cover,
            'description' => null,
        ];
    }

    private function getJson(string $url): array
    {
        $context = stream_context_create([
            'http' => [
                'timeout' => 12,
                'header' => "User-Agent: PaperTrail/0.1 (personal reading journal)\r\nAccept: application/json\r\n",
            ],
        ]);
        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            throw new HttpException(502, 'The catalog is quiet right now. You can add the book by hand.');
        }
        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            throw new HttpException(502, 'The catalog returned something unexpected.');
        }
        return $decoded;
    }
}
