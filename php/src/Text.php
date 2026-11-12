<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;
use CalmLens\Model\Asset;

final class Text
{
    public function __construct(private Assets $assets) {}
    /**
     * Moderates `text` and waits for the decision, as `assets->classify` does with plain-text
     * content. `name` defaults to `text`; the other params are `assets->classify`'s.
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     */
    public function classify(array $params, array $requestOptions = []): Asset
    {
        $options = $params;
        Values::knownOptions($options, 'text.classify');
        $text = $options['text'] ?? null;
        if (!is_string($text) || trim($text) === '') {
            Values::invalid('Text must be a non-empty string');
        }
        unset($options['text']);
        $options['name'] ??= 'text';
        $options['content'] = ['plainText' => $text, 'type' => 'text/plain'];
        return $this->assets->classify($options, $requestOptions);
    }
}
