<?php

declare(strict_types=1);

// Front controller for PHP's built-in server: `php -S 127.0.0.1:6407 -t public public/index.php`.
if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))) {
    return false; // style.css
}
require __DIR__ . '/../vendor/autoload.php';

$scheme = (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
try {
    $app = Chirp\App::fromEnvironment(getenv(), $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '127.0.0.1:6407'));
} catch (RuntimeException $error) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo $error->getMessage(), "\n";
    return;
}
$app->handle(Chirp\Request::fromGlobals())->send();
