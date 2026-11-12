<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\UploadTokenSigner;
use CalmLens\Internal\Values;
use CalmLens\Model\UploadToken;

final class UploadTokens
{
    public const PREFIX = 'clut_';
    public const SIGNING_CONTEXT = 'calmlens-upload-token:v1:';
    /** Token lifetime in seconds when `expiresIn` is omitted. */
    public const DEFAULT_EXPIRES_IN = 600;
    /** The longest token lifetime, in seconds. */
    public const MAX_EXPIRES_IN = 3600;

    public function __construct(#[\SensitiveParameter] private string $apiKey) {}
    public function __debugInfo(): array { return ['apiKey' => '[REDACTED]']; }

    /**
     * Signs a token locally for `uploadPresetId`, optionally with an `externalId` and an
     * `expiresIn` lifetime in seconds (1 to 3600, default 600). `expiresAt` is Unix milliseconds.
     *
     * @param array{uploadPresetId: string, externalId?: string, expiresIn?: int} $params
     */
    public function sign(array $params): UploadToken
    {
        return UploadTokenSigner::sign($this->apiKey, $params, (int) floor(microtime(true) * 1000), Values::uuid());
    }
}
