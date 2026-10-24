<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

final class UploadTokens
{
    public const PREFIX = 'clut_';
    public const SIGNING_CONTEXT = 'calmlens-upload-token:v1:';
    /** Token lifetime in seconds when `expiresInSeconds` is omitted. */
    public const DEFAULT_EXPIRES_IN_SECONDS = 600;
    public const MAX_EXPIRES_IN_SECONDS = 3600;

    public function __construct(#[\SensitiveParameter] private string $apiKey) {}
    public function __debugInfo(): array { return ['apiKey' => '[REDACTED]']; }

    /**
     * Signs a token locally for `uploadPresetId`, optionally with an `externalId` and an
     * `expiresInSeconds` lifetime (1 to 3600, default 600). `expiresAt` is Unix milliseconds.
     *
     * @return array{token: string, expiresAt: int}
     */
    public function sign(array $options): array
    {
        return self::signAt($this->apiKey, $options, (int) floor(microtime(true) * 1000), Values::uuid());
    }

    /**
     * Signs with a fixed clock (`now`, epoch milliseconds) and nonce, with the same validation as
     * `sign`. Use `Testing\MockServerClient::signUploadToken` in tests. @internal
     */
    public static function signAt(#[\SensitiveParameter] string $apiKey, array $options, int $now, string $nonce): array
    {
        $preset = $options['uploadPresetId'] ?? null;
        Values::segment($preset);
        $ttl = $options['expiresInSeconds'] ?? self::DEFAULT_EXPIRES_IN_SECONDS;
        if (!is_int($ttl) || $ttl < 1 || $ttl > self::MAX_EXPIRES_IN_SECONDS) {
            Values::invalid('expiresInSeconds must be an integer from 1 to 3600');
        }
        if (array_key_exists('externalId', $options) && (!is_string($options['externalId']) || $options['externalId'] === '')) {
            Values::invalid('externalId must be non-empty');
        }
        $expiresAt = $now + $ttl * 1000;
        $claims = ['v' => 1, 'u' => $preset, 'k' => substr($apiKey, 0, str_starts_with($apiKey, 'clsk_') ? 13 : 8), 'e' => $expiresAt, 'n' => $nonce];
        if (isset($options['externalId'])) {
            $claims['x'] = $options['externalId'];
        }
        // As JSON.stringify writes it: raw UTF-8, with `/` unescaped.
        $body = rtrim(strtr(base64_encode(Values::json($claims)), '+/', '-_'), '=');
        $signature = hash_hmac('sha256', self::SIGNING_CONTEXT . $body, hash('sha256', $apiKey));
        return ['token' => self::PREFIX . $body . '.' . $signature, 'expiresAt' => $expiresAt];
    }
}
