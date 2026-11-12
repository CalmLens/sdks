<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

/**
 * @phpstan-import-type EventPage from Types
 * @phpstan-import-type EventType from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class Events extends Resource
{
    protected const OPERATIONS = 'events';

    /**
     * One page of events after `cursor` (a previous page's `nextCursor`), oldest first, with
     * `pageSize` 1 to 100 (50 by default). Without `cursor` the page is empty and its `nextCursor`
     * is now. `excludedTypes` lists the event types the feed never includes, because the API key
     * lacks the permission to see them. `types` (a list of event types, such as `asset.blocked`)
     * and `assetId` narrow the feed to those types or one asset's events; a cursor belongs to the
     * filters it was issued with, so pass the same ones with each `cursor`.
     *
     * @param array{
     *     cursor?: string, pageSize?: int, types?: list<EventType>, assetId?: string,
     *     requestOptions?: RequestOptions,
     * } $options
     * @return EventPage
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        if (array_key_exists('types', $api)) {
            $types = $api['types'];
            if (!is_array($types) || !array_is_list($types)) {
                Values::invalid('types must be a list of event types');
            }
            foreach ($types as $type) {
                if (!is_string($type) || $type === '' || str_contains($type, ',')) {
                    Values::invalid('Every event type must be a non-empty string without commas');
                }
            }
            // The API takes the types as one comma-separated value.
            $api['types'] = $types === [] ? null : implode(',', $types);
        }
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
