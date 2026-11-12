<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * The project's upload presets: the rules for uploads from browsers and apps. `ensure` creates or
 * replaces presets by `key`, for deploys that declare them in code; send each preset's `revision`
 * (0 for one that must not exist yet) to refuse a change made since you read it.
 *
 * @phpstan-import-type EnsuredUploadPresets from Types
 * @phpstan-import-type ProcessingOptions from Types
 * @phpstan-import-type RequestOptions from Types
 * @phpstan-import-type UploadPresetPage from Types
 */
final class UploadPresets extends Resource
{
    protected const OPERATIONS = 'uploadPresets';

    /**
     * One page of the project's upload presets, oldest first unless `sort` (`createdAt` and `id`,
     * descending when prefixed with `-`) says otherwise. Pass the page's `nextCursor` as `cursor`
     * and a `pageSize` (1 to 100, 50 by default).
     *
     * @param array{
     *     cursor?: string, pageSize?: int, sort?: string, requestOptions?: RequestOptions,
     * } $options
     * @return UploadPresetPage
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $page = $this->session->request('GET', $this->session->project('upload-presets'), query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !array_is_list($page['items']) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid upload preset page');
        }
        return $page;
    }

    /** Yields every upload preset of the project, fetching pages as needed. */
    public function each(array $options = []): \Generator
    {
        yield from $this->items($this->list(...), $options);
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
     *         policyId?: ?string, visibility?: 'public'|'private', processingOptions?: ?ProcessingOptions,
     *         revealDecision?: bool, dailyUploadLimit?: ?int, allowedOrigins?: list<string>|null,
     *     }>,
     *     requestOptions?: RequestOptions,
     * } $options
     * @return EnsuredUploadPresets
     */
    public function ensure(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('PUT', $this->session->project('upload-presets'), body: (object) $api, options: $request);
    }

    /**
     * Deletes an upload preset (`uploadPresetId`); assets already uploaded through it stay.
     *
     * @param array{uploadPresetId: string, requestOptions?: RequestOptions} $options
     */
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $this->session->request('DELETE', $this->path($api, 'upload-presets', 'uploadPresetId'), options: $request);
    }
}
