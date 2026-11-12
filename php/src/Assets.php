<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\UploadBody;
use CalmLens\Internal\UploadForm;
use CalmLens\Internal\Values;
use CalmLens\Model\Asset;
use CalmLens\Model\AssetBatch;
use CalmLens\Model\AssetSearchResults;
use CalmLens\Model\TimelineSegment;
use GuzzleHttp\Psr7\LimitStream;
use Psr\Http\Message\StreamInterface;

/**
 * @phpstan-type CreateAssetOptions array{
 *     externalUrl?: ?string, name: string, description?: ?string, visibility?: 'public'|'private'|null,
 *     metadata?: list<array{id: string, value: MetadataValue}>|null, tags?: list<string>|null,
 *     externalId?: ?string, folderId?: ?string, authorId?: ?string, context?: ?AssetContextParams,
 *     uploadPresetId?: ?string,
 *     processingOptions?: array{
 *         retainContent?: bool|string|null, storeSensitiveMetadata?: bool|string|null,
 *         features?: array{
 *             ocr?: array{enabled: bool|string}|null, personDetection?: array{enabled: bool|string}|null,
 *             faceDetection?: array{enabled: bool|string, ageEstimation?: bool|string}|null,
 *             linkDetection?: array{enabled: bool|string}|null,
 *             streaming?: array{enabled: bool|string}|null,
 *         }|null,
 *     }|null,
 *     content?: UploadContent, part?: UploadPart, url?: string, sizeInBytes?: int, totalSizeInBytes?: int,
 * }
 *
 * @phpstan-import-type AssetContextParams from Types
 * @phpstan-import-type MetadataValue from Types
 * @phpstan-import-type RequestOptions from Types
 * @phpstan-import-type UploadContent from Types
 * @phpstan-import-type UploadPart from Types
 */
final class Assets extends Resource
{
    protected const OPERATIONS = 'assets';

    /** Seconds `waitForDecision` polls before `sdk/timeout`; 0 checks once. */
    public const DEFAULT_DECISION_TIMEOUT = 60;
    /** Seconds before `waitForDecision`'s second check; each later wait is 1.5 times longer, at most 2 seconds. */
    public const DECISION_FIRST_INTERVAL = 0.5;
    public const DECISION_INTERVAL_FACTOR = 1.5;
    public const DECISION_MAX_INTERVAL = 2;
    /** `batch` operation: deletes each asset with its child assets and stored content. */
    public const BATCH_DELETE = 'delete';
    /** `batch` operation: removes each asset's stored content and keeps the record. */
    public const BATCH_REMOVE_CONTENT = 'remove-content';
    /** The operations `batch` runs. */
    public const BATCH_OPERATIONS = [self::BATCH_DELETE, self::BATCH_REMOVE_CONTENT];
    /** The most assets one `batch` request takes. */
    public const MAX_BATCH_ASSETS = 500;
    /** The largest image, audio or video, and other file one request uploads, in bytes. */
    public const MAX_DIRECT_IMAGE_BYTES = 10 * 1024 * 1024;
    public const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
    public const MAX_FILE_BYTES = 5000 * 1024 * 1024;
    /**
     * The largest audio or video uploaded in parts, in bytes. The API holds free uploads, made
     * before billing is set up, to `MAX_MEDIA_BYTES` itself.
     */
    public const MAX_LONG_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
    /** The largest image uploaded in parts, in bytes. */
    public const MAX_MULTIPART_IMAGE_BYTES = 20 * 1024 * 1024;
    /** The longest `idempotencyKey` of an upload sent in parts: each part's key adds `:part-<n>`. */
    public const MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH = 240;

    /**
     * The best `pageSize` matches (1 to 20, 10 by default) for a keyword or natural-language `query`,
     * ranked by relevance. Search has no cursor: refine the query, or list with a filter, for more.
     *
     * @param array{query: string, pageSize?: int, mode?: 'keyword'|'semantic'|'hybrid'} $params
     * @param RequestOptions $requestOptions
     * @return AssetSearchResults
     */
    public function search(array $params, array $requestOptions = []): AssetSearchResults
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(AssetSearchResults::class, $this->session->request('GET', $this->session->project('assets/search'), query: $api, options: $request));
    }

    /**
     * One page of the project's assets. `filter` is an RSQL filter, such as `folderId==fldr_…` (or
     * `folderId==null` for the root); `sort` is `createdAt` and `id`, comma-separated, each
     * descending when prefixed with `-` (`-createdAt` by default). Pass the page's `nextCursor` as
     * `cursor` for the next page; `pageSize` is 1 to 100 (50 by default).
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string, filter?: ?string} $params
     * @param RequestOptions $requestOptions
     * @return Collection<Asset>
     */
    public function list(array $params = [], array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->collection(Collection::class, Asset::class, $this->session->request('GET', $this->session->project('assets'), query: $api, options: $request), fn (array $next) => $this->list($next, $requestOptions), $params);
    }

    /**
     * One page of an asset's child assets, with the same `cursor`, `pageSize` and `sort` as `list`.
     *
     * @param array{assetId: string, cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return Collection<Asset>
     */
    public function listChildren(array $params, array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->collection(Collection::class, Asset::class, $this->session->request('GET', $path . '/children', query: $api, options: $request), fn (array $next) => $this->listChildren($next, $requestOptions), $params);
    }

    /**
     * One page of an audio or video asset's findings timeline, in time order: each segment's
     * `source`, `startSeconds`, `endSeconds` and `categories`. Pass the page's opaque `nextCursor`
     * as `cursor` for the next page; `pageSize` is 1 to 100 (50 by default).
     * `classification.moderation.timeline.segmentCount` says how many segments there are.
     *
     * @param array{assetId: string, cursor?: string, pageSize?: int} $params
     * @param RequestOptions $requestOptions
     * @return Collection<TimelineSegment>
     */
    public function listTimeline(array $params, array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->session->project(ltrim($this->path($api, 'assets', 'assetId'), '/'));
        return $this->collection(Collection::class, TimelineSegment::class, $this->session->request('GET', $path . '/timeline', query: $api, options: $request), fn (array $next) => $this->listTimeline($next, $requestOptions), $params);
    }

    /** Yields every asset `list` would, fetching pages as needed. */
    /**
     * @param array{cursor?: string, pageSize?: int, sort?: string, filter?: ?string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, Asset>
     */
    public function each(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingIterator();
    }

    /** Yields every child of the asset `assetId`, fetching pages as needed. */
    /**
     * @param array{assetId: string, cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, Asset>
     */
    public function eachChild(array $params, array $requestOptions = []): \Generator
    {
        yield from $this->listChildren($params, $requestOptions)->autoPagingIterator();
    }

    /** Yields every segment of an audio or video asset's findings timeline, in time order. */
    /**
     * @param array{assetId: string, cursor?: string, pageSize?: int} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, TimelineSegment>
     */
    public function eachTimelineSegment(array $params, array $requestOptions = []): \Generator
    {
        yield from $this->listTimeline($params, $requestOptions)->autoPagingIterator();
    }

    /**
     * @param array{assetId: string} $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function retrieve(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Asset::class, $this->session->request('GET', $this->path($api, 'assets', 'assetId'), options: $request));
    }

    /**
     * @param array{
     *     assetId: string, name?: string, description?: ?string, externalId?: ?string, externalUrl?: ?string,
     *     metadata?: list<array{id: string, value: MetadataValue}>|null, tags?: list<string>|null,
     *     visibility?: 'public'|'private'|null,
     * } $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function update(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->model(Asset::class, $this->session->request('PATCH', $path, body: (object) $api, options: $request));
    }

    /**
     * @param array{assetId: string} $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function retry(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Asset::class, $this->session->request('POST', $this->path($api, 'assets', 'assetId') . '/retry', options: $request));
    }

    /**
     * Records a reviewer's decision: `decision` (`allowed`, `limited`, `age-restricted`, `blocked`
     * or `purged`) becomes the moderation status and a manual review with the required `note` is
     * added. An asset still pending moderation can only be blocked or purged; purging deletes the
     * stored content and needs `'confirmPurge' => true` and the `assets:delete` permission.
     *
     * @param array{
     *     assetId: string, decision: 'allowed'|'limited'|'age-restricted'|'blocked'|'purged', note: string,
     *     confirmPurge?: true,
     * } $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function decide(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->model(Asset::class, $this->session->request('POST', $path . '/decision', body: (object) $api, options: $request));
    }

    /**
     * Completes the policy evidence behind a decided asset's moderation decision: the report's
     * `classification.moderation.explanationComplete` becomes `true` and every action stays as decided.
     * With `'rerun' => true` the asset is moderated again with the project's current policy and an
     * `asset.rerun-requested` event is recorded; use it when the policy changed since the decision
     * (`asset/policy-changed`). The asset returns unchanged: it keeps its decision until the
     * re-run's is stored, reported by `asset.classified` and `asset.<status>` events, and a failed
     * re-run keeps it. A reviewed asset fails with `asset/reviewed`, and one whose content is gone
     * with `asset/content-unavailable`.
     *
     * @param array{assetId: string, rerun?: bool} $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function explain(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'assets', 'assetId');
        $body = !empty($api['rerun']) ? ['rerun' => true] : new \stdClass();
        return $this->model(Asset::class, $this->session->request('POST', $path . '/explain', body: $body, options: $request));
    }

    /**
     * Removes the asset's stored content, including the original, rendered files, extracted text
     * and placeholder, and keeps the asset record, metadata and classification results. The
     * returned asset has `content.status` `removed` and `content.removalReason` `requested`; the
     * CDN no longer serves it.
     *
     * @param array{assetId: string} $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function removeContent(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Asset::class, $this->session->request('DELETE', $this->path($api, 'assets', 'assetId') . '/content', options: $request));
    }

    /**
     * Deletes an asset record together with its stored content. An asset extracted from another
     * (one with a `parentId`) fails with `asset/child-not-deletable`: delete its parent instead.
     *
     * @param array{assetId: string} $params
     * @param RequestOptions $requestOptions
     */
    public function delete(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $this->session->request('DELETE', $this->path($api, 'assets', 'assetId'), options: $request);
    }

    /**
     * Deletes up to 500 assets (`'operation' => 'delete'`) or removes their stored content
     * (`'remove-content'`) in one request. Every asset must exist in the project and the key needs
     * `assets:delete` for its folder, and a deletion can't name an asset extracted from another
     * (`asset/child-not-deletable`), or nothing is queued. Returns
     * `['batchId' => ..., 'status' => 'queued', 'assetCount' => ...]` once queued; the work runs in
     * the background and records `asset.deleted` or `asset.content-removed` for each asset, with a
     * `batch-id` fact naming `batchId`. Assets under a safety hold are skipped. Not retried: it
     * carries no `Idempotency-Key`.
     *
     * @param array{assetIds: list<string>, operation: 'delete'|'remove-content'} $params
     * @param RequestOptions $requestOptions
     * @return AssetBatch
     */
    public function batch(array $params, array $requestOptions = []): AssetBatch
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        self::validateBatch($api);
        $body = ['assetIds' => $api['assetIds'], 'operation' => $api['operation']];
        return $this->model(AssetBatch::class, $this->session->request('POST', $this->session->project('assets/batch'), body: $body, options: $request));
    }

    /** Refuses a batch the API would reject for its size, an ID or the operation (`sdk/invalid-argument`). */
    public static function validateBatch(array $options): void
    {
        $ids = $options['assetIds'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || count($ids) < 1 || count($ids) > self::MAX_BATCH_ASSETS) {
            Values::invalid('assetIds must list 1 to ' . self::MAX_BATCH_ASSETS . ' asset IDs');
        }
        foreach ($ids as $id) {
            if (!is_string($id) || $id === '') {
                Values::invalid('Every asset ID must be a non-empty string');
            }
        }
        if (!in_array($options['operation'] ?? null, self::BATCH_OPERATIONS, true)) {
            Values::invalid('operation must be one of ' . implode(', ', self::BATCH_OPERATIONS));
        }
    }

    /**
     * @param array{assetId: string, folderId: ?string} $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function move(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'assets', 'assetId');
        if (!array_key_exists('folderId', $api)) {
            Values::invalid('folderId is required (null moves to root)');
        }
        return $this->model(Asset::class, $this->session->request('POST', $path . '/move', body: ['folderId' => $api['folderId']], options: $request));
    }

    /**
     * Uploads an asset and returns without waiting for its decision (`wait=false`), with
     * `classification.status` `queued`.
     *
     * @param CreateAssetOptions $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function create(array $params, array $requestOptions = []): Asset
    {
        return Asset::constructFrom($this->submit($params, $requestOptions, false))->withLastResponse($this->session->lastResponse);
    }

    /**
     * Uploads an asset and waits for its moderation decision (`wait=true`).
     *
     * @param CreateAssetOptions $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function classify(array $params, array $requestOptions = []): Asset
    {
        if (isset($params['content']['plainText']) && (!is_string($params['content']['plainText']) || trim($params['content']['plainText']) === '')) {
            Values::invalid('Text must not be blank', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        return Asset::constructFrom($this->submit($params, $requestOptions, true))->withLastResponse($this->session->lastResponse);
    }

    /** @return array<string, mixed> the uploaded asset */
    private function submit(array $params, array $requestOptions, bool $wait): array
    {
        [$api, $request] = $this->split($params, 'create', $requestOptions);
        if (!is_string($api['name'] ?? null) || $api['name'] === ''
            || count(array_intersect(['content', 'part', 'url'], array_keys($api))) !== 1 || array_key_exists('isFinal', $api)) {
            Values::invalid('Supply a name and exactly one of content, part or url', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        if (array_key_exists('context', $api)) {
            if (!is_array($api['context']) || !is_array($api['context']['items'] ?? null)) {
                Values::invalid('context.items must be a list of earlier posts');
            }
            // Only the posts CalmLens uses are sent.
            $api['context'] = ['items' => ModerationContext::select($api['context']['items'])];
        }
        if (array_key_exists('url', $api)) {
            return self::asset($this->session->request('POST', $this->session->project('assets'), query: ['wait' => $wait], body: $api, idempotent: true, options: $request));
        }
        $multipart = array_key_exists('part', $api);
        $content = $api[$multipart ? 'part' : 'content'];
        $mime = is_array($content) ? ($content['type'] ?? null) : null;
        if (!is_string($mime) || preg_match('/[\r\n]/', $mime)) {
            Values::invalid('Invalid content type', ErrorCodes::UNSUPPORTED_UPLOAD_TYPE, ['source' => 'calmlens']);
        }
        $baseMime = strtolower(trim(explode(';', $mime)[0]));
        Values::checkUploadMimeType($mime);
        if ($multipart && ($content['partNumber'] ?? 1) !== 1) {
            Values::invalid('Use uploadPart for subsequent parts', ErrorCodes::USE_UPLOAD_PART);
        }
        $direct = !$multipart && !$this->session->deferUploadChecks;
        $image = str_starts_with($baseMime, 'image/');
        if ($direct && !$image && is_int($content['sizeInBytes'] ?? null)) {
            // A declared size over any limit is refused before the stream is read or measured. Its
            // own limit, and images, are checked below, once it is known whether it goes in parts.
            self::checkSize($baseMime, $content['sizeInBytes'], true);
        }
        $body = UploadBody::from($content, $multipart, !$this->session->deferUploadChecks);
        // Content the client can read again is sent in parts when it is larger than one part.
        $split = !$multipart && !array_key_exists('plainText', $content) && $body->isSeekable()
            && $body->getSize() !== null && $body->getSize() > $this->session->partSizeBytes;
        if ($split && strlen((string) ($request['idempotencyKey'] ?? '')) > self::MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH) {
            Values::invalid('idempotencyKey can be at most ' . self::MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH . ' characters for an upload sent in parts');
        }
        if ($direct && $split && $image) {
            if ($body->getSize() > self::MAX_MULTIPART_IMAGE_BYTES) {
                self::tooLarge('Multipart image uploads cannot exceed 20 MiB', self::MAX_MULTIPART_IMAGE_BYTES);
            }
        } elseif ($direct) {
            self::checkSize($baseMime, $body->getSize(), $split);
        }
        // The asset's fields travel in the body, never the URL, which proxies and servers log.
        $fields = array_filter(array_intersect_key($api, array_flip(UploadForm::FIELDS)), fn ($value) => $value !== null);
        $total = $multipart ? ($api['totalSizeInBytes'] ?? null) : null;
        if (array_key_exists('plainText', $content)) {
            $this->checkFirstPart($multipart, $baseMime, $total, $body->getSize());
            return self::asset($this->session->request('POST', $this->session->project('assets'), query: ['wait' => $wait],
                body: $fields + self::textBody($api, $content, $multipart), idempotent: true, options: $request));
        }
        $query = ['wait' => $wait, 'contentType' => $mime, 'sizeInBytes' => $body->getSize()];
        if ($split) {
            return $this->submitInParts($fields, $query, $mime, $body, $request);
        }
        $this->checkFirstPart($multipart, $baseMime, $total, $body->getSize());
        if ($multipart) {
            $query += ['partNumber' => 1, 'isFinal' => $content['isFinal'] ?? false, 'totalSizeInBytes' => $total];
        }
        return $this->sendForm($fields, $query, $mime, $body, $multipart, $request);
    }

    /** Plain text's JSON body after its fields: `content`, or a first `part` with its sizes. */
    private static function textBody(array $api, array $content, bool $multipart): array
    {
        $text = ['plainText' => $content['plainText'], 'type' => $content['type']];
        if (!$multipart) {
            return ['content' => $text];
        }
        $part = $text + (isset($content['partNumber']) ? ['partNumber' => $content['partNumber']] : []) + ['isFinal' => $content['isFinal'] ?? false];
        return array_filter(['part' => $part, 'sizeInBytes' => $content['sizeInBytes'] ?? $api['sizeInBytes'] ?? null,
            'totalSizeInBytes' => $api['totalSizeInBytes'] ?? null], fn ($value) => $value !== null);
    }

    /** Sends file content or a first part as an upload form: the fields in its options part, the bytes in its file part. */
    private function sendForm(array $fields, array $query, string $mime, StreamInterface $body, bool $multipart, array $request): array
    {
        [$form, $type] = UploadForm::build($fields, $mime, $body);
        return self::asset($this->session->request('POST', $this->session->project('assets'), query: $query, raw: $form,
            headers: ['Content-Type' => $type, 'X-CalmLens-Upload' => $multipart ? 'part' : 'content'], idempotent: true,
            options: $request, upload: true));
    }

    /** Refuses a first part's declared total the API would refuse, before anything is sent. */
    private function checkFirstPart(bool $multipart, string $baseMime, mixed $total, ?int $size): void
    {
        if ($multipart) {
            if ($total !== null && (!is_int($total) || $total <= 0
                || (!$this->session->deferUploadChecks && $total < $size))) {
                Values::invalid('Invalid totalSizeInBytes', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
            }
            if (str_starts_with($baseMime, 'image/') && !$this->session->deferUploadChecks) {
                if (($total ?? $size) > self::MAX_MULTIPART_IMAGE_BYTES) {
                    self::tooLarge('Multipart image uploads cannot exceed 20 MiB', self::MAX_MULTIPART_IMAGE_BYTES);
                }
            } elseif (!$this->session->deferUploadChecks) {
                // A declared whole-file size over the limit for parts can never finish.
                self::checkSize($baseMime, $total, true);
            }
        }
    }

    /**
     * Uploads `$body` in parts of `partSizeBytes` and returns the final part's asset. Part 1 goes
     * with the upload's fields; part n after it carries the Idempotency-Key `<key>:part-<n>`, so
     * each part is retried on its own and repeating the call with the same key replays the parts
     * the API already has and sends the rest. A part the API already has is skipped, and a final
     * part that finds the upload completed reads the asset back.
     */
    private function submitInParts(array $fields, array $query, string $mime, StreamInterface $body, array $request): array
    {
        $total = (int) $body->getSize();
        $partSize = $this->session->partSizeBytes;
        $count = intdiv($total + $partSize - 1, $partSize);
        $key = $request['idempotencyKey'] ?? Values::uuid();
        // Each part is a window on the source, so a retry rewinds to the part's own start.
        $piece = static function (int $number) use ($body, $partSize, $total): LimitStream {
            $offset = ($number - 1) * $partSize;
            return new LimitStream($body, min($partSize, $total - $offset), $offset);
        };
        $first = $piece(1);
        $query['sizeInBytes'] = $first->getSize();
        $query += ['partNumber' => 1, 'isFinal' => false, 'totalSizeInBytes' => $total];
        $asset = $this->sendForm($fields, $query, $mime, $first, true, ['idempotencyKey' => $key] + $request);
        $path = '/assets/' . Values::segment($asset['id']) . '/part';
        for ($number = 2; $number <= $count;) {
            $final = $number === $count;
            $part = $piece($number);
            try {
                $asset = self::asset($this->session->request('POST', $path,
                    query: ['partNumber' => $number, 'isFinal' => $final, 'sizeInBytes' => $part->getSize()], raw: $part,
                    headers: ['X-CalmLens-Upload' => 'part'], idempotent: true,
                    options: ['idempotencyKey' => "$key:part-$number"] + $request, upload: true));
            } catch (CalmLensException $error) {
                $expected = $error->details['expectedPartNumber'] ?? null;
                if ($error->errorCode === ErrorCodes::INVALID_UPLOAD_PART_NUMBER && is_int($expected) && $expected > $number && $expected <= $count) {
                    // The parts before `expected` arrived, but their responses were lost.
                    $number = $expected;
                    continue;
                }
                if ($final && $error->errorCode === ErrorCodes::UPLOAD_NOT_OPEN) {
                    // The final part completed the upload, but its response was lost.
                    unset($request['idempotencyKey']);
                    return self::asset($this->retrieve(['assetId' => $asset['id']], $request)->toArray());
                }
                throw $error;
            }
            $number++;
        }
        return $asset;
    }

    /**
     * Uploads the next part of a multipart upload. Whether the final part waits for the decision was
     * chosen when the upload started; pass `wait` (a boolean) to override it.
     *
     * @param array{assetId: string, part: UploadPart, wait?: bool} $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function uploadPart(array $params, array $requestOptions = []): Asset
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->path($api, 'assets', 'assetId');
        $part = $api['part'] ?? null;
        if (!is_array($part) || !is_int($part['partNumber'] ?? null) || $part['partNumber'] < 1) {
            Values::invalid('partNumber must be positive', ErrorCodes::INVALID_UPLOAD_PART_NUMBER);
        }
        $body = UploadBody::from($part, true, !$this->session->deferUploadChecks);
        $query = ['partNumber' => $part['partNumber'], 'isFinal' => $part['isFinal'] ?? false, 'sizeInBytes' => $body->getSize()];
        if (array_key_exists('wait', $api)) {
            if (!is_bool($api['wait'])) {
                Values::invalid('wait must be a boolean');
            }
            $query['wait'] = $api['wait'];
        }
        return Asset::constructFrom(self::asset($this->session->request('POST', $path . '/part', query: $query, raw: $body,
            headers: ['X-CalmLens-Upload' => 'part'], idempotent: true, options: $request, upload: true)))->withLastResponse($this->session->lastResponse);
    }

    /**
     * Retrieves an asset until it is settled, its `classification.status` `completed` (with its
     * decision in `classification.moderation.status`) or `failed`, and returns it. A `queued` or
     * `processing` asset is still waiting, even when a reviewer has already decided it. Waits 0.5
     * seconds before the second check and 1.5 times longer each time, at most 2 seconds. Throws
     * `TimeoutException` (`sdk/timeout`, with the asset's statuses in `details`) once `timeout`
     * seconds (default 60) pass without it settling; 0 checks once.
     *
     * @param array{assetId: string, timeout?: int|float} $params
     * @param RequestOptions $requestOptions
     * @return Asset
     */
    public function waitForDecision(array $params, array $requestOptions = []): Asset
    {
        $options = $params;
        $timeout = $options['timeout'] ?? self::DEFAULT_DECISION_TIMEOUT;
        if ((!is_int($timeout) && !is_float($timeout)) || !is_finite((float) $timeout) || $timeout < 0) {
            Values::invalid('timeout must be a non-negative number');
        }
        Values::knownOptions($options, 'assets.waitForDecision');
        unset($options['timeout']);
        Values::segment($options['assetId'] ?? null);
        $deadline = ($this->session->clock)() + $timeout;
        $delay = self::DECISION_FIRST_INTERVAL;
        [$api, $request] = $this->split($options, 'retrieve', $requestOptions);
        $path = $this->path($api, 'assets', 'assetId');
        $classification = [];
        $status = null;
        do {
            try {
                $asset = $this->session->request('GET', $path, options: $request, deadline: $timeout > 0 ? $deadline : null);
            } catch (CalmLensException $error) {
                if ($error->errorCode !== 'sdk/timeout' || $timeout == 0 || ($this->session->clock)() < $deadline) {
                    throw $error;
                }
                break;
            }
            $remaining = $deadline - ($this->session->clock)();
            if ($timeout > 0 && $remaining <= 0) {
                break;
            }
            $classification = $asset['classification'] ?? [];
            $status = $classification['moderation']['status'] ?? null;
            if (in_array($classification['status'] ?? null, ['completed', 'failed'], true)) {
                return $this->model(Asset::class, $asset);
            }
            if ($remaining <= 0) {
                break;
            }
            ($this->session->sleep)(min($delay, $remaining));
            $delay = min($delay * self::DECISION_INTERVAL_FACTOR, self::DECISION_MAX_INTERVAL);
        } while (true);
        throw CalmLensException::create('sdk/timeout', "Asset {$options['assetId']} had no moderation decision after {$timeout}s",
            details: ['assetId' => $options['assetId'], 'classificationStatus' => $classification['status'] ?? null, 'moderationStatus' => $status]);
    }

    /**
     * Refuses content whose known size is over the API's limit for its type, before any of it is
     * sent. In one request, images can be up to 10 MiB (larger ones are uploaded in parts), audio
     * and video up to 50 MiB and other files up to 5,000 MiB. Sent in parts (`$inParts`), audio and
     * video can be up to 2 GiB. Images in parts are checked apart.
     */
    private static function checkSize(string $mime, ?int $size, bool $inParts): void
    {
        [$limit, $message] = match (true) {
            str_starts_with($mime, 'image/') => [self::MAX_DIRECT_IMAGE_BYTES, 'Images uploaded in one request can be at most 10 MiB; upload larger images in parts'],
            str_starts_with($mime, 'audio/'), str_starts_with($mime, 'video/') => [
                $inParts ? self::MAX_LONG_MEDIA_BYTES : self::MAX_MEDIA_BYTES,
                'Audio and video files can be at most 50 MiB in one request, or 2 GiB in parts',
            ],
            default => [self::MAX_FILE_BYTES, 'Files can be at most 5,000 MiB'],
        };
        if ($size !== null && $size > $limit) {
            self::tooLarge($message, $limit);
        }
    }

    /** Fails with `upload/too-large`, naming the plan's `limitBytes` as the API does. */
    private static function tooLarge(string $message, int $limit): never
    {
        Values::invalid($message, ErrorCodes::UPLOAD_TOO_LARGE, ['limitBytes' => $limit, 'source' => 'plan']);
    }

    /** An upload's response must be an asset with its statuses. */
    private static function asset(mixed $data): array
    {
        if (!is_array($data) || !is_string($data['id'] ?? null) || $data['id'] === ''
            || !is_string($data['upload']['status'] ?? null) || !is_string($data['classification']['status'] ?? null)
            || !is_string($data['classification']['moderation']['status'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Expected an asset response', 200);
        }
        return $data;
    }
}
