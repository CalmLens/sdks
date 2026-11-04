<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use CalmLens\CalmLensException;

/** @internal */
final class Values
{
    /** Option keys of methods that send no request of their own, or take keys of their own beside one. */
    private const LOCAL_OPTION_KEYS = [
        'assets.waitForDecision' => ['assetId', 'timeout'],
        'cdn.getAssetUrl' => ['assetIdentifier', 'lens', 'resource', 'transform', 'viewerClaims'],
        'cdn.serve' => ['assetIdentifier', 'init', 'lens', 'resource', 'transform', 'viewerClaims'],
        'uploadTokens.sign' => ['expiresInSeconds', 'externalId', 'uploadPresetId'],
    ];

    /** Fails with `sdk/invalid-argument` for an option `$operation` doesn't take, such as a misspelt key. */
    public static function knownOptions(array $options, string $operation): void
    {
        $allowed = self::LOCAL_OPTION_KEYS[$operation] ?? OptionKeys::KEYS[$operation]
            ?? throw new \LogicException("No option keys for $operation");
        $unknown = array_diff(array_map('strval', array_keys($options)), [...$allowed, 'requestOptions']);
        if ($unknown !== []) {
            self::invalid('Unknown option' . (count($unknown) > 1 ? 's' : '') . " for $operation: " . implode(', ', $unknown));
        }
    }

    public static function invalid(string $message, string $code = 'sdk/invalid-argument', array $details = []): never
    {
        throw CalmLensException::create($code, $message, details: $details);
    }

    /**
     * `$options` without the options given as null that `$operation` doesn't send as null
     * (OptionKeys::NULLABLE): those are left out, as if omitted, since the API refuses null for them.
     */
    public static function withoutNulls(array $options, string $operation): array
    {
        $nullable = OptionKeys::NULLABLE[$operation] ?? [];
        return array_filter($options, fn ($value, $key) => $value !== null || in_array((string) $key, $nullable, true), ARRAY_FILTER_USE_BOTH);
    }

    /**
     * Whether the API accepts an upload of this MIME type: an image, audio, video, text, document
     * or website type, not a container such as `application/octet-stream`. It refuses any other
     * type with `upload/invalid-mime-type`.
     */
    public static function acceptedUploadMimeType(string $mimeType): bool
    {
        $type = self::uploadMimeType($mimeType);
        if (in_array($type, UploadMimeTypes::REJECTED, true)) {
            return false;
        }
        foreach (UploadMimeTypes::PREFIXES as $prefix) {
            if (str_starts_with($type, $prefix)) {
                return true;
            }
        }
        foreach (UploadMimeTypes::SUFFIXES as $suffix) {
            if (str_ends_with($type, $suffix)) {
                return true;
            }
        }
        return in_array($type, UploadMimeTypes::TYPES, true);
    }

    /** Fails with `upload/invalid-mime-type` (`details.mimeType`) for a type the API refuses. */
    public static function checkUploadMimeType(string $mimeType): void
    {
        if (!self::acceptedUploadMimeType($mimeType)) {
            self::invalid(self::refusedUploadMimeTypeMessage($mimeType), 'upload/invalid-mime-type', ['mimeType' => $mimeType]);
        }
    }

    /** The API's message for an upload of a type it refuses. */
    public static function refusedUploadMimeTypeMessage(string $mimeType): string
    {
        return self::uploadMimeType($mimeType) . ' is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or text/plain.';
    }

    /** A MIME type lower-cased and without its parameters, as the API compares it. */
    private static function uploadMimeType(string $mimeType): string
    {
        return trim(explode(';', strtolower($mimeType), 2)[0]);
    }

    public static function segment(mixed $value): string
    {
        if (!is_string($value) || $value === '' || $value === '.' || $value === '..') {
            self::invalid('An ID must be a non-empty string other than . or ..');
        }
        return strtr(rawurlencode($value), ['%21' => '!', '%27' => "'", '%28' => '(', '%29' => ')', '%2A' => '*']);
    }

    public static function url(string $url): string
    {
        $parts = parse_url($url);
        if (!$parts || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)
            || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment']) || preg_match('/[\x00-\x20\x7f]/', $url)) {
            self::invalid('Base URL must be HTTP(S) without credentials, query or fragment', 'sdk/invalid-config');
        }
        return rtrim($url, '/');
    }

    public static function json(mixed $value): string
    {
        try {
            return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (\JsonException $error) {
            self::invalid($error->getMessage());
        }
    }

    public static function query(array $values): string
    {
        $pairs = [];
        $append = function (string $key, mixed $value) use (&$append, &$pairs): void {
            if ($value === null) {
                return;
            }
            if (is_array($value) || is_object($value)) {
                foreach ($value as $child => $item) {
                    $append($key . '[' . $child . ']', $item);
                }
            } else {
                $pairs[] = rawurlencode($key) . '=' . rawurlencode(self::scalar($value));
            }
        };
        foreach ($values as $key => $value) {
            $append((string) $key, in_array($key, ['metadata', 'processingOptions', 'context'], true) && $value !== null ? self::json($value) : $value);
        }
        return implode('&', $pairs);
    }

    public static function scalar(mixed $value): string
    {
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_string($value) || is_int($value)) {
            return (string) $value;
        }
        if (!is_float($value) || !is_finite($value)) {
            self::invalid('Expected a string, finite number or boolean');
        }
        if ($value == 0) {
            return '0';
        }
        // Use PHP's shortest round-trip representation, placed with JavaScript's exponent thresholds.
        $text = strtolower(json_encode(abs($value), JSON_THROW_ON_ERROR));
        [$mantissa, $exponent] = array_pad(explode('e', $text), 2, '0');
        [$whole, $fraction] = array_pad(explode('.', $mantissa), 2, '');
        $digits = $whole . $fraction;
        $point = strlen($whole) + (int) $exponent;
        $stripped = ltrim($digits, '0');
        $point -= strlen($digits) - strlen($stripped);
        $digits = rtrim($stripped, '0');
        $size = strlen($digits);
        if ($point >= $size && $point <= 21) {
            $result = $digits . str_repeat('0', $point - $size);
        } elseif ($point > 0 && $point <= 21) {
            $result = substr($digits, 0, $point) . '.' . substr($digits, $point);
        } elseif ($point > -6 && $point <= 0) {
            $result = '0.' . str_repeat('0', -$point) . $digits;
        } else {
            $result = $digits[0] . ($size > 1 ? '.' . substr($digits, 1) : '') . 'e'
                . ($point - 1 >= 0 ? '+' : '-') . abs($point - 1);
        }
        return ($value < 0 ? '-' : '') . $result;
    }

    public static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4)
            . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }

    /** A new ID like the API's: `$prefix`, `_` and 20 random base62 characters. */
    public static function id(string $prefix): string
    {
        $alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        $body = '';
        while (strlen($body) < 20) {
            foreach (str_split(random_bytes(40)) as $byte) {
                $value = ord($byte);
                // Bytes 248-255 are redrawn, so every character is equally likely.
                if ($value >= 248) {
                    continue;
                }
                $body .= $alphabet[$value % 62];
                if (strlen($body) === 20) {
                    break;
                }
            }
        }
        return $prefix . '_' . $body;
    }

    public static function canonical(mixed $value): mixed
    {
        if (is_array($value)) {
            if (!array_is_list($value)) {
                ksort($value);
            }
            return array_map(self::canonical(...), $value);
        }
        return $value;
    }
}
