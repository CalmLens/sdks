<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;
use CalmLens\Model\Event;
use CalmLens\Model\EventCollection;

/**
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
     * } $params
     * @param RequestOptions $requestOptions
     * @return EventCollection
     */
    public function list(array $params = [], array $requestOptions = []): EventCollection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
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
        return $this->collection(EventCollection::class, null, $this->session->request('GET', $this->session->project('events'), query: $api, options: $request), fn (array $next) => $this->list($next, $requestOptions), $params);
    }

    /**
     * Yields pages from `cursor` until `hasMore` is false; save each page's `nextCursor` to resume.
     *
     * @param array{cursor?: string, pageSize?: int, types?: list<EventType>, assetId?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, EventCollection>
     */
    public function eachPage(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingPages();
    }

    /**
     * Yields every event from `cursor` until `hasMore` is false.
     *
     * @param array{cursor?: string, pageSize?: int, types?: list<EventType>, assetId?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, Event>
     */
    public function each(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingIterator();
    }
}
