<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use CalmLens\CalmLensException;

/** @internal */
final class Values
{
    public static function invalid(string $message, string $code = 'sdk/invalid-argument'): never
    {
        throw new CalmLensException($code, $message);
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
            $append((string) $key, in_array($key, ['metadata', 'processingOptions'], true) && $value !== null ? self::json($value) : $value);
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
