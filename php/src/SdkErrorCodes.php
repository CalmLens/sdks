<?php

declare(strict_types=1);

namespace CalmLens;

/** Codes for errors the SDK raises itself, before or instead of an API response. */
final class SdkErrorCodes
{
    /** A method received a missing, malformed or conflicting argument. */
    public const INVALID_ARGUMENT = 'sdk/invalid-argument';
    /** The client was constructed with an invalid configuration. */
    public const INVALID_CONFIG = 'sdk/invalid-config';
    /** The connection failed or broke before a complete response arrived. */
    public const TRANSPORT_ERROR = 'sdk/transport-error';
    /** Connecting, sending or receiving took longer than the configured timeout, or no decision arrived in time. */
    public const TIMEOUT = 'sdk/timeout';
    /** A successful response could not be read. */
    public const INVALID_RESPONSE = 'sdk/invalid-response';
    /** A response body (or its declared Content-Length) was larger than `maxResponseBytes` (32 MiB by default). */
    public const RESPONSE_TOO_LARGE = 'sdk/response-too-large';
    /** An error response did not carry a CalmLens error code. */
    public const HTTP_ERROR = 'sdk/http-error';
    /** A webhook signature or timestamp did not verify. */
    public const INVALID_WEBHOOK_SIGNATURE = 'sdk/invalid-webhook-signature';
    /** A verified webhook body was not a CalmLens event payload. */
    public const INVALID_WEBHOOK_PAYLOAD = 'sdk/invalid-webhook-payload';
}
