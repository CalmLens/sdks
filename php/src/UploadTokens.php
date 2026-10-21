<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

final class UploadTokens
{
    public function __construct(#[\SensitiveParameter] private string $apiKey) {}
    public function __debugInfo(): array { return ['apiKey' => '[REDACTED]']; }

    /** Signs locally. expiresAt is Unix milliseconds. */
    public function sign(array $options): array
    {
        $preset = $options['uploadPresetId'] ?? null;
        Values::segment($preset);
        $ttl = $options['expiresInSeconds'] ?? 600;
        if (!is_int($ttl) || $ttl < 1 || $ttl > 3600) {
            Values::invalid('expiresInSeconds must be an integer from 1 to 3600');
        }
        if (array_key_exists('externalId', $options) && (!is_string($options['externalId']) || $options['externalId'] === '')) {
            Values::invalid('externalId must be non-empty');
        }
        $expiresAt = (int) floor(microtime(true) * 1000) + $ttl * 1000;
        $claims = ['v' => 1, 'u' => $preset, 'k' => substr($this->apiKey, 0, str_starts_with($this->apiKey, 'clsk_') ? 13 : 8), 'e' => $expiresAt, 'n' => Values::uuid()];
        if (isset($options['externalId'])) {
            $claims['x'] = $options['externalId'];
        }
        $body = rtrim(strtr(base64_encode(Values::json($claims)), '+/', '-_'), '=');
        $signature = hash_hmac('sha256', 'calmlens-upload-token:v1:' . $body, hash('sha256', $this->apiKey));
        return ['token' => 'clut_' . $body . '.' . $signature, 'expiresAt' => $expiresAt];
    }
}
