<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\CalmLensException;
use CalmLens\ServerClient;
use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Promise\PromiseInterface;
use GuzzleHttp\Psr7\Response;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * An offline CalmLens for tests. Calls run the real client's validation, encoding and error
 * handling, then reach an in-memory stand-in for the API and CDN instead of the network.
 *
 * The stand-in is stateful: uploads create assets you can retrieve, list, update, move and
 * delete, the CDN serves stored bytes, and errors use the API's codes, statuses and body shape.
 * It does not classify content: assets submitted with `classify` get `analyzedOutcome` and
 * those submitted with `create` get `queuedOutcome`. Content is kept only with
 * `keepContentAfterProcessing: true`; otherwise it is removed once classification completes,
 * as in the API. A `purged` outcome removes the content with reason `policy`.
 *
 * Like the CDN, it does not serve `blocked` assets, and serves private and age-restricted assets
 * only with the download permission (the API key) or, for a public age-restricted asset, the
 * `ageRestricted` URL option. Set `downloadPermission: false` to act as a browser without a key.
 *
 * Enqueued responses and exceptions are used first, in order, before the stand-in answers.
 * Folders, search and multipart uploads are not emulated: enqueue responses for them.
 */
final class MockServerClient
{
    public const OUTCOMES = ['pending', 'allowed', 'age-restricted', 'blocked', 'purged', 'failed'];

    /** @var array<string, array> Assets by ID, with the API's field names. Change them to arrange a test. */
    public array $assets = [];
    /** @var array<string, array{type: string, bytes: string}> Stored content by asset ID. */
    public array $content = [];
    /** @var list<array> The events feed, oldest first. */
    public array $events = [];
    /** @var array<string, array> Lenses by identifier. */
    public array $lenses = [];

    private ServerClient $client;
    private array $queue = [];
    private array $history = [];
    private \Closure $now;
    private \Closure $createId;
    private mixed $analyzedOutcome;
    private string $baseUrl;
    private string $cdnBaseUrl;

    /**
     * @param string $queuedOutcome outcome of `assets.create`: `pending` (still processing),
     *   `allowed`, `age-restricted`, `blocked` or `purged`, or `failed` (processing failed, retryable).
     * @param string|array|callable $analyzedOutcome outcome of `assets.classify` and `text.classify`:
     *   an outcome, fields to deep-merge into the asset (the outcome then follows their
     *   `classification.moderation.status`), or a callable that receives the asset and returns either.
     * @param bool $downloadPermission whether CDN requests may read private and age-restricted content.
     */
    public function __construct(
        public readonly string $projectId = 'project-1',
        private string $queuedOutcome = 'pending',
        string|array|callable $analyzedOutcome = 'allowed',
        ?callable $now = null,
        ?callable $createId = null,
        public bool $downloadPermission = true,
        string $baseUrl = 'https://api.calmlens.invalid/v1',
        string $cdnBaseUrl = 'https://cdn.calmlens.invalid/v1',
    ) {
        self::checkOutcome($queuedOutcome);
        if (is_string($analyzedOutcome)) {
            self::checkOutcome($analyzedOutcome);
        }
        $this->analyzedOutcome = $analyzedOutcome;
        $this->now = \Closure::fromCallable($now ?? fn (): int => (int) floor(microtime(true) * 1000));
        $this->createId = \Closure::fromCallable($createId ?? fn (): string => \CalmLens\Internal\Values::uuid());
        $stack = HandlerStack::create(fn (RequestInterface $request, array $options) => $this->handle($request));
        $this->client = new ServerClient('mock-key', $projectId, $baseUrl, $cdnBaseUrl, maxRetries: 0,
            httpClient: new Client(['handler' => $stack]));
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->cdnBaseUrl = rtrim($cdnBaseUrl, '/');
    }

    public function client(): ServerClient { return $this->client; }

    public function enqueueJson(mixed $body, int $status = 200, array $headers = []): self
    {
        return $this->enqueue(new Response($status, $headers + ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR)));
    }

    public function enqueue(ResponseInterface|\Throwable $response): self
    {
        $this->queue[] = $response;
        return $this;
    }

    /** Queued responses and exceptions not used yet. */
    public function pending(): int { return count($this->queue); }

    /** @return list<RequestInterface> every request received, oldest first, with readable bodies. */
    public function requests(): array { return $this->history; }

    /**
     * Adds an event to the feed returned by `events.list`. Omitted `id`, `projectId`, `createdAt`
     * and `facts` are filled in.
     */
    public function enqueueEvent(array $event): array
    {
        $now = ($this->now)();
        $event += ['id' => ($this->createId)(), 'projectId' => $this->projectId, 'severity' => 'low',
            'title' => $event['type'] ?? '', 'assetId' => null, 'asset' => null, 'facts' => [], 'createdAt' => $now];
        $this->events[] = $event;
        return $event;
    }

    /**
     * Gives an asset a new outcome, as a reviewer would, and adds the matching `asset.<status>`
     * (or `asset.failed`) event with the asset's snapshot and a `decided-by: reviewer` fact.
     */
    public function decide(string $assetId, string $outcome): array
    {
        self::checkOutcome($outcome);
        if (!isset($this->assets[$assetId])) {
            throw new \InvalidArgumentException("No mock asset $assetId");
        }
        $asset = $this->applyOutcome($this->assets[$assetId], $outcome);
        if ($outcome !== 'pending') {
            $this->enqueueEvent(['type' => 'asset.' . $outcome, 'assetId' => $assetId, 'asset' => [
                'id' => $assetId, 'externalId' => $asset['externalId'], 'uploadPresetId' => $asset['uploadPresetId'],
                'upload' => ['status' => $asset['upload']['status']], 'content' => ['status' => $asset['content']['status']],
                'classification' => ['status' => $asset['classification']['status'], 'moderation' => ['status' => $asset['classification']['moderation']['status']]],
            ], 'facts' => [['key' => 'decided-by', 'value' => 'reviewer']]]);
        }
        return $asset;
    }

    private static function checkOutcome(string $outcome): void
    {
        if (!in_array($outcome, self::OUTCOMES, true)) {
            throw new \InvalidArgumentException('Mock outcomes are ' . implode(', ', self::OUTCOMES) . " (got $outcome)");
        }
    }

    private function handle(RequestInterface $request): PromiseInterface
    {
        $body = (string) $request->getBody();
        $request = $request->withBody(\GuzzleHttp\Psr7\Utils::streamFor($body));
        $this->history[] = $request;
        $queued = array_shift($this->queue);
        if ($queued instanceof \Throwable) {
            return Create::rejectionFor($queued);
        }
        if ($queued !== null) {
            return Create::promiseFor($queued);
        }
        $url = (string) $request->getUri()->withQuery('');
        parse_str($request->getUri()->getQuery(), $query);
        try {
            if (str_starts_with($url, $this->cdnBaseUrl . '/')) {
                return Create::promiseFor($this->serve($request->getMethod(), substr($url, strlen($this->cdnBaseUrl)), $query));
            }
            $json = $request->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : [];
            $data = $this->api($request, substr($url, strlen($this->baseUrl)), $query, $json ?? [], $body);
            return Create::promiseFor($data === null ? new Response(204) : self::json(200, $data));
        } catch (CalmLensException $failure) {
            // Raised by fail(): answer like the API does.
            return Create::promiseFor(self::json($failure->status, ['code' => $failure->errorCode, 'message' => $failure->getMessage()]));
        }
    }

    private static function fail(string $code, int $status, string $message = ''): never
    {
        throw new CalmLensException($code, $message, $status);
    }

    private static function json(int $status, mixed $data): Response
    {
        return new Response($status, ['Content-Type' => 'application/json', 'X-Request-Id' => 'mock-' . bin2hex(random_bytes(4))],
            json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    private function api(RequestInterface $request, string $path, array $query, array $json, string $body): ?array
    {
        $parts = array_map('rawurldecode', array_values(array_filter(explode('/', $path), fn ($part) => $part !== '')));
        $method = $request->getMethod();
        if (($parts[0] ?? null) === 'projects') {
            if (($parts[1] ?? null) !== $this->projectId) {
                self::fail('auth/project-mismatch', 403);
            }
            $route = $method . ' ' . implode('/', array_slice($parts, 2));
            $upload = $request->getHeaderLine('X-CalmLens-Upload');
            return match (true) {
                $route === 'GET events' => $this->listEvents($query),
                $route === 'PUT lenses' => $this->saveLenses($json['lenses'] ?? []),
                $route === 'GET assets/page' => $this->page($query),
                $route === 'POST assets' && $upload === '' => $this->createAsset($json, ($query['queue'] ?? '') === 'true', null),
                $route === 'POST assets' && $upload === 'content' => $this->createAsset($query, ($query['queue'] ?? '') === 'true', $body),
                default => throw new \LogicException("MockServerClient does not emulate $route; enqueue a response for it"),
            };
        }
        if (($parts[0] ?? null) !== 'assets' || !isset($parts[1])) {
            throw new \LogicException("MockServerClient does not emulate $method $path; enqueue a response for it");
        }
        $id = $parts[1];
        $asset = $this->assets[$id] ?? self::fail('asset/not-found', 404, 'Asset not found');
        $route = $method . ' ' . ($parts[2] ?? '');
        switch ($route) {
            case 'GET ':
                return $asset;
            case 'PATCH ':
                $fields = array_diff_key($json, array_flip(['id', 'projectId', 'upload', 'classification', 'content']));
                return $this->assets[$id] = $this->touch($fields + $asset);
            case 'DELETE ':
                unset($this->assets[$id], $this->content[$id]);
                return null;
            case 'DELETE content':
                if ($asset['content']['status'] !== 'removed') {
                    $asset = $this->removeContent($asset, 'requested');
                }
                return $this->assets[$id] = $this->touch($asset);
            case 'POST retry':
                if ($asset['classification']['status'] !== 'failed') {
                    self::fail('asset/not-retryable', 409);
                }
                return $this->applyOutcome($asset, 'pending');
            case 'POST move':
                return $this->assets[$id] = $this->touch(['folderId' => $json['folderId'] ?? null] + $asset);
            case 'POST signed-url':
                $expires = $json['expiresInSeconds'] ?? 900;
                $params = http_build_query(array_intersect_key($json, array_flip(['lens', 'transform'])) + ['expires' => $expires]);
                return ['url' => $this->cdnBaseUrl . '/signed/' . rawurlencode($id) . '/' . ($json['resource'] ?? 'content') . '?' . $params,
                    'expiresAt' => ($this->now)() + $expires * 1000];
        }
        throw new \LogicException("MockServerClient does not emulate $route for an asset; enqueue a response for it");
    }

    private function createAsset(array $options, bool $queue, ?string $bytes): array
    {
        foreach ($this->assets as $existing) {
            if (isset($options['externalId']) && ($existing['externalId'] ?? null) === $options['externalId']) {
                self::fail('asset/duplicate-external-id', 409);
            }
        }
        $now = ($this->now)();
        $mime = (string) ($options['contentType'] ?? '');
        $processing = is_string($options['processingOptions'] ?? null) ? json_decode($options['processingOptions'], true) : ($options['processingOptions'] ?? null);
        $metadata = is_string($options['metadata'] ?? null) ? json_decode($options['metadata'], true) : ($options['metadata'] ?? null);
        $keep = is_array($processing) && ($processing['keepContentAfterProcessing'] ?? false) === true;
        $url = $bytes === null ? ($options['url'] ?? null) : null;
        $asset = [
            'id' => ($this->createId)(), 'projectId' => $this->projectId, 'folderId' => $options['folderId'] ?? null,
            'parentId' => null, 'name' => $options['name'] ?? null, 'description' => $options['description'] ?? null,
            'externalId' => $options['externalId'] ?? null, 'externalUrl' => $url ?? ($options['externalUrl'] ?? null),
            'uploadPresetId' => $options['uploadPresetId'] ?? null, 'metadata' => $metadata, 'processingOptions' => $processing,
            'type' => self::kind($mime, $url), 'visibility' => $options['visibility'] ?? 'private',
            'createdAt' => $now, 'updatedAt' => $now,
            'upload' => ['status' => 'completed', 'updatedAt' => $now, 'partsReceived' => null],
            'classification' => ['status' => 'processing', 'updatedAt' => $now, 'completedAt' => null,
                'moderation' => ['status' => 'pending', 'manualReviews' => []]],
            'content' => ['status' => $keep ? 'stored' : 'temporary', 'removalReason' => null, 'updatedAt' => $now,
                'format' => $mime === '' ? null : $mime, 'sizeInBytes' => $bytes === null ? null : strlen($bytes), 'extractedText' => null],
        ];
        $this->assets[$asset['id']] = $asset;
        if ($bytes !== null) {
            $this->content[$asset['id']] = ['type' => $mime, 'bytes' => $bytes];
        }
        if ($queue) {
            return $this->applyOutcome($asset, $this->queuedOutcome);
        }
        $outcome = is_callable($this->analyzedOutcome) ? ($this->analyzedOutcome)($asset) : $this->analyzedOutcome;
        if (!is_array($outcome)) {
            self::checkOutcome($outcome);
            return $this->applyOutcome($asset, $outcome);
        }
        $status = ($outcome['classification']['status'] ?? null) === 'failed' ? 'failed' : ($outcome['classification']['moderation']['status'] ?? 'allowed');
        self::checkOutcome($status);
        return $this->assets[$asset['id']] = array_replace_recursive($this->applyOutcome($asset, $status), $outcome);
    }

    /** Moves an asset to an outcome like the pipeline would, and stores it. */
    private function applyOutcome(array $asset, string $outcome): array
    {
        $now = ($this->now)();
        $decided = !in_array($outcome, ['pending', 'failed'], true);
        $asset['classification'] = ['status' => $decided ? 'completed' : ($outcome === 'failed' ? 'failed' : 'processing'),
            'updatedAt' => $now, 'completedAt' => $decided ? $now : null] + $asset['classification'];
        $asset['classification']['moderation']['status'] = $decided ? $outcome : 'pending';
        if ($outcome === 'purged' && $asset['content']['status'] !== 'removed') {
            $asset = $this->removeContent($asset, 'policy');
        } elseif ($decided && $asset['content']['status'] === 'temporary') {
            $asset = $this->removeContent($asset, 'retention');
        }
        $asset['updatedAt'] = $now;
        return $this->assets[$asset['id']] = $asset;
    }

    private function removeContent(array $asset, string $reason): array
    {
        unset($this->content[$asset['id']]);
        $asset['content'] = ['status' => 'removed', 'removalReason' => $reason, 'updatedAt' => ($this->now)(), 'extractedText' => null] + $asset['content'];
        return $asset;
    }

    private function touch(array $asset): array
    {
        $asset['updatedAt'] = ($this->now)();
        return $asset;
    }

    private static function kind(string $mime, ?string $url): string
    {
        return match (true) {
            $url !== null => 'website',
            (bool) preg_match('#^(image|video|audio)/#', $mime) => explode('/', $mime)[0],
            str_starts_with($mime, 'text/') => 'plaintext-document',
            default => 'file',
        };
    }

    /** Newest first, filtered by `field==value` terms joined with `;`. The cursor is an offset. */
    private function page(array $query): array
    {
        $items = array_values(array_filter($this->assets, fn ($asset) => $asset['parentId'] === null));
        foreach (array_filter(explode(';', (string) ($query['filter'] ?? ''))) as $term) {
            if (!preg_match('/^([\w.]+)(==|!=)(.+)$/', $term, $match)) {
                throw new \LogicException("MockServerClient filters support only == and != joined with ; (got $term)");
            }
            $items = array_values(array_filter($items, function ($asset) use ($match) {
                $value = $asset;
                foreach (explode('.', $match[1]) as $key) {
                    $value = is_array($value) ? ($value[$key] ?? null) : null;
                }
                return ((string) ($value ?? 'null') === trim($match[3], '"\'')) === ($match[2] === '==');
            }));
        }
        usort($items, fn ($a, $b) => [$b['createdAt'], $b['id']] <=> [$a['createdAt'], $a['id']]);
        $size = (int) ($query['pageSize'] ?? 10);
        $offset = isset($query['cursor']) ? (int) base64_decode($query['cursor']) : 0;
        $more = count($items) > $offset + $size;
        return ['items' => array_slice($items, $offset, $size), 'nextCursor' => $more ? base64_encode((string) ($offset + $size)) : null,
            'pageSize' => $size, 'hasMore' => $more];
    }

    /** Without `after` the feed starts from now, like the API. */
    private function listEvents(array $query): array
    {
        if (!isset($query['after'])) {
            return ['events' => [], 'cursor' => 'mock_' . count($this->events), 'hasMore' => false];
        }
        if (!preg_match('/^mock_(\d+)$/', $query['after'], $match)) {
            self::fail('events/invalid-cursor', 400);
        }
        $limit = (int) ($query['limit'] ?? 50);
        $taken = array_slice($this->events, (int) $match[1], $limit);
        $next = (int) $match[1] + count($taken);
        return ['events' => $taken, 'cursor' => 'mock_' . $next, 'hasMore' => $next < count($this->events)];
    }

    private function saveLenses(array $definitions): array
    {
        $now = ($this->now)();
        $saved = [];
        foreach ($definitions as $definition) {
            $old = $this->lenses[$definition['identifier']] ?? null;
            if ($old !== null && ($definition['version'] ?? 0) < ($old['version'] ?? 0)) {
                self::fail('lens/version-conflict', 409);
            }
            $saved[] = $this->lenses[$definition['identifier']] = $definition + ['id' => $old['id'] ?? ($this->createId)(),
                'projectId' => $this->projectId, 'createdAt' => $old['createdAt'] ?? $now, 'updatedAt' => $now];
        }
        return ['lenses' => $saved];
    }

    private function serve(string $method, string $path, array $query): Response
    {
        $segments = array_map('rawurldecode', array_values(array_filter(explode('/', $path), fn ($part) => $part !== '')));
        [, $project, $identifier, $resource] = $segments + [null, null, null, null];
        $asset = null;
        foreach ($this->assets as $candidate) {
            if ($candidate['id'] === $identifier || ($candidate['externalId'] ?? null) === $identifier) {
                $asset = $candidate;
            }
        }
        if ($project !== $this->projectId || $asset === null || !in_array($resource, ['content', 'preview'], true)) {
            return self::json(404, ['code' => 'asset/not-found', 'message' => 'Asset not found']);
        }
        $status = $asset['classification']['moderation']['status'];
        if ($status === 'blocked') {
            return self::json(403, ['code' => 'asset/not-available', 'message' => 'Asset is not available']);
        }
        // Age-restricted assets are delivered like private ones, unless a public one is requested
        // with `ageRestricted=true`.
        $ageRestricted = $status === 'age-restricted';
        $private = $asset['visibility'] !== 'public' || ($ageRestricted && ($query['ageRestricted'] ?? null) !== 'true');
        if ($private && !$this->downloadPermission) {
            return self::json(403, ['code' => 'asset/api-key-missing-permission', 'message' => 'The API key cannot download this asset']);
        }
        $stored = $this->content[$asset['id']] ?? null;
        if ($stored === null) {
            return self::json(404, ['code' => 'asset/not-found', 'message' => 'Asset content not found']);
        }
        return new Response(200, ['Content-Type' => $stored['type'], 'Content-Length' => (string) strlen($stored['bytes']),
            'Cache-Control' => $private || $ageRestricted ? 'private, no-store' : 'public, max-age=31536000'],
            $method === 'HEAD' ? '' : $stored['bytes']);
    }
}
