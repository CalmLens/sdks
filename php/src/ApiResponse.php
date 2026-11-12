<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * The HTTP response behind a result: its `status`, `headers` and `requestId` (the `X-Request-Id`
 * header; include it when contacting support). `$asset->getLastResponse()` returns the one an
 * object came from, and `ServerClient::request()` returns one with its decoded `json` body.
 */
final class ApiResponse
{
    /** @param array<string, list<string>> $headers */
    public function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly ?string $requestId,
        public readonly mixed $json = null,
    ) {}

    /** A response header by case-insensitive name, its values joined with `, `, or null. */
    public function header(string $name): ?string
    {
        foreach ($this->headers as $key => $values) {
            if (strcasecmp((string) $key, $name) === 0) {
                return implode(', ', (array) $values);
            }
        }
        return null;
    }
}
