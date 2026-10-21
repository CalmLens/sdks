<?php

declare(strict_types=1);

namespace CalmLens\Internal;

/** @internal */
final class Transforms
{
    public static function selector(mixed $value): ?string
    {
        if ($value === null || is_string($value)) {
            return $value;
        }
        if (!is_array($value) || $value === []) {
            Values::invalid('Transform needs at least one step');
        }
        $steps = array_is_list($value) ? $value : [$value];
        return implode(',', array_map(function ($step): string {
            if (!is_array($step) || !is_string($step['type'] ?? null) || !preg_match('/^[A-Za-z0-9_]+$/D', $step['type'])) {
                Values::invalid('Invalid transform type');
            }
            $options = $step['options'] ?? [];
            if ($options instanceof \stdClass) {
                $options = (array) $options;
            }
            if (!is_array($options) || ($options !== [] && array_is_list($options))) {
                Values::invalid('Transform options must be an object');
            }
            $pairs = [];
            self::append($pairs, '', $options);
            return $step['type'] . '[' . implode(',', $pairs) . ']';
        }, $steps));
    }

    private static function append(array &$pairs, string $prefix, array $options): void
    {
        ksort($options, SORT_STRING);
        foreach ($options as $key => $value) {
            $name = $prefix === '' ? (string) $key : $prefix . '[' . $key . ']';
            if ($value === null) {
                continue;
            }
            if ($value instanceof \stdClass) {
                $value = (array) $value;
                if ($value === []) {
                    continue;
                }
            }
            if (is_array($value)) {
                if (array_is_list($value)) {
                    Values::invalid('Transform option arrays are not supported');
                }
                self::append($pairs, $name, $value);
            } else {
                $pairs[] = rawurlencode($name) . '=' . rawurlencode(Values::scalar($value));
            }
        }
    }

    public static function path(mixed $value): string
    {
        if (!is_string($value)) {
            return self::selector($value) ?? '';
        }
        $value = ltrim($value, '/');
        if (str_contains($value, '..') || strpbrk($value, '?#') !== false) {
            Values::invalid('Unsafe transform path');
        }
        return preg_replace_callback("/[^A-Za-z0-9\-_.!~*'();\/:@&=+$,\[\]]/", fn ($m) => rawurlencode($m[0]), $value);
    }
}
