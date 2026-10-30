<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * Hash lists hold PDQ hashes of images the project never wants again. Image uploads are compared
 * with every list: `flag` lists record matches, `block` lists also block close ones.
 */
final class HashLists extends Resource
{
    /** One page of the project's hash lists; pass the page's `nextCursor` as `cursor` and a `pageSize` (1 to 100, 10 by default). */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options);
        $page = $this->session->request('GET', $this->session->project('hash-lists'), query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !array_is_list($page['items']) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid hash list page');
        }
        return $page;
    }

    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('GET', $this->path($api, 'hash-lists', 'hashListId'), options: $request);
    }

    /** Creates a list from `name`, `action` (`flag` or `block`) and an optional `description`. */
    public function create(array $options): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('POST', $this->session->project('hash-lists'), body: (object) $api, options: $request);
    }

    /** Renames a list or changes its action; the new action applies to later uploads. A null `description` clears it. */
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }

    /** Deletes the list and every entry in it. */
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options);
        $this->session->request('DELETE', $this->path($api, 'hash-lists', 'hashListId'), options: $request);
    }

    /** One page of a list's entries, newest first; pass `cursor` and `pageSize` to page. */
    public function listEntries(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        $page = $this->session->request('GET', $path . '/entries', query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid hash list entry page');
        }
        return $page;
    }

    /**
     * Adds a `hash` (with an optional `quality`), or the hash of the image asset `assetId`, with an
     * optional `label`. A hash the list already holds returns its existing entry.
     */
    public function addEntry(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'hash-lists', 'hashListId');
        return $this->session->request('POST', $path . '/entries', body: (object) $api, options: $request);
    }

    /** Removes a hash from its list; later uploads no longer match it. */
    public function removeEntry(array $options): void
    {
        [$api, $request] = $this->split($options);
        $this->session->request('DELETE', $this->path($api, 'hash-list-entries', 'entryId'), options: $request);
    }
}
