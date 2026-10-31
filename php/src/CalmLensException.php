<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * Base class of every error the SDK raises. Catch it to handle any CalmLens failure, or catch a
 * subclass from `CalmLens\Exception` (`NotFoundException`, `RateLimitException`,
 * `TimeoutException`, `InvalidArgumentException` and so on). Compare `errorCode` with the
 * constants in `ErrorCodes` and `SdkErrorCodes`, never with the message.
 */
class CalmLensException extends \RuntimeException
{
    /**
     * The request ID: the `X-Request-Id` response header, or the error body's `requestId` without
     * it. Include it when contacting support.
     */
    public readonly ?string $requestId;

    /**
     * @param array $details the API error's `details` object, such as validation issues; empty for transport errors.
     * @param array<string, list<string>|string> $headers response headers (empty without a response).
     */
    public function __construct(
        public readonly string $errorCode,
        string $message = '',
        public readonly ?int $status = null,
        public readonly array $details = [],
        public readonly array $headers = [],
        ?\Throwable $previous = null,
        ?string $requestId = null,
    ) {
        parent::__construct($message ?: $errorCode, 0, $previous);
        $this->requestId = $requestId ?? $this->header('x-request-id');
    }

    /**
     * Builds the most specific exception class for a code and HTTP status: an `ApiException`
     * subclass for error statuses, otherwise one chosen by the SDK code.
     */
    public static function create(string $errorCode, string $message = '', ?int $status = null, array $details = [],
        array $headers = [], ?\Throwable $previous = null, ?string $requestId = null): self
    {
        $class = match (true) {
            $status !== null && $status >= 400 => match (true) {
                $status === 400 => Exception\BadRequestException::class,
                $status === 401 => Exception\AuthenticationException::class,
                $status === 403 => Exception\PermissionDeniedException::class,
                $status === 404 => Exception\NotFoundException::class,
                $status === 409 => Exception\ConflictException::class,
                $status === 429 => Exception\RateLimitException::class,
                $status >= 500 => Exception\ServerException::class,
                default => Exception\ApiException::class,
            },
            $errorCode === SdkErrorCodes::TIMEOUT => Exception\TimeoutException::class,
            $errorCode === SdkErrorCodes::TRANSPORT_ERROR => Exception\ConnectionException::class,
            in_array($errorCode, [SdkErrorCodes::INVALID_RESPONSE, SdkErrorCodes::RESPONSE_TOO_LARGE], true) => Exception\InvalidResponseException::class,
            $errorCode === SdkErrorCodes::INVALID_CONFIG => Exception\ConfigurationException::class,
            in_array($errorCode, [SdkErrorCodes::INVALID_WEBHOOK_SIGNATURE, SdkErrorCodes::INVALID_WEBHOOK_PAYLOAD], true) => Exception\WebhookVerificationException::class,
            default => Exception\InvalidArgumentException::class,
        };
        return new $class($errorCode, $message, $status, $details, $headers, $previous, $requestId);
    }

    /** A response header by case-insensitive name, or null. */
    public function header(string $name): ?string
    {
        foreach ($this->headers as $key => $value) {
            if (strcasecmp((string) $key, $name) === 0) {
                $value = is_array($value) ? ($value[0] ?? null) : $value;
                return is_string($value) ? $value : null;
            }
        }
        return null;
    }

    /**
     * Seconds to wait before retrying, from the `Retry-After` header (whole seconds or an HTTP
     * date, rounded up), or null.
     */
    public function retryAfter(): ?float
    {
        $seconds = Internal\Session::retryAfter($this->header('retry-after'));
        return $seconds === null ? null : (float) $seconds;
    }

    /** True when the resource does not exist. */
    public function isNotFound(): bool
    {
        return $this->status === 404 || str_ends_with($this->errorCode, '/not-found');
    }

    /**
     * True when repeating the same request may succeed: connection failures, timeouts,
     * throttling (429), 502/503/504 and `idempotency/request-in-progress`. Repeat a write only
     * with the same idempotency key.
     */
    public function isRetryable(): bool
    {
        return in_array($this->status, [429, 502, 503, 504], true)
            || in_array($this->errorCode, [SdkErrorCodes::TIMEOUT, SdkErrorCodes::TRANSPORT_ERROR, ErrorCodes::IDEMPOTENT_REQUEST_IN_PROGRESS], true);
    }
}
