<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * Hash lists hold PDQ hashes of images the project never wants again. Image uploads are compared
 * with every list: `flag` lists record matches, `block` lists also block close ones.
 *
 * @phpstan-import-type HashList from Types
 * @phpstan-import-type HashListEntry from Types
 * @phpstan-import-type HashListEntryPage from Types
 * @phpstan-import-type HashListPage from Types
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
     * @param array{
     *     cursor?: string, pageSize?: int, sort?: string, requestOptions?: RequestOptions,
     * } $options
     * @return HashListPage
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $page = $this->session->request('GET', $this->session->project('hash-lists'), query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !array_is_list($page['items']) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid hash list page');
        }
        return $page;
    }

    /** Yields every hash list, fetching pages as needed. */
    public function each(array $options = []): \Generator
    {
        yield from $this->items($this->list(...), $options);
    }

    /**
     * @param array{hashListId: string, requestOptions?: RequestOptions} $options
     * @return HashList
     */
    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->path($api, 'hash-lists', 'hashListId'), options: $request);
    }

    /**
     * Creates a list from `name`, `action` (`flag` or `block`) and an optional `description`.
     *
     * @param array{
     *     name: string, description?: ?string, action: 'flag'|'block', requestOptions?: RequestOptions,
     * } $options
     * @return HashList
     */
    public function create(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('POST', $this->session->project('hash-lists'), body: (object) $api, options: $request);
    }

    /**
     * Renames a list or changes its action; the new action applies to later uploads. A null `description` clears it.
     *
     * @param array{
     *     hashListId: string, name?: string, description?: ?string, action?: 'flag'|'block',
     *     requestOptions?: RequestOptions,
     * } $options
     * @return HashList
     */
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }

    /**
     * Deletes the list and every entry in it.
     *
     * @param array{hashListId: string, requestOptions?: RequestOptions} $options
     */
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $this->session->request('DELETE', $this->path($api, 'hash-lists', 'hashListId'), options: $request);
    }

    /**
     * One page of a list's entries, newest first unless `sort` says otherwise; pass `cursor` and `pageSize` to page.
     *
     * @param array{
     *     hashListId: string, cursor?: string, pageSize?: int, sort?: string, requestOptions?: RequestOptions,
     * } $options
     * @return HashListEntryPage
     */
    public function listEntries(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        $page = $this->session->request('GET', $path . '/entries', query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid hash list entry page');
        }
        return $page;
    }

    /** Yields every entry of the list `hashListId`, fetching pages as needed. */
    public function eachEntry(array $options): \Generator
    {
        yield from $this->items($this->listEntries(...), $options);
    }

    /**
     * Adds a `hash` (with an optional `quality`), or the hash of the image asset `assetId`, with an
     * optional `label`. A hash the list already holds returns its existing entry.
     *
     * @param array{
     *     hashListId: string, hash?: string, quality?: ?int, assetId?: string, label?: ?string,
     *     requestOptions?: RequestOptions,
     * } $options
     * @return HashListEntry
     */
    public function addEntry(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        return $this->session->request('POST', $path . '/entries', body: (object) $api, options: $request);
    }

    /**
     * Removes a hash from its list; later uploads no longer match it.
     *
     * @param array{entryId: string, requestOptions?: RequestOptions} $options
     */
    public function removeEntry(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $this->session->request('DELETE', $this->path($api, 'hash-list-entries', 'entryId'), options: $request);
    }
}
