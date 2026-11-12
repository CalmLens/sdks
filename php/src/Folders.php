<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

/**
 * @phpstan-import-type Folder from Types
 * @phpstan-import-type FolderPage from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class Folders extends Resource
{
    protected const OPERATIONS = 'folders';

    /**
     * One page of child folders (the project root without `parentId`), optionally matching a name
     * `search`. Pass the page's `nextCursor` as `cursor` for the next page; `pageSize` is 1 to 100
     * (50 by default) and `sort` is `name` (the default) or `createdAt`, descending when prefixed
     * with `-`.
     *
     * @param array{
     *     parentId?: string, cursor?: string, pageSize?: int, sort?: string, search?: string,
     *     requestOptions?: RequestOptions,
     * } $options
     * @return FolderPage
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $page = $this->session->request('GET', $this->session->project('folders'), query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !is_array($page['ancestors'] ?? []) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid folder page');
        }
        return $page;
    }

    /** Yields every child folder `list` would, fetching pages as needed. */
    public function each(array $options = []): \Generator
    {
        yield from $this->items($this->list(...), $options);
    }

    /**
     * @param array{name: string, parentId?: ?string, requestOptions?: RequestOptions} $options
     * @return Folder
     */
    public function create(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('POST', $this->session->project('folders'), body: (object) $api, options: $request);
    }
    /**
     * @param array{folderId: string, requestOptions?: RequestOptions} $options
     * @return Folder
     */
    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->path($api, 'folders', 'folderId'), options: $request);
    }
    /**
     * @param array{folderId: string, name?: string, requestOptions?: RequestOptions} $options
     * @return Folder
     */
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'folders', 'folderId');
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }
    /**
     * @param array{folderId: string, parentId: ?string, requestOptions?: RequestOptions} $options
     * @return Folder
     */
    public function move(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'folders', 'folderId');
        if (!array_key_exists('parentId', $api)) {
            Values::invalid('parentId is required (null moves to root)');
        }
        return $this->session->request('POST', $path . '/move', body: ['parentId' => $api['parentId']], options: $request);
    }
    /**
     * @param array{folderId: string, requestOptions?: RequestOptions} $options
     */
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $this->session->request('DELETE', $this->path($api, 'folders', 'folderId'), options: $request);
    }
}
