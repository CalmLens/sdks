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

    protected function pages(callable $fetch, array $options, string $items = 'items', string $cursor = 'nextCursor', string $parameter = 'cursor'): \Generator
    {
        $seen = [];
        if (isset($options[$parameter])) {
            $seen[$options[$parameter]] = true;
        }
        do {
            $page = $fetch($options);
            if (!is_array($page) || !is_array($page[$items] ?? null) || !is_bool($page['hasMore'] ?? null)) {
                throw CalmLensException::create('sdk/invalid-response', 'Invalid page');
            }
            yield $page;
            if (!$page['hasMore']) {
                return;
            }
            $next = $page[$cursor] ?? null;
            if (!is_string($next) || $next === '' || isset($seen[$next])) {
                throw CalmLensException::create('sdk/invalid-response', 'Missing or repeated pagination cursor');
            }
            $seen[$next] = true;
            $options[$parameter] = $next;
        } while (true);
    }
}
