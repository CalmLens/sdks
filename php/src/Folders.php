<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

final class Folders extends Resource
{
    /**
     * One page of child folders (the project root without `parentId`), a name search, or the paths
     * of `ids`. Pass the page's `nextCursor` as `cursor` for the next page; `pageSize` is 1 to 100
     * (100 by default) and `ordering` one `name` (the default) or `createdAt` clause.
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options);
        $page = $this->session->request('GET', $this->session->project('folders'), query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !is_array($page['ancestors'] ?? null) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid folder page');
        }
        return $page;
    }
    public function create(array $options): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('POST', $this->session->project('folders'), body: (object) $api, options: $request);
    }
    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('GET', $this->path($api, 'folders', 'folderId'), options: $request);
    }
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'folders', 'folderId');
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }
    public function move(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'folders', 'folderId');
        if (!array_key_exists('parentId', $api)) {
            Values::invalid('parentId is required (null moves to root)');
        }
        return $this->session->request('POST', $path . '/move', body: ['parentId' => $api['parentId']], options: $request);
    }
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options);
        $this->session->request('DELETE', $this->path($api, 'folders', 'folderId'), options: $request);
    }
}
