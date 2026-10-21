<?php

declare(strict_types=1);

namespace CalmLens;

class CalmLensException extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message = '',
        public readonly ?int $status = null,
        public readonly array $details = [],
        public readonly array $headers = [],
    ) {
        parent::__construct($message ?: $errorCode);
    }

    public function isRetryable(): bool
    {
        return in_array($this->status, [429, 502, 503, 504], true)
            || in_array($this->errorCode, ['sdk/timeout', 'sdk/transport-error', 'idempotency/request-in-progress'], true);
    }
}
