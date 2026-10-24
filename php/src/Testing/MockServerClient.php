<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\CalmLensException;
use CalmLens\ErrorCodes;
use CalmLens\Internal\Session;
use CalmLens\Internal\Values;
use CalmLens\ServerClient;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Promise\PromiseInterface;
use GuzzleHttp\Psr7\Response;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * An offline CalmLens for tests. Calls run the real client's validation, encoding, retries and
 * error handling, then reach an in-memory stand-in for the API and CDN instead of the network.
 *
 * The stand-in is stateful: uploads (including multipart uploads) create assets you can
 * retrieve, list, search, update, move and delete; folders, lenses, idempotency keys and the
 * events feed behave like the API's; the CDN serves stored bytes; and errors use the API's
 * codes, statuses, `X-Request-Id` header and body shape. It does not classify content: assets
 * submitted with `classify` get `analyzedOutcome` and those submitted with `create` get
 * `queuedOutcome`. Content is kept only with `keepContentAfterProcessing: true`; otherwise it is
 * removed once classification completes, as in the API. A `purged` outcome removes the content
 * with reason `policy`.
 *
 * Like the CDN, it checks delivery first: blocked, purged and failed assets, and assets whose
 * content was removed or is still uploading, return 403 `asset/not-available` whatever the key.
 * Then access: a private asset, or a public age-restricted one requested without the
 * `allowAgeRestricted` URL option, needs an `assets:download` grant for its folder. The default
 * key has no grants, like a real key without `assets:download`; pass an `apiKey` from
 * `createApiKey()` to grant downloads.
 *
 * Waits (retry backoff and `assets->waitForDecision`) take no real time: they advance a virtual
 * clock, so a decision that never comes times out at once.
 *
 * Enqueued responses, exceptions and `failNextRequest` failures are used first, in order,
 * before the stand-in answers.
 */
final class MockServerClient
{
    public const OUTCOMES = ['pending', 'allowed', 'age-restricted', 'blocked', 'purged', 'failed'];
    private const MIB = 1024 * 1024;

    /** @var array<string, array> Assets by ID, with the API's field names. Change them to arrange a test. */
    public array $assets = [];
    /** @var array<string, array{type: string, bytes: string}> Stored content by asset ID. */
    public array $content = [];
    /** @var array<string, array> Folders by ID. */
    public array $folders = [];
    /** @var list<array> The events feed, oldest first. */
    public array $events = [];
    /** @var array<string, array> Lenses by identifier. */
    public array $lenses = [];

    private ServerClient $client;
    private array $queue = [];
    private array $history = [];
    /** @var array<string, array{0: string, 1: int, 2: string}> Saved responses by idempotency key. */
    private array $idempotent = [];
    /** @var array<string, array{queue: bool, total: ?int, image: bool, parts: int}> Open multipart uploads. */
    private array $uploads = [];
    private array $grants;
    private float $elapsed = 0.0;
    private \Closure $now;
    private \Closure $createId;
    private mixed $analyzedOutcome;
    private string $baseUrl;
    private string $cdnBaseUrl;

    /**
     * @param string $queuedOutcome outcome of `assets.create` (and queued multipart uploads):
     *   `pending` (still processing), `allowed`, `age-restricted`, `blocked` or `purged`, or
     *   `failed` (processing failed, retryable).
     * @param string|array|callable $analyzedOutcome outcome of `assets.classify` and `text.classify`:
     *   an outcome, fields to deep-merge into the asset (the outcome then follows their
     *   `classification.moderation.status`), or a callable that receives the asset and returns either.
     * @param ?string $apiKey the client's API key. Its grants, from `createApiKey()`, decide CDN
     *   downloads of private and age-restricted content; the default key has none.
     * @param int $maxRetries retries for the mock's client; 0 by default so enqueued failures surface.
     */
    public function __construct(
        public readonly string $projectId = 'project-1',
        private string $queuedOutcome = 'pending',
        string|array|callable $analyzedOutcome = 'allowed',
        ?callable $now = null,
        ?callable $createId = null,
        string $baseUrl = 'https://api.calmlens.invalid/v1',
        string $cdnBaseUrl = 'https://cdn.calmlens.invalid/v1',
        #[\SensitiveParameter] ?string $apiKey = null,
        int $maxRetries = 0,
    ) {
        self::checkOutcome($queuedOutcome);
        if (is_string($analyzedOutcome)) {
            self::checkOutcome($analyzedOutcome);
        }
        $this->analyzedOutcome = $analyzedOutcome;
        $this->now = \Closure::fromCallable($now ?? fn (): int => (int) floor(microtime(true) * 1000));
        $this->createId = \Closure::fromCallable($createId ?? fn (): string => Values::uuid());
        $this->grants = $apiKey === null ? [] : self::grantsOf($apiKey);
        $stack = HandlerStack::create(fn (RequestInterface $request, array $options) => $this->handle($request));
        $this->client = new ServerClient($apiKey ?? 'mock-key', $projectId, $baseUrl, $cdnBaseUrl, maxRetries: $maxRetries,
            httpClient: new Client(['handler' => $stack]));
        $session = (fn (): Session => $this->session)->call($this->client);
        $session->sleep = function (float $seconds): void { $this->elapsed += $seconds; };
        $session->clock = fn (): float => $this->elapsed;
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->cdnBaseUrl = rtrim($cdnBaseUrl, '/');
    }

    public function __debugInfo(): array { return ['projectId' => $this->projectId]; }

    public function client(): ServerClient { return $this->client; }

    /**
     * A fake API key carrying CDN download grants, such as
     * `[['actions' => ['assets:download'], 'folderId' => null, 'includeSubfolders' => true]]`.
     * A `folderId` limits a grant to that folder (and, with `includeSubfolders`, its subfolders).
     */
    public static function createApiKey(array $grants = []): string
    {
        return 'sk_test_' . rtrim(strtr(base64_encode(Values::json($grants)), '+/', '-_'), '=');
    }

    public function enqueueJson(mixed $body, int $status = 200, array $headers = []): self
    {
        return $this->enqueue(new Response($status, $headers + ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR)));
    }

    public function enqueue(ResponseInterface|\Throwable $response): self
    {
        $this->queue[] = $response;
        return $this;
    }

    /**
     * Fails the next request instead of answering it, leaving the stored state unchanged.
     * `transport-error` and `timeout` fail the connection, so the client throws
     * `ConnectionException` (`sdk/transport-error`) or `TimeoutException` (`sdk/timeout`). A
     * `CalmLensException` is answered as the API's error response: its status (or the API's
     * status for its code), a JSON `{code, message, details}` body and its headers (such as
     * `Retry-After`). Any other exception is thrown by the transport as given.
     */
    public function failNextRequest(string|\Throwable $failure = 'transport-error'): self
    {
        if (is_string($failure) && !in_array($failure, ['transport-error', 'timeout'], true)) {
            throw new \InvalidArgumentException("Mock failures are transport-error, timeout or an exception (got $failure)");
        }
        $this->queue[] = ['failure' => $failure];
        return $this;
    }

    /** Queued responses and failures not used yet. */
    public function pending(): int { return count($this->queue); }

    /** @return list<RequestInterface> every request received, oldest first, with readable bodies. */
    public function requests(): array { return $this->history; }

    /**
     * Adds an event to the feed returned by `events.list`. Omitted `id`, `projectId`, `createdAt`
     * and `facts` are filled in; when `assetId` names a stored asset, the event carries a snapshot
     * of its status, as the API's events do. Pass the result to `Webhooks::toPayload` to build a
     * matching webhook body.
     */
    public function enqueueEvent(array $event): array
    {
        $now = ($this->now)();
        $assetId = $event['assetId'] ?? null;
        $event += ['id' => ($this->createId)(), 'projectId' => $this->projectId, 'severity' => 'low',
            'title' => $event['type'] ?? '', 'description' => null, 'assetId' => null,
            'asset' => is_string($assetId) && isset($this->assets[$assetId]) ? $this->snapshot($this->assets[$assetId]) : null,
            'facts' => [], 'createdAt' => $now, 'updatedAt' => $now];
        $this->events[] = $event;
        return $event;
    }

    /**
     * Gives an asset a new outcome, as a reviewer would, and adds the matching `asset.<status>`
     * (or `asset.failed`) event with the asset's snapshot, the event catalog's severity (`low` for
     * `allowed`, `high` otherwise) and a `decided-by: reviewer` fact.
     */
    public function decide(string $assetId, string $outcome): array
    {
        self::checkOutcome($outcome);
        if (!isset($this->assets[$assetId])) {
            throw new \InvalidArgumentException("No mock asset $assetId");
        }
        $asset = $this->applyOutcome($this->assets[$assetId], $outcome);
        if ($outcome !== 'pending') {
            $this->enqueueEvent(['type' => 'asset.' . $outcome, 'assetId' => $assetId, 'severity' => $outcome === 'allowed' ? 'low' : 'high',
                'facts' => [['key' => 'decided-by', 'value' => 'reviewer']]]);
        }
        return $asset;
    }

    private function snapshot(array $asset): array
    {
        return ['id' => $asset['id'], 'externalId' => $asset['externalId'] ?? null, 'uploadPresetId' => $asset['uploadPresetId'] ?? null,
            'upload' => ['status' => $asset['upload']['status']], 'content' => ['status' => $asset['content']['status']],
            'classification' => ['status' => $asset['classification']['status'], 'moderation' => ['status' => $asset['classification']['moderation']['status']]]];
    }

    private static function checkOutcome(string $outcome): void
    {
        if (!in_array($outcome, self::OUTCOMES, true)) {
            throw new \InvalidArgumentException('Mock outcomes are ' . implode(', ', self::OUTCOMES) . " (got $outcome)");
        }
    }

    private static function grantsOf(string $apiKey): array
    {
        if (!str_starts_with($apiKey, 'sk_test_')) {
            return [];
        }
        $grants = json_decode((string) base64_decode(strtr(substr($apiKey, 8), '-_', '+/'), true), true);
        return is_array($grants) && array_is_list($grants) ? $grants : [];
    }

    private function handle(RequestInterface $request): PromiseInterface
    {
        $body = (string) $request->getBody();
        $request = $request->withBody(\GuzzleHttp\Psr7\Utils::streamFor($body));
        $this->history[] = $request;
        $queued = array_shift($this->queue);
        if (is_array($queued)) {
            $failure = $queued['failure'];
            if ($failure instanceof CalmLensException) {
                $status = $failure->status ?? ErrorCodes::STATUSES[$failure->errorCode] ?? 400;
                return Create::promiseFor(self::json($status, ['code' => $failure->errorCode, 'message' => $failure->getMessage()]
                    + ($failure->details === [] ? [] : ['details' => $failure->details]), $failure->headers));
            }
            $queued = is_string($failure)
                ? new ConnectException($failure === 'timeout' ? 'Simulated timeout' : 'Simulated network failure', $request, null,
                    $failure === 'timeout' ? ['errno' => 28] : [])
                : $failure;
        }
        if ($queued instanceof \Throwable) {
            return Create::rejectionFor($queued);
        }
        if ($queued !== null) {
            return Create::promiseFor($queued);
        }
        $url = (string) $request->getUri()->withQuery('');
        parse_str($request->getUri()->getQuery(), $query);
        if (str_starts_with($url, $this->cdnBaseUrl . '/')) {
            return Create::promiseFor($this->serve($request->getMethod(), substr($url, strlen($this->cdnBaseUrl)), $query));
        }
        $path = substr($url, strlen($this->baseUrl));
        $key = $request->getHeaderLine('Idempotency-Key');
        $fingerprint = hash('sha256', Values::json([$request->getMethod(), $path, $request->getUri()->getQuery(), base64_encode($body)]));
        if ($key !== '' && isset($this->idempotent[$key])) {
            [$saved, $status, $bytes] = $this->idempotent[$key];
            return Create::promiseFor($saved !== $fingerprint
                ? self::json(ErrorCodes::STATUSES[ErrorCodes::IDEMPOTENCY_KEY_REUSED], ['code' => ErrorCodes::IDEMPOTENCY_KEY_REUSED, 'message' => 'Idempotency key reused with a different request'])
                : new Response($status, ['Content-Type' => 'application/json', 'Idempotent-Replayed' => 'true', 'X-Request-Id' => self::requestId()], $bytes));
        }
        try {
            $json = $request->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : [];
            $data = $this->api($request, $path, $query, is_array($json) ? $json : [], $body);
            $response = $data === null ? new Response(204, ['X-Request-Id' => self::requestId()]) : self::json(200, $data);
        } catch (CalmLensException $failure) {
            // Raised by fail(): answer like the API does, and leave the key unsaved.
            return Create::promiseFor(self::json($failure->status, ['code' => $failure->errorCode, 'message' => $failure->getMessage()]));
        }
        if ($key !== '') {
            $this->idempotent[$key] = [$fingerprint, $response->getStatusCode(), (string) $response->getBody()];
            $response->getBody()->rewind();
        }
        return Create::promiseFor($response);
    }

    private static function fail(string $code, ?int $status = null, string $message = ''): never
    {
        throw new CalmLensException($code, $message, $status ?? ErrorCodes::STATUSES[$code] ?? 400);
    }

    private static function requestId(): string { return 'mock-' . bin2hex(random_bytes(4)); }

    private static function json(int $status, mixed $data, array $headers = []): Response
    {
        return new Response($status, ['Content-Type' => 'application/json', 'X-Request-Id' => self::requestId()] + $headers,
            json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    private function api(RequestInterface $request, string $path, array $query, array $json, string $body): ?array
    {
        $parts = array_map('rawurldecode', array_values(array_filter(explode('/', $path), fn ($part) => $part !== '')));
        $method = $request->getMethod();
        $upload = $request->getHeaderLine('X-CalmLens-Upload');
        if (($parts[0] ?? null) === 'projects') {
            if (($parts[1] ?? null) !== $this->projectId) {
                self::fail(ErrorCodes::API_KEY_PROJECT_MISMATCH);
            }
            $route = $method . ' ' . implode('/', array_slice($parts, 2));
            return match (true) {
                $route === 'GET events' => $this->listEvents($query),
                $route === 'PUT lenses' => $this->saveLenses($json['lenses'] ?? []),
                $route === 'GET folders' => $this->listFolders($query),
                $route === 'POST folders' => $this->createFolder($json),
                $route === 'GET assets/page' => $this->page(array_filter($this->assets, fn ($asset) => $asset['parentId'] === null
                    && (!isset($query['folderId']) || $asset['folderId'] === $this->folder($query['folderId'])['id'])), $query),
                $route === 'GET assets/search' => $this->search($query),
                $route === 'POST assets' && $upload === '' => $this->createAsset($json, self::flag($query['queue'] ?? null), null, false),
                $route === 'POST assets' && in_array($upload, ['content', 'part'], true) => $this->createAsset($query, self::flag($query['queue'] ?? null), $body, $upload === 'part'),
                default => throw new \LogicException("MockServerClient does not emulate $route; enqueue a response for it"),
            };
        }
        if (($parts[0] ?? null) === 'folders' && isset($parts[1])) {
            return $this->folderRoute($method, $parts[1], $parts[2] ?? '', $json);
        }
        if (($parts[0] ?? null) !== 'assets' || !isset($parts[1])) {
            throw new \LogicException("MockServerClient does not emulate $method $path; enqueue a response for it");
        }
        $id = $parts[1];
        $asset = $this->assets[$id] ?? self::fail(ErrorCodes::ASSET_NOT_FOUND, null, 'Asset not found');
        $route = $method . ' ' . ($parts[2] ?? '');
        switch ($route) {
            case 'GET ':
                return $asset;
            case 'GET children':
                return $this->page(array_filter($this->assets, fn ($child) => $child['parentId'] === $id), $query);
            case 'PATCH ':
                $fields = array_diff_key($json, array_flip(['id', 'projectId', 'upload', 'classification', 'content']));
                return $this->assets[$id] = $this->touch($fields + $asset);
            case 'DELETE ':
                unset($this->assets[$id], $this->content[$id], $this->uploads[$id]);
                return null;
            case 'DELETE content':
                if ($asset['content']['status'] !== 'removed') {
                    $asset = $this->removeContent($asset, 'requested');
                }
                return $this->assets[$id] = $this->touch($asset);
            case 'POST retry':
                if ($asset['classification']['status'] !== 'failed') {
                    self::fail(ErrorCodes::ASSET_NOT_RETRYABLE);
                }
                if ($asset['content']['status'] === 'removed') {
                    self::fail(ErrorCodes::ASSET_CONTENT_UNAVAILABLE);
                }
                return $this->applyOutcome($asset, 'pending');
            case 'POST explain':
                if ($asset['classification']['status'] !== 'completed') {
                    self::fail(ErrorCodes::ASSET_NOT_DECIDED);
                }
                if (empty($json['rerun'])) {
                    // Like the API: the evidence is completed and every action stays as decided.
                    if (($asset['classification']['moderation']['policy']['evidence'] ?? null) === 'decision') {
                        $asset['classification']['moderation']['policy']['evidence'] = 'full';
                    }
                    return $this->assets[$id] = $this->touch($asset);
                }
                if (($asset['classification']['moderation']['manualReviews'] ?? []) !== []) {
                    self::fail(ErrorCodes::ASSET_REVIEWED);
                }
                if ($asset['content']['status'] === 'removed') {
                    self::fail(ErrorCodes::ASSET_CONTENT_UNAVAILABLE);
                }
                // Like the API: back to processing, to be moderated again under the current policy.
                return $this->applyOutcome($asset, 'pending');
            case 'POST move':
                $folderId = $json['folderId'] ?? null;
                if ($folderId !== null) {
                    $this->folder($folderId);
                }
                return $this->assets[$id] = $this->touch(['folderId' => $folderId] + $asset);
            case 'POST part':
                return $this->uploadPart($asset, $query, $body);
            case 'POST signed-url':
                $expires = $json['expiresInSeconds'] ?? 900;
                $params = http_build_query(array_intersect_key($json, array_flip(['lens', 'transform'])) + ['expires' => $expires]);
                return ['url' => $this->cdnBaseUrl . '/signed/' . rawurlencode($id) . '/' . ($json['resource'] ?? 'rendered') . '?' . $params,
                    'expiresAt' => ($this->now)() + $expires * 1000];
        }
        throw new \LogicException("MockServerClient does not emulate $route for an asset; enqueue a response for it");
    }

    private static function flag(mixed $value): bool { return $value === 'true' || $value === true; }

    private function createAsset(array $options, bool $queue, ?string $bytes, bool $multipart): array
    {
        if (isset($options['externalId'])) {
            foreach ($this->assets as $existing) {
                if (($existing['externalId'] ?? null) === $options['externalId']) {
                    self::fail(ErrorCodes::DUPLICATE_EXTERNAL_ID);
                }
            }
        }
        if (isset($options['folderId'])) {
            $this->folder($options['folderId']);
        }
        $now = ($this->now)();
        $mime = (string) ($options['contentType'] ?? '');
        $processing = is_string($options['processingOptions'] ?? null) ? json_decode($options['processingOptions'], true) : ($options['processingOptions'] ?? null);
        $metadata = is_string($options['metadata'] ?? null) ? json_decode($options['metadata'], true) : ($options['metadata'] ?? null);
        $keep = is_array($processing) && ($processing['keepContentAfterProcessing'] ?? false) === true;
        $url = $bytes === null ? ($options['url'] ?? null) : null;
        $kind = self::kind($mime, $url);
        $total = isset($options['totalSizeInBytes']) ? (int) $options['totalSizeInBytes'] : null;
        if ($multipart && $kind === 'image' && $total !== null) {
            if ($total > 20 * self::MIB) {
                self::fail(ErrorCodes::MULTIPART_IMAGE_TOO_LARGE);
            }
            if ($total < 10 * self::MIB) {
                self::fail(ErrorCodes::MULTIPART_IMAGE_TOO_SMALL);
            }
        }
        $final = !$multipart || self::flag($options['isFinal'] ?? null);
        $asset = [
            'id' => ($this->createId)(), 'projectId' => $this->projectId, 'folderId' => $options['folderId'] ?? null,
            'parentId' => null, 'name' => $options['name'] ?? null, 'description' => $options['description'] ?? null,
            'externalId' => $options['externalId'] ?? null, 'externalUrl' => $url ?? ($options['externalUrl'] ?? null),
            'uploadPresetId' => $options['uploadPresetId'] ?? null, 'metadata' => $metadata, 'processingOptions' => $processing,
            'type' => $kind, 'visibility' => $options['visibility'] ?? 'private',
            'createdAt' => $now, 'updatedAt' => $now,
            'upload' => ['status' => $final ? 'completed' : 'uploading', 'updatedAt' => $now, 'partsReceived' => $multipart ? 1 : null],
            'classification' => ['status' => $final ? 'processing' : 'pending', 'updatedAt' => $now, 'completedAt' => null,
                'moderation' => ['status' => 'pending', 'manualReviews' => []]],
            'content' => ['status' => $keep ? 'stored' : 'temporary', 'removalReason' => null, 'updatedAt' => $now,
                'format' => $mime === '' ? null : $mime, 'sizeInBytes' => $bytes === null ? null : strlen($bytes), 'extractedText' => null],
        ];
        $this->assets[$asset['id']] = $asset;
        if ($bytes !== null) {
            $this->content[$asset['id']] = ['type' => $mime, 'bytes' => $bytes];
        }
        if (!$final) {
            $this->uploads[$asset['id']] = ['queue' => $queue, 'total' => $total, 'image' => $kind === 'image', 'parts' => 1];
            return $asset;
        }
        return $this->finish($asset, $queue);
    }

    /** Applies the queued or analyzed outcome to an asset whose upload is complete. */
    private function finish(array $asset, bool $queue): array
    {
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

    private function uploadPart(array $asset, array $query, string $bytes): array
    {
        $id = $asset['id'];
        $upload = $this->uploads[$id] ?? null;
        if ($upload === null || $asset['upload']['status'] !== 'uploading') {
            self::fail(ErrorCodes::UPLOAD_NOT_OPEN);
        }
        $number = (int) ($query['partNumber'] ?? 0);
        if ($number !== $upload['parts'] + 1) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PART_NUMBER);
        }
        $size = strlen($this->content[$id]['bytes'] ?? '') + strlen($bytes);
        $final = self::flag($query['isFinal'] ?? null);
        if ($upload['image'] && $size > 20 * self::MIB) {
            self::fail(ErrorCodes::MULTIPART_IMAGE_TOO_LARGE);
        }
        if ($upload['image'] && $final && $size < 10 * self::MIB) {
            self::fail(ErrorCodes::MULTIPART_IMAGE_TOO_SMALL);
        }
        if ($upload['total'] !== null && ($size > $upload['total'] || ($final && $size !== $upload['total']))) {
            self::fail(ErrorCodes::UPLOAD_SIZE_MISMATCH);
        }
        $this->content[$id] = ['type' => $this->content[$id]['type'] ?? (string) $asset['content']['format'], 'bytes' => ($this->content[$id]['bytes'] ?? '') . $bytes];
        $this->uploads[$id]['parts'] = $number;
        $now = ($this->now)();
        $asset['content']['sizeInBytes'] = $size;
        $asset['upload'] = ['status' => $final ? 'completed' : 'uploading', 'updatedAt' => $now, 'partsReceived' => $number] + $asset['upload'];
        $asset = $this->assets[$id] = $this->touch($asset);
        if (!$final) {
            return $asset;
        }
        // The queue mode saved when the upload started, unless this part overrides it.
        $queue = array_key_exists('queue', $query) ? self::flag($query['queue']) : $upload['queue'];
        unset($this->uploads[$id]);
        return $this->finish($asset, $queue);
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

    private function touch(array $record): array
    {
        $record['updatedAt'] = ($this->now)();
        return $record;
    }

    private static function kind(string $mime, ?string $url): string
    {
        return match (true) {
            $url !== null => 'website',
            (bool) preg_match('#^(image|video|audio)/#', $mime) => explode('/', $mime)[0],
            str_starts_with($mime, 'text/') => 'plaintext-document',
            str_contains($mime, 'pdf') || str_contains($mime, 'document') => 'multimedia-document',
            default => 'file',
        };
    }

    /**
     * Filters with a subset of RSQL (`;` and, `,` or, `==` with `*` wildcards, `!=`, `=in=`,
     * `=out=`, `=gt=`, `=ge=`, `=lt=`, `=le=`), orders by `createdAt` and `id`, and pages with an
     * opaque cursor.
     */
    private function page(array $items, array $query): array
    {
        $items = array_values($items);
        if (($query['filter'] ?? '') !== '') {
            $matches = self::filter((string) $query['filter']);
            $items = array_values(array_filter($items, $matches));
        }
        $ordering = is_array($query['ordering'] ?? null) ? array_values($query['ordering']) : [['field' => 'createdAt', 'direction' => 'DESC']];
        foreach ($ordering as $order) {
            if (!in_array($order['field'] ?? null, ['createdAt', 'id'], true)) {
                self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'Invalid ordering');
            }
        }
        if (!in_array('id', array_column($ordering, 'field'), true)) {
            $ordering[] = ['field' => 'id', 'direction' => $ordering[0]['direction'] ?? 'ASC'];
        }
        usort($items, function (array $a, array $b) use ($ordering): int {
            foreach ($ordering as $order) {
                $result = ($a[$order['field']] ?? null) <=> ($b[$order['field']] ?? null);
                if ($result !== 0) {
                    return strtoupper($order['direction'] ?? 'ASC') === 'DESC' ? -$result : $result;
                }
            }
            return 0;
        });
        $size = (int) ($query['pageSize'] ?? 10);
        if ($size < 1 || $size > 100) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'pageSize must be from 1 to 100');
        }
        $offset = 0;
        if (isset($query['cursor'])) {
            $decoded = base64_decode((string) $query['cursor'], true);
            if ($decoded === false || !preg_match('/^offset:(\d+)$/D', $decoded, $match)) {
                self::fail(ErrorCodes::INVALID_CURSOR, 400, 'Invalid cursor');
            }
            $offset = (int) $match[1];
        }
        $more = count($items) > $offset + $size;
        return ['items' => array_slice($items, $offset, $size), 'nextCursor' => $more ? base64_encode('offset:' . ($offset + $size)) : null,
            'pageSize' => $size, 'ordering' => $ordering, 'hasMore' => $more];
    }

    private static function filter(string $expression): \Closure
    {
        preg_match_all('/"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[;,()]|[^;,()"\']+/', $expression, $match);
        $tokens = $match[0];
        if (implode('', $tokens) !== $expression) {
            throw new \LogicException("MockServerClient cannot parse the filter $expression");
        }
        // Group comparisons; a "(" after =in= or =out= opens a value list, not a group.
        $groups = [[]];
        $current = '';
        $depth = 0;
        foreach ($tokens as $token) {
            if ($token === '(') {
                if (!preg_match('/=(in|out)=\s*$/', $current)) {
                    throw new \LogicException('MockServerClient filters do not support parentheses for grouping');
                }
                $depth++;
            } elseif ($token === ')') {
                $depth--;
            }
            if ($depth === 0 && ($token === ';' || $token === ',')) {
                $groups[array_key_last($groups)][] = $current;
                $current = '';
                if ($token === ',') {
                    $groups[] = [];
                }
            } else {
                $current .= $token;
            }
        }
        $groups[array_key_last($groups)][] = $current;
        $alternatives = array_map(fn (array $group) => array_map(self::comparison(...), $group), $groups);
        return function (array $asset) use ($alternatives): bool {
            foreach ($alternatives as $tests) {
                if (array_reduce($tests, fn (bool $all, \Closure $test) => $all && $test($asset), true)) {
                    return true;
                }
            }
            return false;
        };
    }

    private static function comparison(string $text): \Closure
    {
        if (!preg_match('/^\s*([\w.]+)\s*(==|!=|=in=|=out=|=gt=|=ge=|=lt=|=le=)(.*)$/sD', $text, $match)) {
            throw new \LogicException("MockServerClient cannot evaluate the filter $text");
        }
        [, $name, $operator, $raw] = $match;
        $raw = trim($raw);
        $unquote = function (string $value): string {
            $value = trim($value);
            return $value !== '' && ($value[0] === '"' || $value[0] === "'")
                ? str_replace(['\\"', "\\'"], ['"', "'"], substr($value, 1, -1)) : $value;
        };
        if (str_starts_with($raw, '(')) {
            preg_match_all('/"(?:[^"\\\\]|\\\\.)*"|[^,()]+/', substr($raw, 1, -1), $listed);
            $values = array_map($unquote, $listed[0]);
        } else {
            $values = [$unquote($raw)];
        }
        return function (array $asset) use ($name, $operator, $values): bool {
            $actual = $asset;
            foreach (explode('.', $name) as $key) {
                $actual = is_array($actual) ? ($actual[$key] ?? null) : null;
            }
            $items = is_array($actual) && array_is_list($actual) ? $actual : [$actual];
            $texts = array_map(fn ($item) => match (true) {
                $item === null => '',
                is_bool($item) => $item ? 'true' : 'false',
                is_array($item) => Values::json($item),
                default => (string) $item,
            }, $items);
            $any = fn (callable $test) => array_filter($texts, $test) !== [];
            return match ($operator) {
                '==' => $any(fn ($t) => fnmatch($values[0], $t, FNM_NOESCAPE)),
                '!=' => !$any(fn ($t) => fnmatch($values[0], $t, FNM_NOESCAPE)),
                '=in=' => $any(fn ($t) => in_array($t, $values, true)),
                '=out=' => !$any(fn ($t) => in_array($t, $values, true)),
                default => is_numeric($actual) && is_numeric($values[0]) && match ($operator) {
                    '=gt=' => $actual > $values[0], '=ge=' => $actual >= $values[0],
                    '=lt=' => $actual < $values[0], default => $actual <= $values[0],
                },
            };
        };
    }

    /** Keyword matching on names, IDs, descriptions, types and tags; the mock has no semantic index. */
    private function search(array $query): array
    {
        $text = strtolower(trim((string) ($query['query'] ?? '')));
        if ($text === '') {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'query is required');
        }
        $items = [];
        foreach ($this->assets as $asset) {
            $matched = array_values(array_filter(['name', 'id', 'externalId', 'description', 'type'],
                fn ($field) => str_contains(strtolower((string) ($asset[$field] ?? '')), $text)));
            foreach ($asset['tags'] ?? [] as $tag) {
                if (str_contains(strtolower((string) $tag), $text)) {
                    $matched[] = 'tags';
                    break;
                }
            }
            if ($matched !== []) {
                $items[] = ['asset' => $asset, 'score' => count($matched) / 7, 'matchedFields' => $matched];
            }
        }
        usort($items, fn ($a, $b) => $b['score'] <=> $a['score']);
        return ['query' => $query['query'], 'items' => array_slice($items, 0, (int) ($query['limit'] ?? 10)), 'semanticStatus' => 'disabled'];
    }

    private function folder(mixed $id): array
    {
        $folder = is_string($id) ? ($this->folders[$id] ?? null) : null;
        return $folder ?? self::fail(ErrorCodes::FOLDER_NOT_FOUND, null, 'Folder not found');
    }

    private function uniqueFolderName(string $name, ?string $parentId, ?string $except = null): void
    {
        foreach ($this->folders as $folder) {
            if ($folder['id'] !== $except && $folder['name'] === $name && $folder['parentId'] === $parentId) {
                self::fail(ErrorCodes::DUPLICATE_FOLDER_NAME);
            }
        }
    }

    private function createFolder(array $json): array
    {
        if (!is_string($json['name'] ?? null) || $json['name'] === '') {
            self::fail('validation/invalid-body', 400, 'name is required');
        }
        $parentId = $json['parentId'] ?? null;
        if ($parentId !== null) {
            $this->folder($parentId);
        }
        $this->uniqueFolderName($json['name'], $parentId);
        $now = ($this->now)();
        $folder = ['id' => ($this->createId)(), 'projectId' => $this->projectId, 'parentId' => $parentId, 'createdAt' => $now, 'updatedAt' => $now] + $json;
        return $this->folders[$folder['id']] = $folder;
    }

    /** One level of a folder tree with its visible ancestors, like the API's folder page. */
    private function listFolders(array $query): array
    {
        $search = strtolower((string) ($query['search'] ?? ''));
        $parentId = $query['parentId'] ?? null;
        $resolveOnly = self::flag($query['resolveOnly'] ?? null);
        $found = array_values(array_filter($this->folders, fn ($folder) => (($search !== '' && self::flag($query['searchAll'] ?? null)) || $folder['parentId'] === $parentId)
            && ($search === '' || str_contains(strtolower($folder['name']), $search))));
        $byDate = ($query['sort'] ?? null) === 'createdAt';
        usort($found, fn ($a, $b) => [$byDate ? $a['createdAt'] : $a['name'], $a['id']] <=> [$byDate ? $b['createdAt'] : $b['name'], $b['id']]);
        if (strtoupper((string) ($query['direction'] ?? 'ASC')) === 'DESC') {
            $found = array_reverse($found);
        }
        $size = (int) ($query['pageSize'] ?? 100);
        $start = (int) ($query['pageIndex'] ?? 0) * $size;
        $page = $resolveOnly ? [] : array_slice($found, $start, $size);
        $ids = array_fill_keys(array_merge(array_values((array) ($query['ids'] ?? [])), array_column($page, 'id'), $parentId === null ? [] : [$parentId]), true);
        $queue = array_keys($ids);
        while ($queue !== []) {
            $parent = $this->folders[array_pop($queue)]['parentId'] ?? null;
            if ($parent !== null && !isset($ids[$parent])) {
                $ids[$parent] = true;
                $queue[] = $parent;
            }
        }
        $inPage = array_column($page, 'id');
        $ancestors = array_values(array_filter($this->folders, fn ($folder) => isset($ids[$folder['id']]) && !in_array($folder['id'], $inPage, true)));
        return ['folders' => $page, 'ancestors' => $ancestors, 'hasMore' => !$resolveOnly && count($found) > $start + $size];
    }

    private function folderRoute(string $method, string $id, string $suffix, array $json): ?array
    {
        $folder = $this->folder($id);
        switch ($method . ' ' . $suffix) {
            case 'GET ':
                return $folder;
            case 'PATCH ':
                if (isset($json['name'])) {
                    $this->uniqueFolderName($json['name'], $folder['parentId'], $id);
                }
                $fields = array_diff_key($json, array_flip(['id', 'projectId', 'parentId', 'createdAt']));
                return $this->folders[$id] = $this->touch($fields + $folder);
            case 'DELETE ':
                if (array_filter($this->assets, fn ($asset) => $asset['folderId'] === $id) !== []
                    || array_filter($this->folders, fn ($child) => $child['parentId'] === $id) !== []) {
                    self::fail(ErrorCodes::FOLDER_NOT_EMPTY);
                }
                unset($this->folders[$id]);
                return null;
            case 'POST move':
                $parentId = $json['parentId'] ?? null;
                for ($current = $parentId, $seen = [$id => true]; $current !== null; $current = $this->folder($current)['parentId']) {
                    if (isset($seen[$current])) {
                        self::fail(ErrorCodes::FOLDER_PARENT_CYCLE);
                    }
                    $seen[$current] = true;
                }
                $this->uniqueFolderName($folder['name'], $parentId, $id);
                return $this->folders[$id] = $this->touch(['parentId' => $parentId] + $folder);
        }
        throw new \LogicException("MockServerClient does not emulate $method $suffix for a folder; enqueue a response for it");
    }

    /** Without `after` the feed starts from now, like the API. */
    private function listEvents(array $query): array
    {
        if (!isset($query['after'])) {
            return ['events' => [], 'cursor' => 'mock_' . count($this->events), 'hasMore' => false];
        }
        if (!preg_match('/^mock_(\d+)$/D', (string) $query['after'], $match)) {
            self::fail(ErrorCodes::INVALID_EVENT_CURSOR);
        }
        $limit = (int) ($query['limit'] ?? 50);
        if ($limit < 1 || $limit > 100) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'limit must be from 1 to 100');
        }
        $taken = array_slice($this->events, (int) $match[1], $limit);
        $next = (int) $match[1] + count($taken);
        return ['events' => $taken, 'cursor' => 'mock_' . $next, 'hasMore' => $next < count($this->events)];
    }

    /** An unchanged definition is returned as saved; a changed one needs a higher version. */
    private function saveLenses(array $definitions): array
    {
        $now = ($this->now)();
        $pending = $this->lenses;
        $saved = [];
        foreach ($definitions as $definition) {
            $old = $pending[$definition['identifier']] ?? null;
            $same = $old !== null && array_intersect_key($old, $definition) == $definition;
            if ($old !== null && !$same && ($definition['version'] ?? 0) <= ($old['version'] ?? 0)) {
                self::fail(ErrorCodes::LENS_VERSION_CONFLICT);
            }
            $saved[] = $pending[$definition['identifier']] = $same ? $old : $definition + ['id' => $old['id'] ?? ($this->createId)(),
                'projectId' => $this->projectId, 'createdAt' => $old['createdAt'] ?? $now, 'updatedAt' => $now];
        }
        $this->lenses = $pending;
        return ['lenses' => $saved];
    }

    private function canDownload(?string $folderId): bool
    {
        foreach ($this->grants as $grant) {
            if (!is_array($grant) || !in_array('assets:download', (array) ($grant['actions'] ?? []), true)) {
                continue;
            }
            if (($grant['folderId'] ?? null) === null) {
                return true;
            }
            for ($current = $folderId, $seen = []; $current !== null && !isset($seen[$current]); $current = $this->folders[$current]['parentId'] ?? null) {
                if ($current === $grant['folderId']) {
                    return true;
                }
                if (!($grant['includeSubfolders'] ?? false)) {
                    break;
                }
                $seen[$current] = true;
            }
        }
        return false;
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
        if ($project !== $this->projectId || $asset === null || !in_array($resource, ['original', 'rendered'], true)) {
            return self::json(404, ['code' => 'asset/not-found', 'message' => 'Asset not found']);
        }
        // Delivery checks come first and refuse everyone, like the CDN.
        $status = $asset['classification']['moderation']['status'];
        $stored = $this->content[$asset['id']] ?? null;
        if ($stored === null || $asset['upload']['status'] !== 'completed' || in_array($status, ['blocked', 'purged'], true)
            || $asset['classification']['status'] === 'failed' || $asset['content']['status'] === 'removed') {
            return self::json(403, ['code' => 'asset/not-available', 'message' => 'Asset is not available']);
        }
        // Age-restricted assets are delivered like private ones, unless a public one is requested
        // with `allowAgeRestricted=true`.
        $ageRestricted = $status === 'age-restricted';
        $private = $asset['visibility'] !== 'public' || ($ageRestricted && ($query['allowAgeRestricted'] ?? null) !== 'true');
        if ($private && !$this->canDownload($asset['folderId'] ?? null)) {
            return self::json(403, ['code' => 'asset/api-key-missing-permission', 'message' => 'The API key cannot download this asset']);
        }
        return new Response(200, ['Content-Type' => $stored['type'], 'Content-Length' => (string) strlen($stored['bytes']),
            'Cache-Control' => $private || $ageRestricted ? 'private, no-store' : 'public, max-age=31536000',
            'ETag' => '"' . substr(hash('sha256', $stored['bytes']), 0, 32) . '"', 'X-Request-Id' => self::requestId()],
            $method === 'HEAD' ? '' : $stored['bytes']);
    }
}
