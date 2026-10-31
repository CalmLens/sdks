<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

final class Webhooks
{
    public const DELIVERY_HEADER = 'x-calmlens-delivery';
    public const TIMESTAMP_HEADER = 'x-calmlens-timestamp';
    public const SIGNATURE_HEADER = 'x-calmlens-signature';
    /** Deliveries whose timestamp is further than this from the receiver's clock are rejected. */
    public const SIGNATURE_TOLERANCE_SECONDS = 300;

    /** `v1=<hex HMAC-SHA256 of "<timestamp>.<payload>">`, the `x-calmlens-signature` value. */
    public static function signatureHeader(string $payload, string|int $timestamp, #[\SensitiveParameter] string $secret): string
    {
        if ($secret === '') {
            Values::invalid('secret must be non-empty');
        }
        return 'v1=' . hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    }

    /**
     * Headers for one signed delivery of the raw body, as CalmLens sends them; for testing a
     * webhook receiver. `timestamp` defaults to now (Unix seconds).
     *
     * @return array<string, string>
     */
    public static function createHeaders(string $payload, string $deliveryId, #[\SensitiveParameter] string $secret, ?int $timestamp = null): array
    {
        $timestamp ??= time();
        return [
            'content-type' => 'application/json',
            self::DELIVERY_HEADER => $deliveryId,
            self::TIMESTAMP_HEADER => (string) $timestamp,
            self::SIGNATURE_HEADER => self::signatureHeader($payload, $timestamp, $secret),
        ];
    }

    /**
     * The JSON body a webhook delivers for an event, such as one from `events->list`: the event in
     * the same flat shape `events->list` returns it. Fields that are not part of that shape are left out.
     */
    public static function toPayload(array $event): array
    {
        return [
            'id' => $event['id'], 'projectId' => $event['projectId'], 'type' => $event['type'],
            'severity' => $event['severity'], 'title' => $event['title'], 'description' => $event['description'] ?? null,
            'assetId' => $event['assetId'] ?? null, 'asset' => $event['asset'] ?? null, 'facts' => $event['facts'],
            'createdAt' => $event['createdAt'],
        ];
    }

    /**
     * Returns true when the exact raw `payload` is a delivery signed with `secret`. A null
     * `signature` or `timestamp` is read from `headers`: request headers (names compared
     * case-insensitively; values may be strings or PSR-7 style lists) or `$_SERVER`.
     */
    public static function verify(string $payload, ?string $signature, string|int|null $timestamp,
        #[\SensitiveParameter] string $secret, int $toleranceSeconds = self::SIGNATURE_TOLERANCE_SECONDS, ?int $now = null,
        array $headers = []): bool
    {
        $signature ??= self::header($headers, self::SIGNATURE_HEADER);
        $timestamp ??= self::header($headers, self::TIMESTAMP_HEADER);
        $stamp = trim((string) $timestamp);
        if ($secret === '' || !$signature || !preg_match('/^[0-9]+$/D', $stamp) || $toleranceSeconds < 0
            || abs(($now ?? time()) - (float) $stamp) > $toleranceSeconds) {
            return false;
        }
        $expected = substr(self::signatureHeader($payload, $stamp, $secret), 3);
        foreach (explode(',', $signature) as $entry) {
            $entry = trim($entry);
            if (str_starts_with($entry, 'v1=') && hash_equals($expected, strtolower(substr($entry, 3)))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Verifies the exact raw bytes before parsing; preserves unknown event types and fields.
     * Throws `Exception\WebhookVerificationException`.
     */
    public static function parseEvent(string $payload, ?string $signature, string|int|null $timestamp,
        #[\SensitiveParameter] string $secret, int $toleranceSeconds = self::SIGNATURE_TOLERANCE_SECONDS, ?int $now = null,
        array $headers = []): array
    {
        if (!self::verify($payload, $signature, $timestamp, $secret, $toleranceSeconds, $now, $headers)) {
            throw CalmLensException::create('sdk/invalid-webhook-signature', 'Webhook signature or timestamp is invalid');
        }
        try {
            $object = json_decode($payload, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw CalmLensException::create('sdk/invalid-webhook-payload', 'Webhook body is not JSON', previous: $error);
        }
        if (!self::isEvent($object)) {
            throw CalmLensException::create('sdk/invalid-webhook-payload', 'Webhook body is not an event');
        }
        // Unknown event types and fields are kept.
        return json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
    }

    /** The API's event shape: the fields every event has and, when present, the types of the other known fields. */
    private static function isEvent(mixed $object): bool
    {
        if (!$object instanceof \stdClass || !is_string($object->id ?? null) || !is_string($object->type ?? null)
            || !is_string($object->projectId ?? null) || !(is_int($object->createdAt ?? null) || is_float($object->createdAt ?? null))) {
            return false;
        }
        $fields = get_object_vars($object);
        $nullableString = fn (string $key) => !array_key_exists($key, $fields) || $fields[$key] === null || is_string($fields[$key]);
        if ((array_key_exists('severity', $fields) && !is_string($fields['severity']))
            || (array_key_exists('title', $fields) && !is_string($fields['title']))
            || !$nullableString('description') || !$nullableString('assetId')) {
            return false;
        }
        if (array_key_exists('asset', $fields) && $fields['asset'] !== null
            && (!$fields['asset'] instanceof \stdClass || !is_string($fields['asset']->id ?? null))) {
            return false;
        }
        if (array_key_exists('facts', $fields)) {
            if (!is_array($fields['facts'])) {
                return false;
            }
            foreach ($fields['facts'] as $fact) {
                if (!$fact instanceof \stdClass || !is_string($fact->key ?? null) || !property_exists($fact, 'value')
                    || (property_exists($fact, 'url') && !is_string($fact->url))) {
                    return false;
                }
            }
        }
        return true;
    }

    /** True for a test delivery: `facts` holds the fact `test` with the boolean value true. */
    public static function isTest(array $event): bool
    {
        foreach ($event['facts'] ?? [] as $fact) {
            if (($fact['key'] ?? null) === 'test' && ($fact['value'] ?? null) === true) {
                return true;
            }
        }
        return false;
    }

    private static function header(array $headers, string $name): ?string
    {
        $found = [];
        foreach ($headers as $key => $value) {
            // Also accepts `$_SERVER` keys such as HTTP_X_CALMLENS_SIGNATURE.
            $key = strtolower((string) $key);
            if ($key === $name || str_replace('_', '-', preg_replace('/^http_/', '', $key)) === $name) {
                $found = array_merge($found, is_array($value) ? $value : [$value]);
            }
        }
        // Repeated headers join with `,`: a signature list may be split across them.
        $found = array_filter($found, 'is_scalar');
        return $found === [] ? null : implode(',', array_map('strval', $found));
    }
}
