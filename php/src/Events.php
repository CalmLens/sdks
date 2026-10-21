<?php

declare(strict_types=1);

namespace CalmLens;

final class Events extends Resource
{
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('GET', $this->session->project('events'), query: $api, options: $request);
    }
    public function eachPage(array $options = []): \Generator
    {
        yield from $this->pages($this->list(...), $options, 'events', 'cursor', 'after');
    }
    public function each(array $options = []): \Generator
    {
        foreach ($this->eachPage($options) as $page) {
            yield from $page['events'];
        }
    }
}
