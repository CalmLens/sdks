<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;
use CalmLens\Model\Folder;
use CalmLens\Model\FolderCollection;

/**
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
     * } $params
     * @param RequestOptions $requestOptions
     * @return FolderCollection
     */
    public function list(array $params = [], array $requestOptions = []): FolderCollection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $page = $this->session->request('GET', $this->session->project('folders'), query: $api, options: $request);
        return $this->collection(FolderCollection::class, null, $page, fn (array $next) => $this->list($next, $requestOptions), $params);
    }

    /**
     * Yields every child folder `list` would, fetching pages as needed.
     *
     * @param array{
     *     parentId?: string, cursor?: string, pageSize?: int, sort?: string, search?: string,
     * } $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, Folder>
     */
    public function each(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingIterator();
    }

    /**
     * @param array{name: string, parentId?: ?string} $params
     * @param RequestOptions $requestOptions
     * @return Folder
     */
    public function create(array $params, array $requestOptions = []): Folder
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Folder::class, $this->session->request('POST', $this->session->project('folders'), body: (object) $api, options: $request));
    }
    /**
     * @param array{folderId: string} $params
     * @param RequestOptions $requestOptions
     * @return Folder
     */
    public function retrieve(array $params, array $requestOptions = []): Folder
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Folder::class, $this->session->request('GET', $this->path($api, 'folders', 'folderId'), options: $request));
    }
    /**
     * @param array{folderId: string, name?: string} $params
     * @param RequestOptions $requestOptions
     * @return Folder
     */
    public function update(array $params, array $requestOptions = []): Folder
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'folders', 'folderId');
        return $this->model(Folder::class, $this->session->request('PATCH', $path, body: (object) $api, options: $request));
    }
    /**
     * @param array{folderId: string, parentId: ?string} $params
     * @param RequestOptions $requestOptions
     * @return Folder
     */
    public function move(array $params, array $requestOptions = []): Folder
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'folders', 'folderId');
        if (!array_key_exists('parentId', $api)) {
            Values::invalid('parentId is required (null moves to root)');
        }
        return $this->model(Folder::class, $this->session->request('POST', $path . '/move', body: ['parentId' => $api['parentId']], options: $request));
    }
    /**
     * @param array{folderId: string} $params
     * @param RequestOptions $requestOptions
     */
    public function delete(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $this->session->request('DELETE', $this->path($api, 'folders', 'folderId'), options: $request);
    }
}
