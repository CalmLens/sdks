<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * The project's lenses: named image transforms the CDN applies at `/@<identifier>`. The CDN serves
 * files made with each lens's current definition. `ServerClient::ensureLenses` creates or changes
 * lenses by identifier, for applications that declare theirs in code.
 */
final class Lenses extends Resource
{
    protected const OPERATIONS = 'lenses';

    /**
     * One page of the project's lenses, newest first unless `sort` (`createdAt` and `id`,
     * descending when prefixed with `-`) says otherwise. Pass the page's `nextCursor` as `cursor`
     * and a `pageSize` (1 to 100, 50 by default). The built-in lenses are always available and
     * aren't listed.
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $page = $this->session->request('GET', $this->session->project('lenses'), query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !array_is_list($page['items']) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid lens page');
        }
        return $page;
    }

    /** Yields every lens of the project, fetching pages as needed. */
    public function each(array $options = []): \Generator
    {
        yield from $this->items($this->list(...), $options);
    }

    /**
     * Creates a lens from `identifier`, `name`, `type`, `active` and an optional `description` and
     * `transform`. The identifier must be new to the project (`lens/identifier-taken` otherwise).
     */
    public function create(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $lens = $this->session->request('POST', $this->session->project('lenses'), body: (object) $api, options: $request);
        $this->forget(fn (array $cached) => ($cached['identifier'] ?? null) === ($lens['identifier'] ?? null));
        return $lens;
    }

    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->path($api, 'lenses', 'lensId'), options: $request);
    }

    /**
     * Changes a lens's `name`, `description`, `type`, `transform` or whether the CDN serves it
     * (`active`). The CDN serves the new transform from then on.
     */
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'lenses', 'lensId');
        $lens = $this->session->request('PATCH', $path, body: (object) $api, options: $request);
        $this->forget(fn (array $cached) => ($cached['id'] ?? null) === ($lens['id'] ?? null));
        return $lens;
    }

    /**
     * Deletes a lens. URLs that select it stop being served; files the CDN already delivered may
     * stay in caches until they expire.
     */
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $lensId = $api['lensId'] ?? null;
        $this->session->request('DELETE', $this->path($api, 'lenses', 'lensId'), options: $request);
        $this->forget(fn (array $cached) => ($cached['id'] ?? null) === $lensId);
    }

    /** A lens changed here no longer has the definition `ensureLens` cached for it. */
    private function forget(callable $matches): void
    {
        $this->session->ensuredLenses = array_filter($this->session->ensuredLenses, fn (array $lens) => !$matches($lens));
    }
}
