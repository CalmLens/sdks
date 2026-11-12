<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use CalmLens\Model\UploadToken;
use CalmLens\UploadTokens;

/** @internal */
final class UploadTokenSigner
{
    /**
     * Signs an upload token with a fixed clock (`now`, epoch milliseconds) and nonce, as
     * `UploadTokens::sign` and `Testing\MockServerClient::signUploadToken` do.
     */
    public static function sign(#[\SensitiveParameter] string $apiKey, array $options, int $now, string $nonce): UploadToken
    {
        Values::knownOptions($options, 'uploadTokens.sign');
        $preset = $options['uploadPresetId'] ?? null;
        Values::segment($preset);
        $ttl = $options['expiresIn'] ?? UploadTokens::DEFAULT_EXPIRES_IN;
        if (!is_int($ttl) || $ttl < 1 || $ttl > UploadTokens::MAX_EXPIRES_IN) {
            Values::invalid('expiresIn must be an integer from 1 to 3600');
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
        $signature = hash_hmac('sha256', UploadTokens::SIGNING_CONTEXT . $body, hash('sha256', $apiKey));
        return UploadToken::constructFrom(['token' => UploadTokens::PREFIX . $body . '.' . $signature, 'expiresAt' => $expiresAt]);
    }
}
