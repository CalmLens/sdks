<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Model\Lens;

/**
 * The project's lenses: named image transforms the CDN applies at `/@<identifier>`. The CDN serves
 * files made with each lens's current definition. `ServerClient::ensureLenses` creates or changes
 * lenses by identifier, for applications that declare theirs in code.
 *
 * @phpstan-import-type LensType from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class Lenses extends Resource
{
    protected const OPERATIONS = 'lenses';

    /**
     * One page of the project's lenses, newest first unless `sort` (`createdAt` and `id`,
     * descending when prefixed with `-`) says otherwise. Pass the page's `nextCursor` as `cursor`
     * and a `pageSize` (1 to 100, 50 by default). The built-in lenses are always available and
     * aren't listed.
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return Collection<Lens>
     */
    public function list(array $params = [], array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $page = $this->session->request('GET', $this->session->project('lenses'), query: $api, options: $request);
        return self::collection(Collection::class, Lens::class, $page, fn (array $next) => $this->list($next, $requestOptions), $params);
    }

    /**
     * Yields every lens of the project, fetching pages as needed.
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, Lens>
     */
    public function each(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingIterator();
    }

    /**
     * Creates a lens from `identifier`, `name`, `type` and an optional `description`, `transform`
     * and `active` (whether the CDN serves it, true by default). The identifier must be new to the project (`lens/identifier-taken` otherwise).
     *
     * @param array{
     *     identifier: string, name: string, description?: ?string, type: LensType, active?: bool,
     *     transform?: array<string, mixed>|null,
     * } $params
     * @param RequestOptions $requestOptions
     * @return Lens
     */
    public function create(array $params, array $requestOptions = []): Lens
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $lens = $this->session->request('POST', $this->session->project('lenses'), body: (object) $api, options: $request);
        $this->forget(fn (array $cached) => ($cached['identifier'] ?? null) === ($lens['identifier'] ?? null));
        return self::model(Lens::class, $lens);
    }

    /**
     * @param array{lensId: string} $params
     * @param RequestOptions $requestOptions
     * @return Lens
     */
    public function retrieve(array $params, array $requestOptions = []): Lens
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return self::model(Lens::class, $this->session->request('GET', $this->path($api, 'lenses', 'lensId'), options: $request));
    }

    /**
     * Changes a lens's `name`, `description`, `type`, `transform` or whether the CDN serves it
     * (`active`); fields left out stay as they are. The CDN serves the new transform from then on.
     *
     * @param array{
     *     lensId: string, name?: string, description?: ?string, type?: LensType, active?: bool,
     *     transform?: array<string, mixed>|null,
     * } $params
     * @param RequestOptions $requestOptions
     * @return Lens
     */
    public function update(array $params, array $requestOptions = []): Lens
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'lenses', 'lensId');
        $lens = $this->session->request('PATCH', $path, body: (object) $api, options: $request);
        $this->forget(fn (array $cached) => ($cached['id'] ?? null) === ($lens['id'] ?? null));
        return self::model(Lens::class, $lens);
    }

    /**
     * Deletes a lens. URLs that select it stop being served; files the CDN already delivered may
     * stay in caches until they expire.
     *
     * @param array{lensId: string} $params
     * @param RequestOptions $requestOptions
     */
    public function delete(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
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
