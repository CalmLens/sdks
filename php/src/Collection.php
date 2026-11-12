<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * One page of a list: its `items`, and `nextCursor` to pass as `cursor` for the next page while
 * `hasMore` is true. Iterating the page, and `count()`, cover this page's items;
 * `autoPagingIterator()` yields every item from here on, fetching later pages with the same
 * params as needed.
 *
 * @template TItem
 * @property-read list<TItem> $items
 * @property-read null|string $nextCursor
 * @property-read bool $hasMore
 */
class Collection extends CalmLensObject
{
    /** Whether a page with more to follow may be empty or reuse no cursor, as event feed pages may. */
    protected const FEED = false;

    /** @var null|\Closure(array<string, mixed>): static */
    private ?\Closure $fetch = null;

    /** @var array<string, mixed> */
    private array $params = [];

    /**
     * A page whose items are `$itemClass` objects (or as the class's `FIELDS` say), and that fetches
     * the page after it with `$fetch`, given `$params` with the next `cursor`.
     *
     * @internal
     * @param array<array-key, mixed> $values
     * @param null|class-string<CalmLensObject> $itemClass
     * @param null|\Closure(array<string, mixed>): static $fetch
     * @param array<string, mixed> $params
     */
    public static function page(array $values, ?string $itemClass, ?\Closure $fetch = null, array $params = []): static
    {
        $page = new static();
        $page->fill($values, $itemClass === null ? static::FIELDS : ['items' => [$itemClass]] + static::FIELDS);
        $page->fetch = $fetch;
        $page->params = $params;
        return $page;
    }

    /** @return \Iterator<int, TItem> this page's items */
    public function getIterator(): \Iterator
    {
        return new \ArrayIterator($this->items ?? []);
    }

    /** The number of items on this page. */
    public function count(): int
    {
        return count($this->items ?? []);
    }

    public function isEmpty(): bool
    {
        return $this->count() === 0;
    }

    /**
     * Yields this page and each page after it, fetching them as needed. A list stops without a next
     * cursor, when `hasMore` is false or at an empty page; an event feed when `hasMore` is false. A
     * page with more to follow that hands back a cursor already sent fails with
     * `sdk/invalid-response` (`details.cursor`) rather than loop, and is not yielded.
     *
     * @return \Generator<int, static>
     */
    public function autoPagingPages(): \Generator
    {
        $seen = [];
        if (static::FEED && is_string($this->params['cursor'] ?? null)) {
            $seen[$this->params['cursor']] = true;
        }
        $page = $this;
        do {
            $next = $page->nextCursor;
            $more = $page->hasMore === true && (static::FEED || (is_string($next) && $next !== '' && !$page->isEmpty()));
            if ($more) {
                if (!is_string($next) || $next === '') {
                    throw CalmLensException::create('sdk/invalid-response', 'A page with more to follow has no cursor');
                }
                if (isset($seen[$next])) {
                    throw CalmLensException::create('sdk/invalid-response', 'The API returned a cursor it had already returned, with more pages to follow',
                        details: ['cursor' => $next]);
                }
                $seen[$next] = true;
            }
            yield $page;
            if (!$more || $page->fetch === null) {
                return;
            }
            $params = $page->params;
            $params['cursor'] = $next;
            $page = ($page->fetch)($params);
        } while (true);
    }

    /**
     * Yields every item from this page on, fetching the pages after it as needed.
     *
     * @return \Generator<int, TItem>
     */
    public function autoPagingIterator(): \Generator
    {
        foreach ($this->autoPagingPages() as $page) {
            yield from $page->items ?? [];
        }
    }
}
