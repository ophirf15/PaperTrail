<?php

declare(strict_types=1);

use PaperTrail\Auth;
use PaperTrail\Html;
use PaperTrail\HttpException;
use PaperTrail\Updater;

$root = dirname(__DIR__);
$db = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'paper-trail-test-' . getmypid() . '.sqlite';
@unlink($db);
putenv('PAPER_TRAIL_DB_PATH=' . $db);
$_ENV['PAPER_TRAIL_DB_PATH'] = $db;
putenv('PAPER_TRAIL_GITHUB_REPO');
unset($_ENV['PAPER_TRAIL_GITHUB_REPO']);

require $root . '/api/src/bootstrap.php';

$failures = 0;

function check(bool $condition, string $label): void
{
    global $failures;
    if ($condition) {
        echo "  ok  {$label}\n";
        return;
    }
    $failures++;
    echo " FAIL {$label}\n";
}

function call(string $method, string $path, array $body = [], ?string $token = null, ?string $upload = null, string $ip = '127.0.0.1'): array
{
    try {
        return PaperTrail\dispatch($method, $path, $body, [], $token, $upload, 'goodreads.csv', $ip, 'test');
    } catch (HttpException $e) {
        return ['status' => $e->status, 'body' => ['error' => $e->getMessage()]];
    }
}

echo "Paper Trail tests\n";

$health = call('GET', '/health');
check($health['status'] === 200 && $health['body']['ok'] === true, 'health');

$setupStatus = call('GET', '/setup-status');
check($setupStatus['body']['needsSetup'] === true, 'needs setup');
$install = call('GET', '/install-status');
check($install['status'] === 200 && $install['body']['ready'] === true && $install['body']['needsSetup'] === true, 'install status describes a fresh library');
check($install['body']['configured'] === true && $install['body']['driver'] === 'sqlite', 'an existing file database is already configured');
$schema = file_get_contents($root . '/api/migrations/001_init.sql');
$translated = PaperTrail\mysql_migration_sql(is_string($schema) ? $schema : '');
check(str_contains($translated, 'id INTEGER PRIMARY KEY AUTO_INCREMENT'), 'mysql keys increment');
check(!str_contains($translated, 'year INTEGER PRIMARY KEY AUTO_INCREMENT'), 'mysql leaves the reading-goal year alone');
check(!str_contains($translated, 'COLLATE NOCASE') && !str_contains($translated, 'WHERE goodreads_book_id IS NOT NULL'), 'mysql schema drops sqlite-only index syntax');
check(str_contains($translated, '`key` VARCHAR(80) PRIMARY KEY'), 'mysql quotes the settings key');
$variant = file_get_contents($root . '/api/migrations/004_decor_variant.sql');
check(str_contains(PaperTrail\mysql_migration_sql(is_string($variant) ? $variant : ''), 'FLOOR(RAND() * 3)'), 'mysql decorations pick a variant');
try {
    PaperTrail\mysql_config(['host' => 'localhost', 'port' => 3306, 'name' => 'bad name', 'user' => 'reader', 'password' => 'secret']);
    check(false, 'mysql names are checked');
} catch (HttpException $exception) {
    check($exception->status === 400, 'mysql names are checked');
}
putenv('PAPER_TRAIL_DB_DRIVER=mysql');
$_ENV['PAPER_TRAIL_DB_DRIVER'] = 'mysql';
$mysqlInsert = PaperTrail\adapt_sql('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)');
putenv('PAPER_TRAIL_DB_DRIVER');
unset($_ENV['PAPER_TRAIL_DB_DRIVER']);
check(str_contains($mysqlInsert, 'INSERT IGNORE') && !str_contains($mysqlInsert, 'OR IGNORE'), 'mysql uses insert ignore');

$denied = call('GET', '/me');
check($denied['status'] === 401, 'me requires a session');

$weak = call('POST', '/setup', ['displayName' => 'Sophia', 'password' => 'short']);
check($weak['status'] === 400, 'short passwords are refused');

$setup = call('POST', '/setup', ['displayName' => 'Sophia', 'password' => 'library-key']);
check($setup['status'] === 201 && ($setup['token'] ?? '') !== '', 'setup issues a session');
$token = $setup['token'];

$again = call('POST', '/setup', ['displayName' => 'Other', 'password' => 'library-key']);
check($again['status'] === 409, 'setup cannot be repeated');

$me = call('GET', '/me', [], $token);
check($me['body']['user']['displayName'] === 'Sophia', 'session round trip');

call('POST', '/logout', [], $token);
check(call('GET', '/me', [], $token)['status'] === 401, 'logout revokes the session');

$bad = call('POST', '/login', ['password' => 'nope'], null, null, '10.1.1.1');
check($bad['status'] === 401, 'wrong password');
$login = call('POST', '/login', ['password' => 'library-key'], null, null, '10.1.1.1');
check($login['status'] === 200, 'login restores a session');
$token = $login['token'];

for ($i = 0; $i < 8; $i++) {
    call('POST', '/login', ['password' => 'nope'], null, null, '10.9.9.9');
}
$throttled = call('POST', '/login', ['password' => 'library-key'], null, null, '10.9.9.9');
check($throttled['status'] === 429, 'login is throttled');

$guest = call('POST', '/password', ['current' => 'library-key', 'password' => 'new-library-key']);
check($guest['status'] === 401, 'password change requires a session');
$other = call('POST', '/login', ['password' => 'library-key'], null, null, '10.2.2.2');
$wrong = call('POST', '/password', ['current' => 'nope', 'password' => 'new-library-key'], $token, null, '10.4.4.4');
check($wrong['status'] === 400, 'password change needs the current password');
$shortNext = call('POST', '/password', ['current' => 'library-key', 'password' => 'short'], $token);
check($shortNext['status'] === 400, 'a new password must be at least 8 characters');
$same = call('POST', '/password', ['current' => 'library-key', 'password' => 'library-key'], $token);
check($same['status'] === 400, 'the new password must be different');
$changed = call('POST', '/password', ['current' => 'library-key', 'password' => 'new-library-key'], $token);
check($changed['status'] === 200, 'password can be changed');
check(call('GET', '/me', [], $token)['status'] === 200, 'the current session stays signed in');
check(call('GET', '/me', [], $other['token'])['status'] === 401, 'other sessions are signed out');
$old = call('POST', '/login', ['password' => 'library-key'], null, null, '10.3.3.3');
check($old['status'] === 401, 'the old password no longer works');
$fresh = call('POST', '/login', ['password' => 'new-library-key'], null, null, '10.3.3.3');
check($fresh['status'] === 200, 'the new password signs in');

$created = call('POST', '/books', [
    'status' => 'reading',
    'title' => 'The Left Hand of Darkness',
    'authors' => ['Ursula K. Le Guin'],
    'pageCount' => 304,
    'publishYear' => 1969,
], $token);
check($created['status'] === 201 && $created['body']['status'] === 'reading', 'manual book lands on the reading shelf');
$bookId = (int) $created['body']['id'];

$dup = call('POST', '/books', [
    'status' => 'want',
    'title' => 'The Left Hand of Darkness',
    'authors' => ['Ursula K. Le Guin'],
], $token);
check($dup['body']['alreadyOwned'] === true && (int) $dup['body']['id'] === $bookId, 'duplicate title and author is reused');

$progress = call('PATCH', "/books/{$bookId}/entry", ['currentPage' => 152], $token);
check($progress['body']['progressPercent'] === 50.0, 'progress follows the page');

$rated = call('PATCH', "/books/{$bookId}/entry", ['rating' => 4.5], $token);
check($rated['body']['rating'] === 4.5, 'half-star rating saves');

$journal = call('PUT', "/books/{$bookId}/journal", ['bodyHtml' => '<p>Ice and <strong>trust</strong>.</p><script>alert(1)</script>'], $token);
check(str_contains($journal['body']['journalHtml'], '<strong>trust</strong>') && !str_contains($journal['body']['journalHtml'], 'script'), 'journal sanitizes and saves');

$quote = call('POST', "/books/{$bookId}/quotes", ['body' => 'The king was pregnant.', 'location' => 'p. 90', 'note' => 'Still startling.'], $token);
check($quote['status'] === 201, 'quote is saved');

$person = call('POST', '/contacts', ['name' => 'Sarah', 'nickname' => 'S'], $token);
$rec = call('POST', "/books/{$bookId}/recommendations", ['contactId' => $person['body']['id'], 'note' => 'She would love the quiet politics.'], $token);
check($rec['status'] === 201, 'recommendation links a person');

call('PUT', '/goals/' . gmdate('Y'), ['target' => 1], $token);
$finished = call('PATCH', "/books/{$bookId}/entry", ['status' => 'finished', 'dateFinished' => gmdate('Y') . '-02-02'], $token);
check($finished['body']['status'] === 'finished' && $finished['body']['goalReached'] === true, 'finishing a book counts toward the goal');
$stats = call('GET', '/stats', [], $token);
check($stats['body']['finishedThisYear'] === 1, 'stats use the finish date');

$csv = (string) file_get_contents($root . '/tests/fixtures/goodreads.csv');
$preview = call('POST', '/import/goodreads/preview', [], $token, $csv);
check($preview['body']['counts']['new'] === 3, 'goodreads preview counts new books');
$commit = call('POST', '/import/goodreads/commit', ['token' => $preview['body']['token'], 'policy' => 'fill_empty'], $token);
check($commit['body']['imported'] === 3 && $commit['body']['failed'] === 0, 'goodreads import creates books');

$library = call('GET', '/library', [], $token);
$achilles = null;
foreach ($library['body'] as $book) {
    if ($book['goodreadsBookId'] === '101') {
        $achilles = $book;
    }
}
check($achilles && $achilles['status'] === 'finished' && $achilles['rating'] === 5.0, 'goodreads shelf and rating map across');
$detail = call('GET', '/books/' . $achilles['id'], [], $token);
$originalJournal = $detail['body']['journalHtml'];
check(str_contains($originalJournal, 'A spear and a song'), 'empty journal can receive the imported review once');
call('PUT', '/books/' . $achilles['id'] . '/journal', ['bodyHtml' => '<p>My own margin note.</p>'], $token);

$updateCsv = (string) file_get_contents($root . '/tests/fixtures/goodreads-update.csv');
$preview2 = call('POST', '/import/goodreads/preview', [], $token, $updateCsv);
check($preview2['body']['counts']['duplicates'] === 1 && $preview2['body']['counts']['new'] === 1, 'second import detects duplicates');
call('POST', '/import/goodreads/commit', ['token' => $preview2['body']['token'], 'policy' => 'use_import'], $token);
$detail = call('GET', '/books/' . $achilles['id'], [], $token);
check($detail['body']['journalHtml'] === '<p>My own margin note.</p>', 'reimport leaves the journal alone');
check($detail['body']['rating'] === 2.0, 'use_import may replace a rating when asked');
$library = call('GET', '/library', [], $token);
$ids = array_column($library['body'], 'goodreadsBookId');
check(count(array_filter($ids, static fn ($id) => $id === '101')) === 1, 'goodreads ids are never duplicated');

$export = call('GET', '/export/json', [], $token);
$backup = json_decode($export['download'], true);
check(is_array($backup) && !isset($backup['sessions']) === false && !str_contains($export['download'], 'password'), 'json backup keeps relationships and omits passwords');
call('DELETE', '/books/' . $bookId, [], $token);
$restored = call('POST', '/import/backup', ['confirm' => true], $token, $export['download']);
check($restored['body']['restored'] === true, 'backup restores the shelves');
$back = call('GET', '/books/' . $bookId, [], $token);
check($back['status'] === 200 && $back['body']['title'] === 'The Left Hand of Darkness', 'restored book is still there');

$dirty = Html::sanitize('<img src=x onerror=alert(1)><p>Kept</p>');
check($dirty === '<p>Kept</p>', 'html helper strips unexpected tags');
check(Updater::isAllowedAssetUrl('https://github.com/example/paper-trail/releases/download/v1/paper-trail-update.zip') === true, 'github release hosts are trusted');
check(Updater::isAllowedAssetUrl('http://github.com/evil.zip') === false, 'plain http downloads are rejected');
check(Updater::isAllowedAssetUrl('https://evil.example/update.zip') === false, 'unknown hosts are rejected');
check(Updater::preserved('.env') && Updater::preserved('data/paper-trail.sqlite') && !Updater::preserved('public/index.php'), 'updater preserve list');
check(Updater::safeZipPath('../.env') === false, 'zip paths cannot climb out');

$timeline = call('GET', '/timeline', [], $token);
check(count($timeline['body']) > 0, 'timeline has reading activity');

$badDecor = call('POST', '/decorations', ['shelfIndex' => 0, 'kind' => 'dragon'], $token);
check($badDecor['status'] === 400, 'unknown ornaments are refused');
$plant = call('POST', '/decorations', ['shelfIndex' => 0, 'kind' => 'plant'], $token);
check($plant['status'] === 201 && $plant['body']['kind'] === 'plant', 'an ornament can be placed');
$wooble = call('POST', '/decorations', ['shelfIndex' => 1, 'kind' => 'wooble', 'slot' => 4], $token);
check($wooble['status'] === 201 && $wooble['body']['kind'] === 'wooble' && $wooble['body']['slot'] === 4 && in_array($wooble['body']['variant'], [0, 1, 2], true), 'a wooble can be placed on the right');
call('DELETE', '/decorations/' . $wooble['body']['id'], [], $token);
$listed = call('GET', '/decorations', [], $token);
check(count($listed['body']) === 1 && $listed['body'][0]['shelfIndex'] === 0, 'ornaments stay on the shelf');
$removed = call('DELETE', '/decorations/' . $plant['body']['id'], [], $token);
check($removed['status'] === 200 && count(call('GET', '/decorations', [], $token)['body']) === 0, 'an ornament can be removed');
$style = call('PUT', '/settings', ['shelfStyle' => 'spines'], $token);
check($style['body']['shelfStyle'] === 'spines', 'shelf style is saved');
$badStyle = call('PUT', '/settings', ['shelfStyle' => 'marble'], $token);
check($badStyle['status'] === 400, 'unknown shelf styles are refused');
$arrange = call('PUT', '/settings', ['shelfArrange' => 'genre', 'shelfOrder' => '3,1,2'], $token);
check($arrange['body']['shelfArrange'] === 'genre' && $arrange['body']['shelfOrder'] === '3,1,2', 'shelf arrangement is saved');
$badArrange = call('PUT', '/settings', ['shelfArrange' => 'color'], $token);
check($badArrange['status'] === 400, 'unknown arrangements are refused');
$badOrder = call('PUT', '/settings', ['shelfOrder' => '1,nope'], $token);
check($badOrder['status'] === 400, 'shelf order must be book ids');

@unlink($db);
echo $failures === 0 ? "\nAll tests passed.\n" : "\n{$failures} failed.\n";
exit($failures === 0 ? 0 : 1);
