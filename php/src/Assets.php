<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Transforms;
use CalmLens\Internal\UploadBody;
use CalmLens\Internal\Values;

final class Assets extends Resource
{
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
        if (isset($api['transform'])) {
            $api['transform'] = Transforms::selector($api['transform']);
        }
        return $this->session->request('POST', $path . '/signed-url', body: $api + ['resource' => 'content', 'expiresInSeconds' => 900], options: $request);
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
            return $this->session->request('POST', $this->session->project('assets'), query: ['queue' => $queue], body: $api, idempotent: true, options: $request);
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
        $body = UploadBody::from($content, $multipart);
        $query = array_intersect_key($api, array_flip(['name', 'description', 'processingOptions', 'visibility', 'metadata', 'externalId', 'externalUrl', 'folderId', 'uploadPresetId']));
        $query += ['queue' => $queue, 'contentType' => $mime, 'sizeInBytes' => $body->getSize()];
        if ($multipart) {
            $total = $api['totalSizeInBytes'] ?? null;
            if ($total !== null && (!is_int($total) || $total <= 0 || $total < $body->getSize())) {
                Values::invalid('Invalid totalSizeInBytes', 'upload/invalid-payload');
            }
            if (str_starts_with($baseMime, 'image/')) {
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
        return $this->session->request('POST', $this->session->project('assets'), query: $query, raw: $body,
            headers: ['Content-Type' => $mime, 'X-CalmLens-Upload' => $multipart ? 'part' : 'content'], idempotent: true, options: $request);
    }

    public function uploadPart(array $options): array
    {
        [$api, $request] = $this->split($options);
        $path = $this->path($api, 'assets', 'assetId');
        $part = $api['part'] ?? null;
        if (!is_array($part) || !is_int($part['partNumber'] ?? null) || $part['partNumber'] < 1) {
            Values::invalid('partNumber must be positive', 'upload/invalid-part-number');
        }
        $body = UploadBody::from($part, true);
        $query = ['partNumber' => $part['partNumber'], 'isFinal' => $part['isFinal'] ?? false, 'sizeInBytes' => $body->getSize()];
        if (array_key_exists('queue', $api)) {
            if (!is_bool($api['queue'])) {
                Values::invalid('queue must be a boolean');
            }
            $query['queue'] = $api['queue'];
        }
        return $this->session->request('POST', $path . '/part', query: $query, raw: $body,
            headers: ['Content-Type' => 'application/octet-stream', 'X-CalmLens-Upload' => 'part'], idempotent: true, options: $request);
    }

    public function waitForDecision(array $options): array
    {
        $timeout = $options['timeout'] ?? 60;
        if ((!is_int($timeout) && !is_float($timeout)) || !is_finite((float) $timeout) || $timeout < 0) {
            Values::invalid('timeout must be a non-negative number');
        }
        unset($options['timeout']);
        $deadline = hrtime(true) / 1e9 + $timeout;
        $delay = 0.5;
        do {
            $remaining = max(0.001, $deadline - hrtime(true) / 1e9);
            $request = $options['requestOptions'] ?? [];
            $request['timeout'] = min($request['timeout'] ?? 120, $remaining);
            $request['maxRetries'] = 0;
            $asset = $this->retrieve(array_replace($options, ['requestOptions' => $request]));
            $classification = $asset['classification'] ?? [];
            // Any status but pending is a decision: allowed, age-restricted, blocked or purged.
            $status = $classification['moderation']['status'] ?? null;
            if (($status !== null && $status !== 'pending') || ($classification['status'] ?? null) === 'failed') {
                return $asset;
            }
            $remaining = $deadline - hrtime(true) / 1e9;
            if ($remaining <= 0) {
                throw new CalmLensException('sdk/timeout', details: ['assetId' => $options['assetId'], 'classificationStatus' => $classification['status'] ?? null, 'moderationStatus' => $status]);
            }
            usleep((int) (min($delay, $remaining) * 1e6));
            $delay = min($delay * 1.5, 5);
        } while (true);
    }
}
