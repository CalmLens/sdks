<?php

declare(strict_types=1);

namespace Chirp;

/** An incoming request, independent of PHP's globals so tests can build one. */
final class Request
{
    /**
     * @param array<string, string> $headers lower-case names
     * @param array<string, array{path: string, size: int, error: int}> $files uploads already checked with is_uploaded_file
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query = [],
        public readonly array $form = [],
        public readonly array $files = [],
        public readonly array $cookies = [],
        public readonly array $headers = [],
        public readonly string $body = '',
    ) {}

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = (string) $value;
            }
        }
        $files = [];
        foreach ($_FILES as $name => $file) {
            if (is_array($file) && is_string($file['tmp_name'] ?? null) && ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                $files[$name] = ['path' => is_uploaded_file($file['tmp_name']) ? $file['tmp_name'] : '',
                    'size' => (int) $file['size'], 'error' => (int) $file['error']];
            }
        }
        $isForm = str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') || str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/x-www-form-urlencoded');
        return new self($_SERVER['REQUEST_METHOD'] ?? 'GET', parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/',
            $_GET, $_POST, $files, $_COOKIE, $headers, $isForm ? '' : (string) file_get_contents('php://input'));
    }
}

final class Response
{
    /** @param array<string, string|list<string>> $headers */
    public function __construct(public readonly int $status, public readonly string $body = '', public array $headers = []) {}

    public static function html(string $body, int $status = 200): self
    {
        return new self($status, $body, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public static function redirect(string $location): self
    {
        return new self(303, '', ['Location' => $location]);
    }

    public function withCookie(string $cookie): self
    {
        $this->headers['Set-Cookie'] = [...(array) ($this->headers['Set-Cookie'] ?? []), $cookie];
        return $this;
    }

    public function send(): void
    {
        http_response_code($this->status);
        header('X-Content-Type-Options: nosniff');
        foreach ($this->headers as $name => $values) {
            foreach ((array) $values as $value) {
                header("$name: $value", false);
            }
        }
        echo $this->body;
    }
}
