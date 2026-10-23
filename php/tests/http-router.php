<?php
// Loopback fixture exercising the actual HTTP transport, not a Cloudflare API mock.
if (str_ends_with(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/redirect')) {
    header('Location: /redirect-target', true, 302);
    exit;
}
header('Content-Type: application/json');
echo json_encode([
    'method' => $_SERVER['REQUEST_METHOD'],
    'path' => parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH),
    'query' => $_GET,
    'bytes' => base64_encode(file_get_contents('php://input')),
    'apiKey' => $_SERVER['HTTP_X_API_KEY'] ?? null,
    'idempotencyKey' => $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? null,
    'contentType' => $_SERVER['CONTENT_TYPE'] ?? null,
]);
