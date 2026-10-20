<?php

declare(strict_types=1);

namespace PaperTrail;

require __DIR__ . '/Support.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/Html.php';
require __DIR__ . '/Errors.php';
require __DIR__ . '/Metadata.php';
require __DIR__ . '/Library.php';
require __DIR__ . '/Decor.php';
require __DIR__ . '/Journal.php';
require __DIR__ . '/People.php';
require __DIR__ . '/Transfer.php';
require __DIR__ . '/Updater.php';
require __DIR__ . '/dispatch.php';

load_env_file(Database::root() . DIRECTORY_SEPARATOR . '.env');
if (database_configured()) {
    try {
        Database::migrate();
    } catch (\Throwable $e) {
        render_startup_failure($e);
        exit;
    }
}

set_exception_handler(static function (\Throwable $e): void {
    if ($e instanceof HttpException) {
        http_response_code($e->status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => $e->getMessage()]);
        return;
    }
    Errors::capture('backend', $e->getMessage(), $e->getTraceAsString(), $_SERVER['REQUEST_URI'] ?? null);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Something went wrong while turning the page.']);
});
