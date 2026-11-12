<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\Collection;

/**
 * One page of the event feed. `excludedTypes` lists the event types the API key can't see.
 *
 * @extends Collection<Event>
 *
 * @property-read list<Event> $items
 * @property-read string $nextCursor
 * @property-read bool $hasMore
 * @property-read list<Event::TYPE_*> $excludedTypes
 */
final class EventCollection extends Collection
{
    protected const FEED = true;

    protected const FIELDS = [
        'items' => [Event::class],
    ];
}
