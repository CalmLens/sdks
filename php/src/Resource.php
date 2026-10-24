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

    protected function split(array $options): array
    {
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
     * Pages through a list. Asset pages stop without a next cursor, when `hasMore` is false or at
     * an empty page; event pages when `hasMore` is false. A page with more to follow that hands
     * back a cursor already sent fails with `sdk/invalid-response` (`details.cursor`) rather than
     * loop, and is not yielded.
     */
    protected function pages(callable $fetch, array $options, string $items = 'items', string $cursor = 'nextCursor', string $parameter = 'cursor'): \Generator
    {
        $events = $items === 'events';
        $seen = [];
        if ($events && isset($options[$parameter])) {
            $seen[$options[$parameter]] = true;
        }
        do {
            $page = $fetch($options);
            if (!is_array($page) || !is_array($page[$items] ?? null) || !is_bool($page['hasMore'] ?? null)) {
                throw CalmLensException::create('sdk/invalid-response', 'Invalid page');
            }
            $next = $page[$cursor] ?? null;
            $more = $page['hasMore'] && ($events || (is_string($next) && $next !== '' && $page[$items] !== []));
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
            $options[$parameter] = $next;
        } while (true);
    }
}
