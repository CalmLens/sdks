<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Transforms;
use CalmLens\Internal\UploadBody;
use CalmLens\Internal\Values;

final class Assets extends Resource
{
    /** The longest signed URL lifetime the API accepts: 24 hours. */
    public const MAX_SIGNED_URL_SECONDS = 86400;
    /** `createSignedUrl`'s lifetime when none is given, sent explicitly. */
    public const DEFAULT_SIGNED_URL_SECONDS = 900;
    /** Seconds `waitForDecision` polls before `sdk/timeout`; 0 checks once. */
    public const DEFAULT_DECISION_TIMEOUT = 60;
    /** Seconds before `waitForDecision`'s second check; each later wait is 1.5 times longer, at most 5 seconds. */
    public const DECISION_FIRST_INTERVAL = 0.5;
    public const DECISION_INTERVAL_FACTOR = 1.5;
    public const DECISION_MAX_INTERVAL = 5;

    public function search(array $options): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('GET', $this->session->project('assets/search'), query: $api, options: $request);
    }

    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('GET', $this->session->project('assets/page'), query: $api, options: $request);
    }

    public function listChildren(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->session->request('GET', $path . '/children', query: $api, options: $request);
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
        [$api, $request] = $this->split($options);
        return $this->session->request('GET', $this->path($api, 'assets', 'assetId'), options: $request);
    }

    public function update(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'assets', 'assetId');
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }

    public function retry(array $options): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('POST', $this->path($api, 'assets', 'assetId') . '/retry', options: $request);
    }

    /**
     * Completes the policy evidence behind a decided asset's moderation decision: the report's
     * `classification.moderation.policy.evidence` becomes `full` and every action stays as decided.
     * With `'rerun' => true` the asset is moderated again with the project's current policy and
     * returns in `processing`; use it when the policy changed since the decision (`asset/policy-changed`).
     */
    public function explain(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'assets', 'assetId');
        $body = !empty($api['rerun']) ? ['rerun' => true] : new \stdClass();
        return $this->session->request('POST', $path . '/explain', body: $body, options: $request);
    }

    public function deleteContent(array $options): array
    {
        [$api, $request] = $this->split($options);
        return $this->session->request('DELETE', $this->path($api, 'assets', 'assetId') . '/content', options: $request);
    }

    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options);
        $this->session->request('DELETE', $this->path($api, 'assets', 'assetId'), options: $request);
    }

    public function move(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'assets', 'assetId');
        if (!array_key_exists('folderId', $api)) {
            Values::invalid('folderId is required (null moves to root)');
        }
        return $this->session->request('POST', $path . '/move', body: ['folderId' => $api['folderId']], options: $request);
    }

    public function createSignedUrl(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'assets', 'assetId');
        // As the API checks: a placeholder needs no signature, and only the rendered resource
        // takes a lens or transform.
        $resource = $api['resource'] ?? 'rendered';
        if (!in_array($resource, ['original', 'rendered'], true)) {
            Values::invalid("A signed URL's resource must be original or rendered");
        }
        if ($resource === 'original' && (isset($api['lens']) || isset($api['transform']))) {
            Values::invalid('Lenses and transforms apply only to the rendered resource');
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
        [$api, $request] = $this->split($options);
        if (!is_string($api['name'] ?? null) || $api['name'] === ''
            || count(array_intersect(['content', 'part', 'url'], array_keys($api))) !== 1 || array_key_exists('isFinal', $api)) {
            Values::invalid('Supply a name and exactly one of content, part or url', 'upload/invalid-payload');
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
        if (!str_contains($baseMime, '/') || $baseMime === 'application/octet-stream' || str_starts_with($baseMime, 'multipart/')) {
            Values::invalid('Use a concrete file MIME type', 'upload/invalid-mime-type');
        }
        if ($multipart && ($content['partNumber'] ?? 1) !== 1) {
            Values::invalid('Use uploadPart for subsequent parts', 'upload/use-upload-part');
        }
        $body = UploadBody::from($content, $multipart, !$this->session->deferUploadChecks);
        $query = array_intersect_key($api, array_flip(['name', 'description', 'processingOptions', 'visibility', 'metadata', 'externalId', 'externalUrl', 'folderId', 'uploadPresetId']));
        $query += ['queue' => $queue, 'contentType' => $mime, 'sizeInBytes' => $body->getSize()];
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
                if (($total !== null || ($content['isFinal'] ?? false)) && $size < 10 * 1024 * 1024) {
                    Values::invalid('Multipart image is below 10MiB', 'upload/multipart-image-too-small');
                }
            }
            $query += ['partNumber' => 1, 'isFinal' => $content['isFinal'] ?? false, 'totalSizeInBytes' => $total];
        }
        return self::asset($this->session->request('POST', $this->session->project('assets'), query: $query, raw: $body,
            headers: ['Content-Type' => $mime, 'X-CalmLens-Upload' => $multipart ? 'part' : 'content'], idempotent: true, options: $request,
            upload: !array_key_exists('plainText', $content)));
    }

    public function uploadPart(array $options): array
    {
        [$api, $request] = $this->split($options);
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
     * check and 1.5 times longer each time, at most 5 seconds. Throws `TimeoutException`
     * (`sdk/timeout`, with the asset's statuses in `details`) once `timeout` seconds (default 60)
     * pass without a decision; 0 checks once.
     */
    public function waitForDecision(array $options): array
    {
        $timeout = $options['timeout'] ?? self::DEFAULT_DECISION_TIMEOUT;
        if ((!is_int($timeout) && !is_float($timeout)) || !is_finite((float) $timeout) || $timeout < 0) {
            Values::invalid('timeout must be a non-negative number');
        }
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
