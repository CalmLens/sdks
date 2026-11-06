<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Session;
use CalmLens\Internal\Values;

/** @internal */
abstract class Resource
{
    public function __construct(protected Session $session) {}
    public function __debugInfo(): array { return ['projectId' => $this->session->projectId]; }

    /** The prefix of this resource's operations in Internal\OptionKeys. */
    protected const OPERATIONS = '';

    /**
     * Splits options from `requestOptions`. `$method` names the public method, whose options are
     * checked against the keys it takes: an unknown key fails with `sdk/invalid-argument`. An
     * option given as null is left out, as if omitted, unless the method sends it as null (such as
     * `description`, which null clears).
     */
    protected function split(array $options, string $method): array
    {
        Values::knownOptions($options, static::OPERATIONS . '.' . $method);
        $options = Values::withoutNulls($options, static::OPERATIONS . '.' . $method);
        $request = $options['requestOptions'] ?? [];
        if (!is_array($request)) {
            Values::invalid('requestOptions must be an array');
        }
        unset($options['requestOptions']);
        return [$options, $request];
    }

    protected function path(array &$options, string $resource, string $key): string
    {
        $id = Values::segment($options[$key] ?? null);
        unset($options[$key]);
        return '/' . $resource . '/' . $id;
    }

    /**
     * Pages through a list by following `nextCursor` as `cursor`, keeping the other options. Cursor
     * lists stop without a next cursor, when `hasMore` is false or at an empty page; event pages
     * (`$events`) when `hasMore` is false. A page with more to follow that hands back a cursor already sent fails with
     * `sdk/invalid-response` (`details.cursor`) rather than loop, and is not yielded.
     */
    protected function pages(callable $fetch, array $options, bool $events = false): \Generator
    {
        $seen = [];
        if ($events && isset($options['cursor'])) {
            $seen[$options['cursor']] = true;
        }
        do {
            $page = $fetch($options);
            if (!is_array($page) || !is_array($page['items'] ?? null) || !is_bool($page['hasMore'] ?? null)) {
                throw CalmLensException::create('sdk/invalid-response', 'Invalid page');
            }
            $next = $page['nextCursor'] ?? null;
            $more = $page['hasMore'] && ($events || (is_string($next) && $next !== '' && $page['items'] !== []));
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
            if (!$more) {
                return;
            }
            $options['cursor'] = $next;
        } while (true);
    }

    /** Yields every item of a cursor list, fetching its pages with `$fetch` as needed. */
    protected function items(callable $fetch, array $options): \Generator
    {
        foreach ($this->pages($fetch, $options) as $page) {
            yield from $page['items'];
        }
    }
}
