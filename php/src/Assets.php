<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Transforms;
use CalmLens\Internal\UploadBody;
use CalmLens\Internal\Values;
use GuzzleHttp\Psr7\LimitStream;
use Psr\Http\Message\StreamInterface;

final class Assets extends Resource
{
    protected const OPERATIONS = 'assets';

    /** The longest signed URL lifetime the API accepts: 24 hours. */
    public const MAX_SIGNED_URL_SECONDS = 86400;
    /** `createSignedUrl`'s lifetime when none is given, sent explicitly. */
    public const DEFAULT_SIGNED_URL_SECONDS = 900;
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

    public function search(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->session->project('assets/search'), query: $api, options: $request);
    }

    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->session->project('assets'), query: $api, options: $request);
    }

    public function listChildren(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->session->request('GET', $path . '/children', query: $api, options: $request);
    }

    /**
     * One page of an audio or video asset's findings timeline, in time order: each segment's
     * `source`, `startSeconds`, `endSeconds` and `categories`. Pass the page's opaque `nextCursor`
     * as `cursor` for the next page; `pageSize` is 1 to 100 (50 by default).
     * `classification.moderation.timeline.segmentCount` says how many segments there are.
     */
    public function listTimeline(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->session->project(ltrim($this->path($api, 'assets', 'assetId'), '/'));
        return $this->session->request('GET', $path . '/timeline', query: $api, options: $request);
    }

    public function each(array $options = []): \Generator
    {
        foreach ($this->pages($this->list(...), $options) as $page) {
            yield from $page['items'];
        }
    }

    public function eachChild(array $options): \Generator
    {
        foreach ($this->pages($this->listChildren(...), $options) as $page) {
            yield from $page['items'];
        }
    }

    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->path($api, 'assets', 'assetId'), options: $request);
    }

    public function update(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }

    public function retry(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('POST', $this->path($api, 'assets', 'assetId') . '/retry', options: $request);
    }

    /**
     * Records a reviewer's decision: `decision` (`allowed`, `limited`, `age-restricted`, `blocked`
     * or `purged`) becomes the moderation status and a manual review with the required `note` is
     * added. An asset still pending moderation can only be blocked or purged; purging deletes the
     * stored content and needs `'confirmPurge' => true` and the `assets:delete` permission.
     */
    public function decide(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->session->request('POST', $path . '/decision', body: (object) $api, options: $request);
    }

    /**
     * Completes the policy evidence behind a decided asset's moderation decision: the report's
     * `classification.moderation.explanationComplete` becomes `true` and every action stays as decided.
     * With `'rerun' => true` the asset is moderated again with the project's current policy and
     * returns in `processing`; use it when the policy changed since the decision (`asset/policy-changed`).
     */
    public function explain(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'assets', 'assetId');
        $body = !empty($api['rerun']) ? ['rerun' => true] : new \stdClass();
        return $this->session->request('POST', $path . '/explain', body: $body, options: $request);
    }

    public function deleteContent(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('DELETE', $this->path($api, 'assets', 'assetId') . '/content', options: $request);
    }

    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $this->session->request('DELETE', $this->path($api, 'assets', 'assetId'), options: $request);
    }

    /**
     * Deletes up to 500 assets (`'operation' => 'delete'`) or removes their stored content
     * (`'remove-content'`) in one request. Every asset must exist in the project and the key needs
     * `assets:delete` for its folder, or nothing is queued. Returns `['queued' => true]` once
     * queued; the work runs in the background and records `asset.deleted` or
     * `asset.content-removed` for each asset. Assets under a safety hold are skipped. Not retried:
     * it carries no `Idempotency-Key`.
     *
     * @param array{assetIds: list<string>, operation: string} $options
     * @return array{queued: bool}
     */
    public function batch(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        self::validateBatch($api);
        $body = ['assetIds' => $api['assetIds'], 'operation' => $api['operation']];
        return $this->session->request('POST', $this->session->project('assets/batch'), body: $body, options: $request);
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

    public function move(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'assets', 'assetId');
        if (!array_key_exists('folderId', $api)) {
            Values::invalid('folderId is required (null moves to root)');
        }
        return $this->session->request('POST', $path . '/move', body: ['folderId' => $api['folderId']], options: $request);
    }

    public function createSignedUrl(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'assets', 'assetId');
        // As the API checks: the original, rendered and preview resources are signed (a
        // placeholder needs no signature), and the original takes no lens or transform.
        $resource = $api['resource'] ?? 'rendered';
        if (!in_array($resource, Cdn::SIGNED_RESOURCES, true)) {
            Values::invalid("A signed URL's resource must be one of " . implode(', ', Cdn::SIGNED_RESOURCES));
        }
        if ($resource === 'original' && (isset($api['lens']) || isset($api['transform']))) {
            Values::invalid('The original resource takes no lens or transform');
        }
        $expires = $api['expiresInSeconds'] ?? self::DEFAULT_SIGNED_URL_SECONDS;
        if (!is_int($expires) || $expires < 1 || $expires > self::MAX_SIGNED_URL_SECONDS) {
            Values::invalid('expiresInSeconds must be a whole number from 1 to 86400');
        }
        if (isset($api['transform'])) {
            $api['transform'] = Transforms::selector($api['transform']);
        }
        return $this->session->request('POST', $path . '/signed-url', body: $api + ['expiresInSeconds' => self::DEFAULT_SIGNED_URL_SECONDS], options: $request);
    }

    public function create(array $options): array { return $this->submit($options, true); }
    public function classify(array $options): array
    {
        if (isset($options['content']['plainText']) && (!is_string($options['content']['plainText']) || trim($options['content']['plainText']) === '')) {
            Values::invalid('Text must not be blank', 'upload/invalid-payload');
        }
        return $this->submit($options, false);
    }

    private function submit(array $options, bool $queue): array
    {
        [$api, $request] = $this->split($options, 'create');
        if (!is_string($api['name'] ?? null) || $api['name'] === ''
            || count(array_intersect(['content', 'part', 'url'], array_keys($api))) !== 1 || array_key_exists('isFinal', $api)) {
            Values::invalid('Supply a name and exactly one of content, part or url', 'upload/invalid-payload');
        }
        if (array_key_exists('context', $api)) {
            if (!is_array($api['context']) || !is_array($api['context']['items'] ?? null)) {
                Values::invalid('context.items must be a list of earlier posts');
            }
            // Only the posts CalmLens uses are sent, which keeps a raw upload's query short.
            $api['context'] = ['items' => ModerationContext::select($api['context']['items'])];
        }
        if (array_key_exists('url', $api)) {
            return self::asset($this->session->request('POST', $this->session->project('assets'), query: ['queue' => $queue], body: $api, idempotent: true, options: $request));
        }
        $multipart = array_key_exists('part', $api);
        $content = $api[$multipart ? 'part' : 'content'];
        $mime = is_array($content) ? ($content['type'] ?? null) : null;
        if (!is_string($mime) || preg_match('/[\r\n]/', $mime)) {
            Values::invalid('Invalid content type', 'upload/invalid-mime-type');
        }
        $baseMime = strtolower(trim(explode(';', $mime)[0]));
        Values::checkUploadMimeType($mime);
        if ($multipart && ($content['partNumber'] ?? 1) !== 1) {
            Values::invalid('Use uploadPart for subsequent parts', 'upload/use-upload-part');
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
                Values::invalid('Multipart image uploads cannot exceed 20 MiB', ErrorCodes::MULTIPART_IMAGE_TOO_LARGE);
            }
        } elseif ($direct) {
            self::checkSize($baseMime, $body->getSize(), $split);
        }
        $query = array_intersect_key($api, array_flip(['name', 'description', 'processingOptions', 'visibility', 'metadata', 'authorId', 'context', 'externalId', 'externalUrl', 'folderId', 'uploadPresetId']));
        $query += ['queue' => $queue, 'contentType' => $mime, 'sizeInBytes' => $body->getSize()];
        if ($split) {
            return $this->submitInParts($query, $mime, $body, $request);
        }
        if ($multipart) {
            $total = $api['totalSizeInBytes'] ?? null;
            if ($total !== null && (!is_int($total) || $total <= 0
                || (!$this->session->deferUploadChecks && $total < $body->getSize()))) {
                Values::invalid('Invalid totalSizeInBytes', 'upload/invalid-payload');
            }
            if (str_starts_with($baseMime, 'image/') && !$this->session->deferUploadChecks) {
                $size = $total ?? $body->getSize();
                if ($size > 20 * 1024 * 1024) {
                    Values::invalid('Multipart image exceeds 20MiB', 'upload/multipart-image-too-large');
                }
            } elseif (!$this->session->deferUploadChecks) {
                // A declared whole-file size over the limit for parts can never finish.
                self::checkSize($baseMime, $total, true);
            }
            $query += ['partNumber' => 1, 'isFinal' => $content['isFinal'] ?? false, 'totalSizeInBytes' => $total];
        }
        return self::asset($this->session->request('POST', $this->session->project('assets'), query: $query, raw: $body,
            headers: ['Content-Type' => $mime, 'X-CalmLens-Upload' => $multipart ? 'part' : 'content'], idempotent: true, options: $request,
            upload: !array_key_exists('plainText', $content)));
    }

    /**
     * Uploads `$body` in parts of `partSizeBytes` and returns the final part's asset. Part 1 goes
     * with the upload's fields; part n after it carries the Idempotency-Key `<key>:part-<n>`, so
     * each part is retried on its own and repeating the call with the same key replays the parts
     * the API already has and sends the rest. A part the API already has is skipped, and a final
     * part that finds the upload completed reads the asset back.
     */
    private function submitInParts(array $query, string $mime, StreamInterface $body, array $request): array
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
        $asset = self::asset($this->session->request('POST', $this->session->project('assets'), query: $query, raw: $first,
            headers: ['Content-Type' => $mime, 'X-CalmLens-Upload' => 'part'], idempotent: true,
            options: ['idempotencyKey' => $key] + $request, upload: true));
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
                    return self::asset($this->retrieve(['assetId' => $asset['id'], 'requestOptions' => $request]));
                }
                throw $error;
            }
            $number++;
        }
        return $asset;
    }

    public function uploadPart(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->path($api, 'assets', 'assetId');
        $part = $api['part'] ?? null;
        if (!is_array($part) || !is_int($part['partNumber'] ?? null) || $part['partNumber'] < 1) {
            Values::invalid('partNumber must be positive', 'upload/invalid-part-number');
        }
        $body = UploadBody::from($part, true, !$this->session->deferUploadChecks);
        $query = ['partNumber' => $part['partNumber'], 'isFinal' => $part['isFinal'] ?? false, 'sizeInBytes' => $body->getSize()];
        if (array_key_exists('queue', $api)) {
            if (!is_bool($api['queue'])) {
                Values::invalid('queue must be a boolean');
            }
            $query['queue'] = $api['queue'];
        }
        return self::asset($this->session->request('POST', $path . '/part', query: $query, raw: $body,
            headers: ['X-CalmLens-Upload' => 'part'], idempotent: true, options: $request, upload: true));
    }

    /**
     * Retrieves an asset until `classification.moderation.status` is no longer `pending`, or its
     * `classification.status` is `failed`, and returns it. Waits 0.5 seconds before the second
     * check and 1.5 times longer each time, at most 2 seconds. Throws `TimeoutException`
     * (`sdk/timeout`, with the asset's statuses in `details`) once `timeout` seconds (default 60)
     * pass without a decision; 0 checks once.
     */
    public function waitForDecision(array $options): array
    {
        $timeout = $options['timeout'] ?? self::DEFAULT_DECISION_TIMEOUT;
        if ((!is_int($timeout) && !is_float($timeout)) || !is_finite((float) $timeout) || $timeout < 0) {
            Values::invalid('timeout must be a non-negative number');
        }
        Values::knownOptions($options, 'assets.waitForDecision');
        unset($options['timeout']);
        Values::segment($options['assetId'] ?? null);
        $deadline = ($this->session->clock)() + $timeout;
        $delay = self::DECISION_FIRST_INTERVAL;
        do {
            $asset = $this->retrieve($options);
            $classification = $asset['classification'] ?? [];
            // Any status but pending is a decision: allowed, limited, age-restricted, blocked or purged.
            $status = $classification['moderation']['status'] ?? null;
            if (($status !== null && $status !== 'pending') || ($classification['status'] ?? null) === 'failed') {
                return $asset;
            }
            $remaining = $deadline - ($this->session->clock)();
            if ($remaining <= 0) {
                throw CalmLensException::create('sdk/timeout', "Asset {$options['assetId']} had no moderation decision after {$timeout}s",
                    details: ['assetId' => $asset['id'] ?? $options['assetId'], 'classificationStatus' => $classification['status'] ?? null, 'moderationStatus' => $status]);
            }
            ($this->session->sleep)(min($delay, $remaining));
            $delay = min($delay * self::DECISION_INTERVAL_FACTOR, self::DECISION_MAX_INTERVAL);
        } while (true);
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
            Values::invalid($message, ErrorCodes::FILE_TOO_LARGE);
        }
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
