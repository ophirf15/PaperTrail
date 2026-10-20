<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$password = $argv[1] ?? '';
if ($password === '') {
    fwrite(STDERR, "Usage: php scripts/reset-password.php \"a new password\"\n");
    exit(1);
}

require dirname(__DIR__) . '/api/src/bootstrap.php';

try {
    PaperTrail\Auth::resetPassword($password);
} catch (PaperTrail\HttpException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

fwrite(STDOUT, "Password updated. Existing sessions were signed out.\n");
