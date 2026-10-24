<?php

declare(strict_types=1);

namespace CalmLens\Internal;

/** @internal */
final class Transforms
{
    private const OPTION_NAME = '/^[a-z][a-zA-Z0-9]*$/D';
    // Options that hold colours, written as hex without `#` in a selector.
    private const COLOUR_KEYS = ['background', 'border.color', 'trim.border.color'];
    private const HEX_COLOUR = '/^#((?:[0-9a-f]{3}){1,2}|(?:[0-9a-f]{4}){1,2})$/iD';

    /**
     * Serializes structured transforms as a CDN selector, one path segment per step, such as
     * `fit=cover,width=640/format=webp`. Option keys are sorted so equal transforms share a URL,
     * nested keys are dotted (`border.color`), hex colours are written without `#` and values are
     * percent-encoded. A selector string is returned unchanged.
     */
    public static function selector(mixed $value): ?string
    {
        if ($value === null || is_string($value)) {
            return $value;
        }
        if (!is_array($value) || $value === []) {
            Values::invalid('Transform needs at least one step');
        }
        $steps = array_is_list($value) ? $value : [$value];
        return implode('/', array_map(function ($step): string {
            if (!is_array($step) || ($step['type'] ?? null) !== 'imageTransform') {
                Values::invalid('Transform type must be "imageTransform"');
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
            if ($pairs === []) {
                Values::invalid('Transform steps need at least one option');
            }
            return implode(',', $pairs);
        }, $steps));
    }

    private static function append(array &$pairs, string $prefix, array $options): void
    {
        foreach (array_keys($options) as $key) {
            if (!preg_match(self::OPTION_NAME, (string) $key)) {
                Values::invalid('Transform option "' . $prefix . $key . '" is not a valid name');
            }
        }
        ksort($options, SORT_STRING);
        foreach ($options as $key => $value) {
            $name = $prefix . $key;
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
                self::append($pairs, $name . '.', $value);
                continue;
            }
            $text = Values::scalar($value);
            if (is_string($value) && in_array($name, self::COLOUR_KEYS, true) && preg_match(self::HEX_COLOUR, $value, $match)) {
                $text = strtolower($match[1]);
            }
            $pairs[] = $name . '=' . rawurlencode($text);
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
        // Like JavaScript's encodeURI.
        return preg_replace_callback("/[^A-Za-z0-9\-_.!~*'();\/:@&=+$,]/", fn ($m) => rawurlencode($m[0]), $value);
    }
}
