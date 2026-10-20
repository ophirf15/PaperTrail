<?php

declare(strict_types=1);

namespace PaperTrail;

function dispatch(string $method, string $path, array $body = [], array $query = [], ?string $token = null, ?string $upload = null, string $uploadName = 'import.csv', string $ip = 'local', string $userAgent = ''): array
{
    $path = '/' . trim($path, '/');
    if ($path === '/') {
        $path = '/';
    }

    if ($method === 'GET' && $path === '/health') {
        return ok(['ok' => true, 'version' => version()]);
    }
    if ($method === 'GET' && $path === '/setup-status') {
        return ok(['needsSetup' => Auth::needsSetup()]);
    }
    if ($method === 'POST' && $path === '/setup') {
        $result = Auth::setup((string) ($body['displayName'] ?? ''), (string) ($body['password'] ?? ''), $userAgent);
        return ok(['user' => $result['user'], 'settings' => settings_get()], 201, $result['token']);
    }
    if ($method === 'POST' && $path === '/login') {
        $result = Auth::login((string) ($body['password'] ?? ''), $ip, $userAgent);
        return ok(['user' => $result['user'], 'settings' => settings_get()], 200, $result['token']);
    }
    if ($method === 'POST' && $path === '/errors') {
        $user = Auth::userFromToken($token);
        Errors::capture(
            'frontend',
            (string) ($body['message'] ?? 'Unknown error'),
            isset($body['stack']) ? (string) $body['stack'] : null,
            isset($body['url']) ? (string) $body['url'] : null,
            $user['id'] ?? null,
            $userAgent,
            is_array($body['breadcrumbs'] ?? null) ? $body['breadcrumbs'] : []
        );
        return ok(['logged' => true], 202);
    }

    if ($method === 'POST' && $path === '/logout') {
        Auth::logout($token);
        return ok(['ok' => true], 200, '');
    }

    $user = Auth::requireUser($token);

    if ($method === 'GET' && $path === '/me') {
        return ok(['user' => $user, 'settings' => settings_get()]);
    }
    if ($method === 'PUT' && $path === '/me') {
        return ok(['user' => Auth::updateDisplayName($user['id'], (string) ($body['displayName'] ?? ''))]);
    }
    if ($method === 'GET' && $path === '/settings') {
        return ok(settings_get());
    }
    if ($method === 'PUT' && $path === '/settings') {
        return ok(settings_put($body));
    }
    if ($method === 'GET' && $path === '/library') {
        return ok(Library::list($query));
    }
    if ($method === 'GET' && $path === '/search') {
        return ok((new OpenLibrary())->search((string) ($query['q'] ?? '')));
    }
    if ($method === 'POST' && $path === '/books') {
        $status = assert_status((string) ($body['status'] ?? 'want'));
        $hit = is_array($body['hit'] ?? null) ? $body['hit'] : $body;
        return ok(Library::addHit($hit, $status), 201);
    }
    if ($method === 'POST' && $path === '/sample-shelf') {
        return ok(Library::seedSamples(), 201);
    }
    if ($method === 'DELETE' && $path === '/sample-shelf') {
        return ok(Library::clearSamples());
    }
    if ($method === 'GET' && $path === '/decorations') {
        return ok(Decor::list());
    }
    if ($method === 'POST' && $path === '/decorations') {
        return ok(Decor::add((int) ($body['shelfIndex'] ?? 0), (string) ($body['kind'] ?? ''), (int) ($body['slot'] ?? 0)), 201);
    }
    if ($method === 'DELETE' && preg_match('#^/decorations/(\d+)$#', $path, $m)) {
        Decor::remove((int) $m[1]);
        return ok(['ok' => true]);
    }
    if ($method === 'POST' && $path === '/metadata/refresh-missing') {
        return ok(Library::refreshMissing());
    }
    if ($method === 'GET' && $path === '/timeline') {
        return ok(Journal::timeline($query));
    }
    if ($method === 'POST' && $path === '/journal') {
        return ok(Journal::addNote((int) ($body['bookId'] ?? 0), (string) ($body['bodyHtml'] ?? '')), 201);
    }
    if ($method === 'GET' && preg_match('#^/stats$#', $path)) {
        $year = (int) ($query['year'] ?? gmdate('Y'));
        return ok(Journal::stats($year));
    }
    if ($method === 'PUT' && preg_match('#^/goals/(\d+)$#', $path, $m)) {
        return ok(Journal::goal((int) $m[1], isset($body['target']) ? (int) $body['target'] : null));
    }
    if ($method === 'GET' && preg_match('#^/goals/(\d+)$#', $path, $m)) {
        return ok(Journal::goal((int) $m[1]));
    }
    if ($method === 'GET' && $path === '/contacts') {
        return ok(People::list());
    }
    if ($method === 'POST' && $path === '/contacts') {
        return ok(People::create($body), 201);
    }
    if ($method === 'GET' && preg_match('#^/contacts/(\d+)$#', $path, $m)) {
        return ok(People::get((int) $m[1]));
    }
    if ($method === 'PATCH' && preg_match('#^/contacts/(\d+)$#', $path, $m)) {
        return ok(People::update((int) $m[1], $body));
    }
    if ($method === 'DELETE' && preg_match('#^/contacts/(\d+)$#', $path, $m)) {
        People::delete((int) $m[1]);
        return ok(['ok' => true]);
    }
    if ($method === 'GET' && preg_match('#^/books/(\d+)$#', $path, $m)) {
        return ok(Library::get((int) $m[1]));
    }
    if ($method === 'PATCH' && preg_match('#^/books/(\d+)$#', $path, $m)) {
        return ok(Library::updateMetadata((int) $m[1], $body));
    }
    if ($method === 'DELETE' && preg_match('#^/books/(\d+)$#', $path, $m)) {
        Library::delete((int) $m[1]);
        return ok(['ok' => true]);
    }
    if ($method === 'PATCH' && preg_match('#^/books/(\d+)/entry$#', $path, $m)) {
        return ok(Library::updateEntry((int) $m[1], $body));
    }
    if ($method === 'POST' && preg_match('#^/books/(\d+)/refresh$#', $path, $m)) {
        return ok(Library::refresh((int) $m[1]));
    }
    if ($method === 'PUT' && preg_match('#^/books/(\d+)/journal$#', $path, $m)) {
        return ok(Journal::saveJournal((int) $m[1], (string) ($body['bodyHtml'] ?? '')));
    }
    if ($method === 'POST' && preg_match('#^/books/(\d+)/quotes$#', $path, $m)) {
        return ok(Journal::quotesCreate((int) $m[1], $body), 201);
    }
    if ($method === 'POST' && preg_match('#^/books/(\d+)/recommendations$#', $path, $m)) {
        return ok(People::recommend((int) $m[1], $body), 201);
    }
    if ($method === 'PATCH' && preg_match('#^/quotes/(\d+)$#', $path, $m)) {
        return ok(Journal::quotesUpdate((int) $m[1], $body));
    }
    if ($method === 'DELETE' && preg_match('#^/quotes/(\d+)$#', $path, $m)) {
        Journal::quotesDelete((int) $m[1]);
        return ok(['ok' => true]);
    }
    if ($method === 'PATCH' && preg_match('#^/recommendations/(\d+)$#', $path, $m)) {
        return ok(People::updateRecommendation((int) $m[1], $body));
    }
    if ($method === 'DELETE' && preg_match('#^/recommendations/(\d+)$#', $path, $m)) {
        People::deleteRecommendation((int) $m[1]);
        return ok(['ok' => true]);
    }
    if ($method === 'POST' && $path === '/import/goodreads/preview') {
        if ($upload === null || trim($upload) === '') {
            throw new HttpException(400, 'Choose a Goodreads CSV export.');
        }
        return ok(Transfer::previewGoodreads($upload, $uploadName));
    }
    if ($method === 'POST' && $path === '/import/goodreads/commit') {
        return ok(Transfer::commitGoodreads((string) ($body['token'] ?? ''), (string) ($body['policy'] ?? 'fill_empty')));
    }
    if ($method === 'GET' && $path === '/export/json') {
        return [
            'status' => 200,
            'download' => json_encode(Transfer::exportJson(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
            'filename' => 'paper-trail-backup.json',
            'contentType' => 'application/json',
        ];
    }
    if ($method === 'GET' && $path === '/export/csv') {
        return [
            'status' => 200,
            'download' => Transfer::exportCsv(),
            'filename' => 'paper-trail-library.csv',
            'contentType' => 'text/csv',
        ];
    }
    if ($method === 'POST' && $path === '/import/backup') {
        if ($upload === null) {
            throw new HttpException(400, 'Choose a backup file.');
        }
        return ok(Transfer::importBackup($upload, !empty($body['confirm']) || (($query['confirm'] ?? '') === 'yes')));
    }
    if ($method === 'GET' && $path === '/errors') {
        return ok(Errors::list());
    }
    if ($method === 'GET' && $path === '/updates') {
        return ok(Updater::check());
    }
    if ($method === 'POST' && $path === '/updates/apply') {
        return ok(Updater::apply((string) ($body['version'] ?? '')));
    }

    throw new HttpException(404, 'That page is not part of the journal.');
}

function ok(array $body, int $status = 200, ?string $token = null): array
{
    $response = ['status' => $status, 'body' => $body];
    if ($token !== null) {
        $response['token'] = $token;
    }
    return $response;
}

function handle_http(): void
{
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if ($method === 'GET' && !str_starts_with($uri, '/api')) {
        serve_spa();
        return;
    }
    if (!str_starts_with($uri, '/api')) {
        throw new HttpException(404, 'Not found.');
    }
    $path = substr($uri, 4);
    $path = $path === false || $path === '' ? '/' : $path;
    $body = [];
    $upload = null;
    $uploadName = 'import.csv';
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_contains($contentType, 'application/json')) {
        $raw = file_get_contents('php://input');
        if ($raw !== false && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                throw new HttpException(400, 'Invalid JSON.');
            }
            $body = $decoded;
        }
    } elseif (!empty($_FILES['file']['tmp_name']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
        $upload = file_get_contents($_FILES['file']['tmp_name']);
        $uploadName = (string) ($_FILES['file']['name'] ?? 'import.csv');
        if ($upload === false) {
            throw new HttpException(400, 'Could not read the uploaded file.');
        }
        if (!empty($_POST['confirm'])) {
            $body['confirm'] = $_POST['confirm'] === 'yes' || $_POST['confirm'] === 'true';
        }
    }
    $result = dispatch(
        $method,
        $path,
        $body,
        $_GET,
        $_COOKIE[Auth::COOKIE] ?? null,
        is_string($upload) ? $upload : null,
        $uploadName,
        $_SERVER['REMOTE_ADDR'] ?? 'local',
        $_SERVER['HTTP_USER_AGENT'] ?? ''
    );
    emit($result);
}

function emit(array $result): void
{
    http_response_code($result['status'] ?? 200);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    if (array_key_exists('token', $result)) {
        $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
        setcookie(Auth::COOKIE, (string) $result['token'], [
            'expires' => $result['token'] === '' ? time() - 3600 : time() + 60 * 60 * 24 * 30,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $secure,
        ]);
    }
    if (isset($result['download'])) {
        header('Content-Type: ' . $result['contentType']);
        header('Content-Disposition: attachment; filename="' . $result['filename'] . '"');
        echo $result['download'];
        return;
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($result['body'], JSON_UNESCAPED_UNICODE);
}

function content_type(string $file): string
{
    return match (strtolower(pathinfo($file, PATHINFO_EXTENSION))) {
        'js', 'mjs' => 'text/javascript',
        'css' => 'text/css',
        'svg' => 'image/svg+xml',
        'json' => 'application/json',
        'webmanifest' => 'application/manifest+json',
        'png' => 'image/png',
        'html' => 'text/html; charset=utf-8',
        'woff2' => 'font/woff2',
        default => function_exists('mime_content_type') ? (mime_content_type($file) ?: 'application/octet-stream') : 'application/octet-stream',
    };
}

function serve_spa(): void
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $public = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public';
    $file = $public . str_replace('/', DIRECTORY_SEPARATOR, $path);
    if ($path !== '/' && is_file($file)) {
        header('Content-Type: ' . content_type($file));
        readfile($file);
        return;
    }
    $built = $public . DIRECTORY_SEPARATOR . 'app' . str_replace('/', DIRECTORY_SEPARATOR, $path);
    if ($path !== '/' && is_file($built)) {
        header('Content-Type: ' . content_type($built));
        readfile($built);
        return;
    }
    $index = $public . DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'index.html';
    if (!is_file($index)) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Paper Trail is installed, but the interface has not been built yet.\nRun npm run build from the project folder, or use the Vite dev server.";
        return;
    }
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' https://covers.openlibrary.org data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; script-src 'self'");
    readfile($index);
}
