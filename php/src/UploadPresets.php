<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Model\EnsuredUploadPresets;
use CalmLens\Model\UploadPreset;

/**
 * The project's upload presets: the rules for uploads from browsers and apps. `ensure` creates or
 * replaces presets by `key`, for deploys that declare them in code; send each preset's `revision`
 * (0 for one that must not exist yet) to refuse a change made since you read it.
 *
 * @phpstan-import-type ProcessingOptionsParams from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class UploadPresets extends Resource
{
    protected const OPERATIONS = 'uploadPresets';

    /**
     * One page of the project's upload presets, oldest first unless `sort` (`createdAt` and `id`,
     * descending when prefixed with `-`) says otherwise. Pass the page's `nextCursor` as `cursor`
     * and a `pageSize` (1 to 100, 50 by default).
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return Collection<UploadPreset>
     */
    public function list(array $params = [], array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $page = $this->session->request('GET', $this->session->project('upload-presets'), query: $api, options: $request);
        return $this->collection(Collection::class, UploadPreset::class, $page, fn (array $next) => $this->list($next, $requestOptions), $params);
    }

    /**
     * Yields every upload preset of the project, fetching pages as needed.
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, UploadPreset>
     */
    public function each(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingIterator();
    }

    /**
     * Creates each preset in `uploadPresets`, or replaces it with the definition sent, by `key`.
     * Fields left out return to their defaults; an unchanged preset keeps its `revision`. Every
     * preset is checked before any is saved. Returns `['uploadPresets' => [...]]`, the stored
     * presets in the order sent.
     *
     * @param array{
     *     uploadPresets: list<array{
     *         key: string, revision?: int, name: string, access?: 'token'|'anyone', enabled?: bool,
     *         allowedContentTypes?: list<string>|null, maxSizeInBytes?: ?int, folderId?: ?string,
     *         policyId?: ?string, visibility?: 'public'|'private', processingOptions?: ?ProcessingOptionsParams,
     *         revealDecision?: bool, dailyUploadLimit?: ?int, allowedOrigins?: list<string>|null,
     *     }>,
     * } $params
     * @param RequestOptions $requestOptions
     * @return EnsuredUploadPresets
     */
    public function ensure(array $params, array $requestOptions = []): EnsuredUploadPresets
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(EnsuredUploadPresets::class, $this->session->request('PUT', $this->session->project('upload-presets'), body: (object) $api, options: $request));
    }

    /**
     * Deletes an upload preset (`uploadPresetId`); assets already uploaded through it stay.
     *
     * @param array{uploadPresetId: string} $params
     * @param RequestOptions $requestOptions
     */
    public function delete(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $this->session->request('DELETE', $this->path($api, 'upload-presets', 'uploadPresetId'), options: $request);
    }
}
