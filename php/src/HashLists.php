<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Model\HashList;
use CalmLens\Model\HashListEntry;

/**
 * Hash lists hold PDQ hashes of images the project never wants again. Image uploads are compared
 * with every list: `flag` lists record matches, `block` lists also block close ones.
 *
 * @phpstan-import-type RequestOptions from Types
 */
final class HashLists extends Resource
{
    protected const OPERATIONS = 'hashLists';

    /**
     * One page of the project's hash lists, newest first unless `sort` (`createdAt` and `id`,
     * descending when prefixed with `-`) says otherwise. Pass the page's `nextCursor` as `cursor`
     * and a `pageSize` (1 to 100, 50 by default).
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return Collection<HashList>
     */
    public function list(array $params = [], array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $page = $this->session->request('GET', $this->session->project('hash-lists'), query: $api, options: $request);
        return self::collection(Collection::class, HashList::class, $page, fn (array $next) => $this->list($next, $requestOptions), $params);
    }

    /**
     * Yields every hash list, fetching pages as needed.
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, HashList>
     */
    public function each(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingIterator();
    }

    /**
     * @param array{hashListId: string} $params
     * @param RequestOptions $requestOptions
     * @return HashList
     */
    public function retrieve(array $params, array $requestOptions = []): HashList
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return self::model(HashList::class, $this->session->request('GET', $this->path($api, 'hash-lists', 'hashListId'), options: $request));
    }

    /**
     * Creates a list from `name`, `action` (`flag` or `block`) and an optional `description`.
     *
     * @param array{name: string, description?: ?string, action: 'flag'|'block'} $params
     * @param RequestOptions $requestOptions
     * @return HashList
     */
    public function create(array $params, array $requestOptions = []): HashList
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return self::model(HashList::class, $this->session->request('POST', $this->session->project('hash-lists'), body: (object) $api, options: $request));
    }

    /**
     * Renames a list or changes its action; the new action applies to later uploads. A null `description` clears it.
     *
     * @param array{
     *     hashListId: string, name?: string, description?: ?string, action?: 'flag'|'block',
     * } $params
     * @param RequestOptions $requestOptions
     * @return HashList
     */
    public function update(array $params, array $requestOptions = []): HashList
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        return self::model(HashList::class, $this->session->request('PATCH', $path, body: (object) $api, options: $request));
    }

    /**
     * Deletes the list and every entry in it.
     *
     * @param array{hashListId: string} $params
     * @param RequestOptions $requestOptions
     */
    public function delete(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $this->session->request('DELETE', $this->path($api, 'hash-lists', 'hashListId'), options: $request);
    }

    /**
     * One page of a list's entries, newest first unless `sort` says otherwise; pass `cursor` and `pageSize` to page.
     *
     * @param array{hashListId: string, cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return Collection<HashListEntry>
     */
    public function listEntries(array $params, array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        $page = $this->session->request('GET', $path . '/entries', query: $api, options: $request);
        return self::collection(Collection::class, HashListEntry::class, $page, fn (array $next) => $this->listEntries($next, $requestOptions), $params);
    }

    /**
     * Yields every entry of the list `hashListId`, fetching pages as needed.
     *
     * @param array{hashListId: string, cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, HashListEntry>
     */
    public function eachEntry(array $params, array $requestOptions = []): \Generator
    {
        yield from $this->listEntries($params, $requestOptions)->autoPagingIterator();
    }

    /**
     * Adds a `hash` (with an optional `quality`), or the hash of the image asset `assetId`, with an
     * optional `label`. A hash the list already holds returns its existing entry.
     *
     * @param array{
     *     hashListId: string, hash?: string, quality?: ?int, assetId?: string, label?: ?string,
     * } $params
     * @param RequestOptions $requestOptions
     * @return HashListEntry
     */
    public function addEntry(array $params, array $requestOptions = []): HashListEntry
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        return self::model(HashListEntry::class, $this->session->request('POST', $path . '/entries', body: (object) $api, options: $request));
    }

    /**
     * Removes a hash from its list; later uploads no longer match it.
     *
     * @param array{entryId: string} $params
     * @param RequestOptions $requestOptions
     */
    public function removeEntry(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $this->session->request('DELETE', $this->path($api, 'hash-list-entries', 'entryId'), options: $request);
    }
}
