<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

final class Text
{
    public function __construct(private Assets $assets) {}
    public function classify(array $options): array
    {
        $text = $options['text'] ?? null;
        if (!is_string($text) || trim($text) === '') {
            Values::invalid('Text must be a non-empty string', 'upload/invalid-payload');
        }
        unset($options['text']);
        $options['name'] ??= 'text';
        $options['content'] = ['plainText' => $text, 'type' => 'text/plain'];
        return $this->assets->classify($options);
    }
}
