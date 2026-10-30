<?php

declare(strict_types=1);

namespace CalmLens;

final class Events extends Resource
{
    /**
     * One page of events after `cursor` (a previous page's `nextCursor`), oldest first, with
     * `pageSize` 1 to 100 (50 by default). Without `cursor` the page is empty and its `nextCursor`
     * is now.
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('GET', $this->session->project('events'), query: $api, options: $request);
    }
    /** Yields pages from `cursor` until `hasMore` is false; save each page's `nextCursor` to resume. */
    public function eachPage(array $options = []): \Generator
    {
        yield from $this->pages($this->list(...), $options, events: true);
    }
    public function each(array $options = []): \Generator
    {
        foreach ($this->eachPage($options) as $page) {
            yield from $page['items'];
        }
    }
}
