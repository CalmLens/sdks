<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

final class Webhooks
{
    public const DELIVERY_HEADER = 'x-calmlens-delivery';
    public const TIMESTAMP_HEADER = 'x-calmlens-timestamp';
    public const SIGNATURE_HEADER = 'x-calmlens-signature';

    public static function signatureHeader(string $payload, string|int $timestamp, #[\SensitiveParameter] string $secret): string
    {
        if ($secret === '') {
            Values::invalid('secret must be non-empty');
        }
        return 'v1=' . hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    }

    public static function verify(string $payload, ?string $signature, string|int|null $timestamp,
        #[\SensitiveParameter] string $secret, int $toleranceSeconds = 300, ?int $now = null): bool
    {
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

    /** Verifies the exact raw bytes before parsing; preserves unknown event types and fields. */
    public static function parseEvent(string $payload, ?string $signature, string|int|null $timestamp,
        #[\SensitiveParameter] string $secret, int $toleranceSeconds = 300, ?int $now = null): array
    {
        if (!self::verify($payload, $signature, $timestamp, $secret, $toleranceSeconds, $now)) {
            throw new CalmLensException('sdk/invalid-webhook-signature');
        }
        try {
            $object = json_decode($payload, false, 512, JSON_THROW_ON_ERROR);
            if (!$object instanceof \stdClass || !is_string($object->id ?? null) || !is_string($object->type ?? null)
                || !is_int($object->createdAt ?? null) || !is_string($object->projectId ?? null) || !($object->data ?? null) instanceof \stdClass) {
                throw new \JsonException('Not an event');
            }
            return json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new CalmLensException('sdk/invalid-webhook-payload');
        }
    }

    public static function isTest(array $event): bool
    {
        foreach ($event['data']['facts'] ?? [] as $fact) {
            if (($fact['key'] ?? null) === 'test' && ($fact['value'] ?? null) === true) {
                return true;
            }
        }
        return false;
    }
}
