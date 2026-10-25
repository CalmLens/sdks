<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\Assets;
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
 * events feed behave like the API's; the CDN serves stored bytes and placeholders; and errors use
 * the API's codes, statuses, `X-Request-Id` header and body shape (schema errors are
 * `validation/<issue>` with the field in `details.path`). It does not classify content: assets
 * submitted with `classify` get `analyzedOutcome` and those submitted with `create` get
 * `queuedOutcome`. Content is kept only with `keepContentAfterProcessing: true`; otherwise it is
 * removed once classification completes, as in the API. A `purged` outcome removes the content
 * with reason `policy`; a reviewer's purge (`decide`) with reason `requested`. A classified image
 * gets a ThumbHash for its placeholder, which goes with its content. Like the API, deleting an
 * asset, removing its content and retrying it add `asset.deleted`, `asset.content-removed` and
 * `asset.retried` events; processing adds none.
 *
 * Like the CDN, it checks delivery first: blocked, purged and failed assets, and assets whose
 * content was removed or is still uploading, return 403 `asset/not-available` whatever the key.
 * Then access: a private asset, or a public age-restricted one requested without the
 * `allowAgeRestricted` URL option, needs an `assets:download` grant for its folder. The default
 * key has no grants, like a real key without `assets:download`; pass an `apiKey` from
 * `createApiKey()`, or call `setApiKeyGrants()`, to grant downloads.
 *
 * Waits (retry backoff and `assets->waitForDecision`) take no real time: they advance a virtual
 * clock, so a decision that never comes times out at once.
 *
 * `failNextRequest` failures come first (for any request, or the next to one operation), then
 * enqueued responses and exceptions in order, before the stand-in answers.
 */
final class MockServerClient
{
    public const OUTCOMES = ['pending', 'allowed', 'limited', 'age-restricted', 'blocked', 'purged', 'failed'];
    /** What `decide` accepts: a reviewer's decision, or `pending` and `failed` to arrange a test. */
    public const DECISIONS = ['allowed', 'limited', 'age-restricted', 'blocked', 'purged'];
    /** The ThumbHash the mock gives every classified image, standing in for one computed from its pixels. */
    public const THUMBHASH = '1QcSHQRnh493V4dIh4eXh1h4kJUI';
    private const MIB = 1024 * 1024;
    /** The UUID form the API's schema accepts (zod's `uuid()`). */
    private const UUID_PATTERN = '/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/D';
    private const ACTIVE_CONTENT_TYPES = ['image/svg+xml', 'application/xhtml+xml', 'text/html', 'application/xml', 'text/xml'];

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
    /** @var list<array{failure: string|\Throwable, operation: ?string}> */
    private array $failures = [];
    private array $history = [];
    /** @var array<string, array{0: string, 1: int, 2: string}> Saved responses by idempotency key. */
    private array $idempotent = [];
    /** @var array<string, array{queue: bool, total: ?int}> Open multipart uploads, as they started. */
    private array $uploads = [];
    private array $grants;
    private float $elapsed = 0.0;
    private int $requestCount = 0;
    /** The status of the response being answered: 200, 201 for a new folder or 202 for a queued batch. */
    private int $status = 200;
    /** The status of the last response, null when the last request failed without one; the contract tests check it. */
    private ?int $lastStatus = null;
    private \Closure $now;
    private \Closure $createId;
    private mixed $analyzedOutcome;
    private string $baseUrl;
    private string $cdnBaseUrl;

    /**
     * @param string $queuedOutcome outcome of `assets.create` (and queued multipart uploads):
     *   `pending` (still processing), `allowed`, `limited`, `age-restricted`, `blocked` or `purged`, or
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
        $last = 0;
        // The default clock moves on by at least a millisecond per reading, so assets created in a
        // row have increasing createdAt and orderings never depend on random IDs.
        $this->now = \Closure::fromCallable($now ?? function () use (&$last): int {
            return $last = max((int) floor(microtime(true) * 1000), $last + 1);
        });
        $this->createId = \Closure::fromCallable($createId ?? fn (): string => Values::uuid());
        $this->grants = $apiKey === null ? [] : self::grantsOf($apiKey);
        $stack = HandlerStack::create(fn (RequestInterface $request, array $options) => $this->handle($request));
        $this->client = new ServerClient($apiKey ?? 'mock-key', $projectId, $baseUrl, $cdnBaseUrl, maxRetries: $maxRetries,
            httpClient: new Client(['handler' => $stack]));
        $session = (fn (): Session => $this->session)->call($this->client);
        $session->sleep = function (float $seconds): void { $this->elapsed += $seconds; };
        $session->clock = fn (): float => $this->elapsed;
        // The stand-in answers multipart size checks in the API's order.
        $session->deferUploadChecks = true;
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

    /**
     * Replaces the mock API key's grants (the `createApiKey()` shape), as editing the key in the
     * portal would: later requests, such as `cdn->serve`, use them. The key itself stays the same,
     * so idempotency keys it used still replay.
     */
    public function setApiKeyGrants(array $grants): self
    {
        $this->grants = self::grantsOf(self::createApiKey($grants));
        return $this;
    }

    /**
     * Signs an upload token like `uploadTokens->sign`, with the same validation, at a fixed clock
     * (`now`, epoch milliseconds) and nonce, so tests can compare exact tokens.
     *
     * @return array{token: string, expiresAt: int}
     */
    public static function signUploadToken(#[\SensitiveParameter] string $apiKey, array $options, int $now, string $nonce): array
    {
        return \CalmLens\UploadTokens::signAt($apiKey, $options, $now, $nonce);
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
     * Fails the next request (or, with `operation`, the next one that client method sends, named
     * like `assets.create` or `cdn.serve`) instead of answering it, leaving the stored state
     * unchanged. Each queued failure is used once. `transport-error` and `timeout` fail the
     * connection, so the client throws `ConnectionException` (`sdk/transport-error`) or
     * `TimeoutException` (`sdk/timeout`). An API error code, such as `upload/limit-exceeded`, is
     * answered as the API answers it: its HTTP status, message and request ID. A
     * `CalmLensException` is answered with its status (or the API's status for its code), a JSON
     * `{code, message, details}` body and its headers (such as `Retry-After`). Any other exception
     * is thrown by the transport as given.
     */
    public function failNextRequest(string|\Throwable $failure = 'transport-error', ?string $operation = null): self
    {
        if (is_string($failure) && !in_array($failure, ['transport-error', 'timeout'], true) && !isset(ErrorCodes::STATUSES[$failure])) {
            throw new \InvalidArgumentException("Mock failures are transport-error, timeout, an API error code or an exception (got $failure)");
        }
        $this->failures[] = ['failure' => $failure, 'operation' => $operation];
        return $this;
    }

    /** Queued responses and failures not used yet. */
    public function pending(): int { return count($this->queue) + count($this->failures); }

    /** @return list<RequestInterface> every request received, oldest first, with readable bodies. */
    public function requests(): array { return $this->history; }

    /**
     * Adds an event to the feed returned by `events.list`. Omitted `id`, `projectId`, `severity`,
     * `title`, `createdAt`, `updatedAt` and `facts` are filled in; when `assetId` names a stored
     * asset, the event carries a snapshot of its status, as the API's events do. Pass the result to
     * `Webhooks::toPayload` to build a matching webhook body.
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
     * Applies a reviewer's decision (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) to a
     * stored asset, as the portal would: the moderation status changes (`purged` also removes the
     * content with reason `requested` and first adds an `asset.content-removed` event), the review
     * joins `manualReviews`, and an `asset.<decision>` event with the catalog's severity (`low` for
     * `allowed` and `limited`, `high` otherwise) and a `decided-by: reviewer` fact joins the feed.
     * `pending` and `failed` only change the statuses, to arrange a test. Throws `NotFoundException`
     * (`asset/not-found`) for an unknown asset.
     */
    public function decide(string $assetId, string $outcome): array
    {
        self::checkOutcome($outcome);
        if (!isset($this->assets[$assetId])) {
            throw CalmLensException::create(ErrorCodes::ASSET_NOT_FOUND, 'Asset not found', 404);
        }
        $asset = $this->applyOutcome($this->assets[$assetId], $outcome, 'requested');
        if (!in_array($outcome, self::DECISIONS, true)) {
            return $asset;
        }
        $asset['classification']['moderation']['manualReviews'][] = ['id' => ($this->createId)(), 'decision' => $outcome,
            'note' => null, 'reviewerUserId' => null, 'reviewedAt' => ($this->now)(), 'appliedToAsset' => true];
        $this->assets[$assetId] = $asset;
        if ($outcome === 'purged') {
            $this->lifecycleEvent('asset.content-removed', $asset);
        }
        $this->enqueueEvent(['type' => 'asset.' . $outcome, 'severity' => in_array($outcome, ['allowed', 'limited'], true) ? 'low' : 'high',
            'title' => 'asset.' . $outcome, 'assetId' => $assetId, 'asset' => $this->snapshot($asset),
            'facts' => [['key' => 'decided-by', 'value' => 'reviewer'], ['key' => 'asset-type', 'value' => $asset['type']],
                ['key' => 'asset-name', 'value' => $asset['name'], 'url' => '/portal/assets/' . $assetId], ['key' => 'note', 'value' => null]]]);
        return $asset;
    }

    /** Adds an `asset.deleted`, `asset.content-removed` or `asset.retried` event, like the API. */
    private function lifecycleEvent(string $type, array $asset): void
    {
        $name = ['key' => 'asset-name', 'value' => $asset['name']];
        // A deleted asset has no portal page to link to.
        if ($type !== 'asset.deleted') {
            $name['url'] = '/portal/assets/' . $asset['id'];
        }
        $this->enqueueEvent(['type' => $type, 'severity' => 'low', 'assetId' => $asset['id'], 'asset' => $this->snapshot($asset),
            'facts' => [$name, ['key' => 'asset-type', 'value' => $asset['type']]]]);
    }

    private function snapshot(array $asset): array
    {
        return ['id' => $asset['id'], 'externalId' => $asset['externalId'] ?? null, 'uploadPresetId' => $asset['uploadPresetId'] ?? null,
            'upload' => ['status' => $asset['upload']['status']], 'classification' => ['status' => $asset['classification']['status'],
                'moderation' => ['status' => $asset['classification']['moderation']['status']]], 'content' => ['status' => $asset['content']['status']]];
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

    /** The client methods that send a request like this one, named like `assets.create`. */
    private function operations(RequestInterface $request, bool $cdn, array $parts, array $query): array
    {
        if ($cdn) {
            return ['cdn.serve'];
        }
        $method = $request->getMethod();
        if (($parts[0] ?? null) === 'projects') {
            $route = $method . ' ' . implode('/', array_slice($parts, 2));
            return match ($route) {
                'GET events' => ['events.list'],
                'PUT lenses' => ['ensureLenses', 'ensureLens'],
                'GET folders' => ['folders.list'],
                'POST folders' => ['folders.create'],
                'GET assets/page' => ['assets.list'],
                'GET assets/search' => ['assets.search'],
                'POST assets/batch' => ['assets.batch'],
                'POST assets' => self::flag($query['queue'] ?? null) ? ['assets.create'] : ['assets.classify', 'text.classify'],
                default => [],
            };
        }
        $suffix = $parts[2] ?? '';
        $resource = $parts[0] ?? '';
        $names = ['GET ' => 'retrieve', 'PATCH ' => 'update', 'DELETE ' => 'delete', 'POST move' => 'move',
            'GET children' => 'listChildren', 'DELETE content' => 'deleteContent', 'POST retry' => 'retry',
            'POST explain' => 'explain', 'POST part' => 'uploadPart', 'POST signed-url' => 'createSignedUrl'];
        $name = $names[$method . ' ' . $suffix] ?? null;
        if ($name === null || !in_array($resource, ['assets', 'folders'], true)) {
            return [];
        }
        return $name === 'retrieve' && $resource === 'assets' ? ['assets.retrieve', 'assets.waitForDecision'] : ["$resource.$name"];
    }

    private function handle(RequestInterface $request): PromiseInterface
    {
        $this->lastStatus = null;
        return $this->answer($request)->then(function (ResponseInterface $response): ResponseInterface {
            $this->lastStatus = $response->getStatusCode();
            return $response;
        });
    }

    private function answer(RequestInterface $request): PromiseInterface
    {
        $body = (string) $request->getBody();
        $request = $request->withBody(\GuzzleHttp\Psr7\Utils::streamFor($body));
        $this->history[] = $request;
        $url = (string) $request->getUri()->withQuery('');
        parse_str($request->getUri()->getQuery(), $query);
        $cdn = str_starts_with($url, $this->cdnBaseUrl . '/');
        $path = substr($url, strlen($cdn ? $this->cdnBaseUrl : $this->baseUrl));
        $parts = array_map('rawurldecode', array_values(array_filter(explode('/', $path), fn ($part) => $part !== '')));
        $operations = $this->operations($request, $cdn, $parts, $query);
        foreach ($this->failures as $index => ['failure' => $failure, 'operation' => $operation]) {
            if ($operation === null || in_array($operation, $operations, true)) {
                array_splice($this->failures, $index, 1);
                return $this->failure($failure, $request);
            }
        }
        $queued = array_shift($this->queue);
        if ($queued instanceof \Throwable) {
            return Create::rejectionFor($queued);
        }
        if ($queued !== null) {
            return Create::promiseFor($queued);
        }
        if ($cdn) {
            return Create::promiseFor($this->serve($request->getMethod(), $parts, $query));
        }
        // The HTTP library trims header values, as every HTTP stack does before the API sees them.
        $key = $request->hasHeader('Idempotency-Key') ? $request->getHeaderLine('Idempotency-Key') : null;
        if ($key !== null && (strlen($key) > 255 || !preg_match('/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/D', $key))) {
            return Create::promiseFor($this->error(ErrorCodes::INVALID_IDEMPOTENCY_KEY, 'Invalid idempotency key'));
        }
        $fingerprint = hash('sha256', Values::json([$request->getMethod(), $path, $request->getUri()->getQuery(), hash('sha256', $body)]));
        if ($key !== null && isset($this->idempotent[$key])) {
            [$saved, $status, $bytes] = $this->idempotent[$key];
            return Create::promiseFor($saved !== $fingerprint
                ? $this->error(ErrorCodes::IDEMPOTENCY_KEY_REUSED, 'Idempotency key reused with a different request')
                : new Response($status, ['Content-Type' => 'application/json', 'Idempotent-Replayed' => 'true', 'X-Request-Id' => $this->requestId()], $bytes));
        }
        try {
            $json = $request->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : [];
            $this->status = 200;
            $data = $this->api($request, $parts, $query, is_array($json) ? $json : [], $body);
            // Like the API, deletes answer 200 with an empty object.
            $response = $this->json($this->status, $data ?? new \stdClass());
        } catch (CalmLensException $failure) {
            // Raised by fail(): answer like the API does, and leave the key unsaved.
            return Create::promiseFor($this->error($failure->errorCode, $failure->getMessage(), $failure->status, $failure->details));
        }
        if ($key !== null) {
            $this->idempotent[$key] = [$fingerprint, $response->getStatusCode(), (string) $response->getBody()];
            $response->getBody()->rewind();
        }
        return Create::promiseFor($response);
    }

    private function failure(string|\Throwable $failure, RequestInterface $request): PromiseInterface
    {
        if ($failure instanceof CalmLensException) {
            $status = $failure->status ?? ErrorCodes::STATUSES[$failure->errorCode] ?? 400;
            return Create::promiseFor($this->json($status, ['code' => $failure->errorCode, 'message' => $failure->getMessage()]
                + ($failure->details === [] ? [] : ['details' => $failure->details]), $failure->headers));
        }
        if ($failure instanceof \Throwable) {
            return Create::rejectionFor($failure);
        }
        if (isset(ErrorCodes::STATUSES[$failure])) {
            return Create::promiseFor($this->error($failure, "Simulated $failure"));
        }
        return Create::rejectionFor(new ConnectException($failure === 'timeout' ? 'Simulated timeout' : 'Simulated network failure',
            $request, null, $failure === 'timeout' ? ['errno' => 28] : []));
    }

    /** Fails the request being answered with an API error; the status defaults to the code's. */
    private static function fail(string $code, ?int $status = null, string $message = '', array $details = []): never
    {
        throw new CalmLensException($code, $message ?: $code, $status ?? ErrorCodes::STATUSES[$code] ?? 400, $details);
    }

    /** A request the API's schema refuses: `validation/<issue>` with HTTP 400 and the field in `details.path`. */
    private static function invalid(string $code, string $path): never
    {
        self::fail($code, 400, "Invalid $path", ['path' => $path]);
    }

    private function requestId(): string { return 'mock-request-' . ++$this->requestCount; }

    private function json(int $status, mixed $data, array $headers = []): Response
    {
        return new Response($status, ['Content-Type' => 'application/json', 'X-Request-Id' => $this->requestId()] + $headers,
            json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    private function error(string $code, string $message, ?int $status = null, array $details = []): Response
    {
        return $this->json($status ?? ErrorCodes::STATUSES[$code] ?? 400, ['code' => $code, 'message' => $message] + ($details === [] ? [] : ['details' => $details]));
    }

    private function api(RequestInterface $request, array $parts, array $query, array $json, string $body): ?array
    {
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
                $route === 'GET assets/page' => $this->listAssets($query),
                $route === 'GET assets/search' => $this->search($query),
                $route === 'POST assets/batch' => $this->batch($json),
                $route === 'POST assets' && $upload === '' => $this->createAsset($json, self::flag($query['queue'] ?? null), null, false),
                $route === 'POST assets' && in_array($upload, ['content', 'part'], true) => $this->createAsset($query, self::flag($query['queue'] ?? null), $body, $upload === 'part'),
                default => throw new \LogicException("MockServerClient does not emulate $route; enqueue a response for it"),
            };
        }
        if (($parts[0] ?? null) === 'folders' && isset($parts[1])) {
            return $this->folderRoute($method, $parts[1], $parts[2] ?? '', $json);
        }
        if (($parts[0] ?? null) !== 'assets' || !isset($parts[1])) {
            throw new \LogicException("MockServerClient does not emulate $method /" . implode('/', $parts) . '; enqueue a response for it');
        }
        $id = $parts[1];
        $asset = $this->assets[$id] ?? self::fail(ErrorCodes::ASSET_NOT_FOUND, null, 'Asset not found');
        $route = $method . ' ' . ($parts[2] ?? '');
        switch ($route) {
            case 'GET ':
                return $asset;
            case 'GET children':
                return $this->page(array_filter($this->assets, fn ($child) => $child['parentId'] === $id), $query, $id);
            case 'PATCH ':
                $fields = array_diff_key($json, array_flip(['id', 'projectId', 'upload', 'classification', 'content']));
                // Like the API: an externalId stays unique in the project; null clears a field.
                if (is_string($fields['externalId'] ?? null) && $fields['externalId'] !== '') {
                    foreach ($this->assets as $other) {
                        if ($other['id'] !== $id && ($other['externalId'] ?? null) === $fields['externalId']) {
                            self::fail(ErrorCodes::DUPLICATE_EXTERNAL_ID);
                        }
                    }
                }
                return $this->assets[$id] = $this->touch(array_replace($asset, $fields));
            case 'DELETE ':
                unset($this->assets[$id], $this->content[$id], $this->uploads[$id]);
                $this->lifecycleEvent('asset.deleted', $asset);
                return null;
            case 'DELETE content':
                return $this->requestedRemoval($asset);
            case 'POST retry':
                if ($asset['classification']['status'] !== 'failed' || $asset['classification']['moderation']['status'] !== 'pending') {
                    self::fail(ErrorCodes::ASSET_NOT_RETRYABLE);
                }
                if ($asset['content']['status'] === 'removed') {
                    self::fail(ErrorCodes::ASSET_CONTENT_UNAVAILABLE);
                }
                // Like the API: back to processing, to be moderated again, with an `asset.retried` event.
                $asset = $this->applyOutcome($asset, 'pending');
                $this->lifecycleEvent('asset.retried', $asset);
                return $asset;
            case 'POST explain':
                if ($asset['classification']['status'] !== 'completed') {
                    self::fail(ErrorCodes::ASSET_NOT_DECIDED);
                }
                if (empty($json['rerun'])) {
                    // Like the API: the evidence is completed and every action stays as decided.
                    if (($asset['classification']['moderation']['policy']['evidence'] ?? null) !== 'decision') {
                        return $asset;
                    }
                    $asset['classification']['moderation']['policy']['evidence'] = 'full';
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

    private static function withoutPlaceholder(?array $image): ?array
    {
        return $image === null ? null : ['thumbhash' => null, 'averageColor' => null] + $image;
    }

    /** Like the API: image uploads in parts total 10 MiB (checked at the last part) to 20 MiB. */
    private static function imageSizeError(string $type, int $size, bool $final): ?string
    {
        return match (true) {
            $type !== 'image' => null,
            $size > 20 * self::MIB => ErrorCodes::MULTIPART_IMAGE_TOO_LARGE,
            $final && $size < 10 * self::MIB => ErrorCodes::MULTIPART_IMAGE_TOO_SMALL,
            default => null,
        };
    }

    /** Like the API: the parts may not overshoot a declared total, and must reach it at the end. */
    private static function totalSizeError(?int $total, int $received, bool $final): ?string
    {
        return $total !== null && ($received > $total || ($final && $received !== $total)) ? ErrorCodes::UPLOAD_SIZE_MISMATCH : null;
    }

    private static function failIf(?string $code): void
    {
        if ($code !== null) {
            self::fail($code);
        }
    }

    private function createAsset(array $options, bool $queue, ?string $bytes, bool $multipart): array
    {
        $mime = (string) ($options['contentType'] ?? '');
        $url = $bytes === null ? ($options['url'] ?? null) : null;
        $type = self::kind($mime, $url);
        $size = $bytes === null ? null : strlen($bytes);
        $final = !$multipart || self::flag($options['isFinal'] ?? null);
        $total = isset($options['totalSizeInBytes']) ? (int) $options['totalSizeInBytes'] : null;
        if ($multipart) {
            // Like the API, a declared total is checked before anything is stored, then a single
            // final part as the whole upload, then the part itself.
            self::failIf(($total === null ? null : self::imageSizeError($type, $total, true))
                ?? ($final ? self::totalSizeError($total, $size, true) ?? self::imageSizeError($type, $size, true) : null));
            if (!$final && $size < 5 * self::MIB) {
                self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'Parts before the last must be at least 5 MiB');
            }
            self::failIf($final ? null : self::totalSizeError($total, $size, false));
        }
        if (isset($options['folderId'])) {
            $this->folder($options['folderId']);
        }
        if (isset($options['externalId']) && $options['externalId'] !== '') {
            foreach ($this->assets as $existing) {
                if (($existing['externalId'] ?? null) === $options['externalId']) {
                    self::fail(ErrorCodes::DUPLICATE_EXTERNAL_ID);
                }
            }
        }
        $now = ($this->now)();
        $decode = fn (string $key) => is_string($options[$key] ?? null) && $bytes !== null ? json_decode($options[$key], true) : ($options[$key] ?? null);
        $processing = $decode('processingOptions') ?? ['keepContentAfterProcessing' => false];
        $keep = is_array($processing) && ($processing['keepContentAfterProcessing'] ?? false) === true;
        // Fields the API returns as null when they are not set.
        $asset = [
            'id' => ($this->createId)(), 'projectId' => $this->projectId, 'userId' => null, 'parentId' => null,
            'folderId' => $options['folderId'] ?? null, 'uploadPresetId' => $options['uploadPresetId'] ?? null,
            'createdAt' => $now, 'updatedAt' => $now, 'name' => $options['name'] ?? null,
            'description' => $options['description'] ?? null, 'externalId' => $options['externalId'] ?? null,
            'externalUrl' => $url ?? ($multipart ? null : ($options['externalUrl'] ?? null)),
            'type' => $type, 'metadata' => $decode('metadata'), 'tags' => null, 'processingOptions' => $processing,
            'visibility' => $options['visibility'] ?? 'private',
            'content' => ['status' => $keep ? 'stored' : 'temporary', 'removalReason' => null, 'updatedAt' => $now,
                'safetyHold' => null, 'format' => $mime === '' ? null : $mime, 'extension' => null, 'sizeInBytes' => $size,
                'checksums' => null, 'image' => null, 'extractedText' => null],
            'upload' => ['status' => $final ? 'completed' : 'uploading', 'updatedAt' => $now, 'partsReceived' => $final ? null : 1],
            'classification' => ['status' => $final ? 'processing' : 'pending', 'updatedAt' => $now, 'completedAt' => null,
                'moderation' => ['status' => 'pending', 'manualReviews' => []]],
        ];
        $this->assets[$asset['id']] = $asset;
        if ($bytes !== null) {
            $this->content[$asset['id']] = ['type' => $mime, 'bytes' => $bytes];
        }
        if (!$final) {
            $this->uploads[$asset['id']] = ['queue' => $queue, 'total' => $total];
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

    /** Continues a multipart upload, in the API's order of checks. */
    private function uploadPart(array $asset, array $query, string $bytes): array
    {
        $id = $asset['id'];
        if ($asset['upload']['status'] !== 'uploading') {
            self::fail(ErrorCodes::UPLOAD_NOT_OPEN);
        }
        $expected = ($asset['upload']['partsReceived'] ?? 0) + 1;
        $number = (int) ($query['partNumber'] ?? 0);
        if ($number !== $expected) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PART_NUMBER, null, "Expected part $expected", ['expectedPartNumber' => $expected, 'receivedPartNumber' => $number]);
        }
        $final = self::flag($query['isFinal'] ?? null);
        $received = ($asset['content']['sizeInBytes'] ?? 0) + strlen($bytes);
        $upload = $this->uploads[$id] ?? ['queue' => false, 'total' => null];
        self::failIf(self::imageSizeError($asset['type'], $received, $final) ?? self::totalSizeError($upload['total'], $received, $final));
        if (!$final && strlen($bytes) < 5 * self::MIB) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'Parts before the last must be at least 5 MiB');
        }
        $this->content[$id] = ['type' => $this->content[$id]['type'] ?? (string) $asset['content']['format'], 'bytes' => ($this->content[$id]['bytes'] ?? '') . $bytes];
        $now = ($this->now)();
        $asset['content']['sizeInBytes'] = $received;
        // Like the API, a completed upload no longer counts parts.
        $asset['upload'] = ['updatedAt' => $now, 'partsReceived' => $final ? null : $number] + $asset['upload'];
        $asset['updatedAt'] = $now;
        $this->assets[$id] = $asset;
        if (!$final) {
            return $asset;
        }
        // The queue mode saved when the upload started, unless this part overrides it.
        $queue = array_key_exists('queue', $query) ? self::flag($query['queue']) : $upload['queue'];
        unset($this->uploads[$id]);
        return $this->finish($asset, $queue);
    }

    /**
     * Moves an asset to an outcome like the pipeline would, and stores it: a decision finishes
     * processing, `purged` removes the content (with `$purgeReason`), finished processing removes
     * content kept only temporarily, and a classified image gets a ThumbHash for its placeholder,
     * which goes with its content.
     */
    private function applyOutcome(array $asset, string $outcome, string $purgeReason = 'policy'): array
    {
        $now = ($this->now)();
        $decided = !in_array($outcome, ['pending', 'failed'], true);
        $status = $decided ? 'completed' : ($outcome === 'failed' ? 'failed' : 'processing');
        $purge = $outcome === 'purged' && $asset['content']['status'] !== 'removed';
        $remove = $purge || ($status === 'completed' && $asset['content']['status'] === 'temporary');
        $image = $asset['content']['image'] ?? null;
        if ($decided && $asset['type'] === 'image' && $asset['content']['status'] !== 'removed' && !$purge) {
            $image = ['thumbhash' => self::THUMBHASH, 'averageColor' => $image['averageColor'] ?? '#7f7f7f']
                + ($image ?? []) + ['width' => null, 'height' => null, 'perceptualHash' => null];
        } elseif ($outcome === 'purged') {
            $image = self::withoutPlaceholder($image);
        }
        $asset['content']['image'] = $image;
        if ($remove) {
            $asset = $this->removeContent($asset, $purge ? $purgeReason : 'retention');
        }
        $asset['upload'] = ['status' => 'completed', 'updatedAt' => $now] + $asset['upload'];
        $asset['classification'] = ['status' => $status, 'updatedAt' => $now, 'completedAt' => $decided ? $now : null] + $asset['classification'];
        $asset['classification']['moderation']['status'] = $decided ? $outcome : 'pending';
        $asset['updatedAt'] = $now;
        return $this->assets[$asset['id']] = $asset;
    }

    /**
     * DELETE /assets/:id/content, like the API: the record and report stay; stored content,
     * extracted text and the placeholder go. Content already removed keeps its reason, and an
     * `asset.content-removed` event is recorded either way.
     */
    private function requestedRemoval(array $asset): array
    {
        unset($this->content[$asset['id']]);
        if ($asset['content']['status'] !== 'removed') {
            $asset = $this->touch($this->removeContent($asset, 'requested'));
        } elseif (isset($asset['content']['image']['thumbhash'])) {
            $asset['content']['image'] = self::withoutPlaceholder($asset['content']['image']);
        }
        $this->assets[$asset['id']] = $asset;
        $this->lifecycleEvent('asset.content-removed', $asset);
        return $asset;
    }

    /**
     * POST /projects/:id/assets/batch. Checks every asset like the API (a non-UUID ID is
     * `validation/invalid-format`, an unknown one `asset/not-found`, and either refuses the whole
     * batch), then answers 202 and applies the operation at once, in request order, instead of in
     * the background: `delete` deletes each asset with its stored child assets and records
     * `asset.deleted` with the asset as it was; `remove-content` removes the content like
     * DELETE /assets/:id/content. Mock assets carry no safety holds, so none is skipped.
     */
    private function batch(array $json): array
    {
        $ids = $json['assetIds'] ?? null;
        if (!is_array($ids) || !array_is_list($ids)) {
            self::invalid('validation/invalid-type', 'assetIds');
        }
        if (count($ids) < 1) {
            self::invalid('validation/too-small', 'assetIds');
        }
        if (count($ids) > Assets::MAX_BATCH_ASSETS) {
            self::invalid('validation/too-big', 'assetIds');
        }
        foreach ($ids as $index => $id) {
            if (!is_string($id) || !preg_match(self::UUID_PATTERN, $id)) {
                self::invalid('validation/invalid-format', "assetIds.$index");
            }
        }
        $operation = $json['operation'] ?? null;
        if (!in_array($operation, Assets::BATCH_OPERATIONS, true)) {
            self::invalid('validation/invalid-value', 'operation');
        }
        $assets = [];
        foreach (array_unique($ids) as $id) {
            $assets[] = $this->assets[$id] ?? self::fail(ErrorCodes::ASSET_NOT_FOUND, null, 'Asset not found');
        }
        foreach ($assets as $asset) {
            if ($operation === Assets::BATCH_DELETE) {
                $this->deleteTree($asset['id']);
                $this->lifecycleEvent('asset.deleted', $asset);
            } else {
                $this->requestedRemoval($this->assets[$asset['id']] ?? $asset);
            }
        }
        $this->status = 202;
        return ['queued' => true];
    }

    /** Deletes an asset, its stored child assets and their content. */
    private function deleteTree(string $id): void
    {
        foreach ($this->assets as $childId => $child) {
            if (($child['parentId'] ?? null) === $id) {
                $this->deleteTree((string) $childId);
            }
        }
        unset($this->assets[$id], $this->content[$id], $this->uploads[$id]);
    }

    private function removeContent(array $asset, string $reason): array
    {
        unset($this->content[$asset['id']]);
        $asset['content'] = ['status' => 'removed', 'removalReason' => $reason, 'updatedAt' => ($this->now)(), 'extractedText' => null,
            'image' => self::withoutPlaceholder($asset['content']['image'] ?? null)] + $asset['content'];
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
            str_starts_with($mime, 'image/') => 'image',
            str_starts_with($mime, 'video/') => 'video',
            str_starts_with($mime, 'audio/') => 'audio',
            str_starts_with($mime, 'text/') => 'plaintext-document',
            str_contains($mime, 'pdf') || str_contains($mime, 'document') => 'multimedia-document',
            default => 'file',
        };
    }

    private function listAssets(array $query): array
    {
        $folderId = $query['folderId'] ?? null;
        $items = array_filter($this->assets, fn ($asset) => $asset['parentId'] === null && ($folderId === null || $asset['folderId'] === $folderId));
        return $this->page($items, $query, Values::json([$this->projectId, $query['filter'] ?? null, $folderId]));
    }

    /** A page size from the query, refused like the API's schema outside 1 to `$max`. */
    private static function size(array $query, string $key, int $default, int $max): int
    {
        if (!array_key_exists($key, $query)) {
            return $default;
        }
        $value = $query[$key];
        if (!is_string($value) || !is_numeric($value) || (float) $value < 1) {
            self::invalid('validation/too-small', $key);
        }
        if ((float) $value > $max) {
            self::invalid('validation/too-big', $key);
        }
        if (!preg_match('/^\d+$/D', $value)) {
            self::invalid('validation/invalid-type', $key);
        }
        return (int) $value;
    }

    /**
     * One keyset page like the API's: filtered with a subset of RSQL (`;` and, `,` or, `==` with
     * `*` wildcards, `!=`, `=in=`, `=out=`, `=gt=`, `=ge=`, `=lt=`, `=le=`, `( … )` groups),
     * ordered by `createdAt` and `id` with an `id` tie-breaker, resuming after the cursor's
     * values. A cursor only continues the query (`$scope` and ordering) it came from.
     */
    private function page(array $items, array $query, string $scope): array
    {
        $size = self::size($query, 'pageSize', 10, 100);
        $items = array_values($items);
        if (($query['filter'] ?? '') !== '') {
            $items = array_values(array_filter($items, self::filter((string) $query['filter'])));
        }
        $ordering = is_array($query['ordering'] ?? null) && $query['ordering'] !== [] ? array_values($query['ordering']) : [['field' => 'createdAt', 'direction' => 'DESC']];
        foreach ($ordering as $order) {
            if (!in_array($order['field'] ?? null, ['createdAt', 'id'], true)) {
                self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'Invalid ordering');
            }
        }
        if (!in_array('id', array_column($ordering, 'field'), true)) {
            $ordering[] = ['field' => 'id', 'direction' => $ordering[0]['direction'] ?? 'ASC'];
        }
        $compare = fn ($a, $b): int => is_string($a) || is_string($b) ? strcmp((string) $a, (string) $b) : $a <=> $b;
        usort($items, function (array $a, array $b) use ($ordering, $compare): int {
            foreach ($ordering as $order) {
                $result = $compare($a[$order['field']] ?? null, $b[$order['field']] ?? null);
                if ($result !== 0) {
                    return strtoupper($order['direction'] ?? 'ASC') === 'DESC' ? -$result : $result;
                }
            }
            return 0;
        });
        $signature = Values::json([$scope, $ordering]);
        if (isset($query['cursor'])) {
            $decoded = base64_decode((string) $query['cursor'], true);
            $cursor = $decoded === false ? null : json_decode($decoded, true);
            $after = $cursor['values'] ?? null;
            if (!is_array($cursor) || ($cursor['scope'] ?? null) !== $signature || !is_array($after) || !array_is_list($after) || count($after) !== count($ordering)) {
                self::fail(ErrorCodes::INVALID_CURSOR, null, 'The cursor is invalid or belongs to a different query.');
            }
            // Keyset: resume strictly after the last returned item's values.
            $items = array_values(array_filter($items, function (array $item) use ($ordering, $after, $compare): bool {
                foreach ($ordering as $i => $order) {
                    $result = $compare($item[$order['field']] ?? null, $after[$i]);
                    if ($result !== 0) {
                        return (strtoupper($order['direction'] ?? 'ASC') === 'DESC' ? -$result : $result) > 0;
                    }
                }
                return false;
            }));
        }
        $more = count($items) > $size;
        $taken = array_slice($items, 0, $size);
        $last = $taken === [] ? null : $taken[array_key_last($taken)];
        $cursor = $more && $last !== null
            ? base64_encode(Values::json(['scope' => $signature, 'values' => array_map(fn (array $order) => $last[$order['field']] ?? null, $ordering)])) : null;
        return ['items' => $taken, 'pageSize' => $size, 'hasMore' => $more, 'ordering' => $ordering, 'nextCursor' => $cursor];
    }

    private static function filter(string $expression): \Closure
    {
        preg_match_all('/"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[;,()]|[^;,()"\']+/', $expression, $match);
        $tokens = $match[0];
        if (implode('', $tokens) !== $expression) {
            throw new \LogicException("MockServerClient cannot parse the filter $expression");
        }
        // Whitespace between parentheses and separators carries nothing.
        $tokens = array_values(array_filter($tokens, fn (string $token) => trim($token) !== ''));
        $position = 0;
        $test = self::alternatives($tokens, $position);
        if ($position !== count($tokens)) {
            throw new \LogicException("MockServerClient cannot parse the filter $expression");
        }
        return $test;
    }

    /** `,` (or) of `;` (and) terms, read from `$tokens` until a closing `)` or the end. */
    private static function alternatives(array $tokens, int &$position): \Closure
    {
        $alternatives = [[]];
        while (true) {
            $alternatives[array_key_last($alternatives)][] = self::term($tokens, $position);
            $token = $tokens[$position] ?? null;
            if ($token === ';') {
                $position++;
            } elseif ($token === ',') {
                $position++;
                $alternatives[] = [];
            } else {
                break;
            }
        }
        return function (array $asset) use ($alternatives): bool {
            foreach ($alternatives as $tests) {
                if (array_reduce($tests, fn (bool $all, \Closure $test) => $all && $test($asset), true)) {
                    return true;
                }
            }
            return false;
        };
    }

    /** A `( … )` group or a comparison, whose `=in=`/`=out=` value list keeps its parentheses. */
    private static function term(array $tokens, int &$position): \Closure
    {
        if (($tokens[$position] ?? null) === '(') {
            $position++;
            $group = self::alternatives($tokens, $position);
            if (($tokens[$position] ?? null) !== ')') {
                throw new \LogicException('MockServerClient filters need a closing parenthesis');
            }
            $position++;
            return $group;
        }
        $text = '';
        $depth = 0;
        while (isset($tokens[$position])) {
            $token = $tokens[$position];
            if ($token === '(') {
                if (!preg_match('/=(in|out)=\s*$/', $text)) {
                    throw new \LogicException("MockServerClient cannot parse the filter term $text(");
                }
                $depth++;
            } elseif ($token === ')') {
                if ($depth === 0) {
                    break;
                }
                $depth--;
            } elseif ($depth === 0 && ($token === ';' || $token === ',')) {
                break;
            }
            $text .= $token;
            $position++;
        }
        return self::comparison($text);
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

    /** Keyword search fields, in the order matches are reported, and where each value sits in the asset. */
    private const SEARCH_FIELDS = ['name' => ['name'], 'id' => ['id'], 'externalId' => ['externalId'],
        'description' => ['description'], 'tags' => ['tags'], 'type' => ['type'], 'content.format' => ['content', 'format'],
        'content.extension' => ['content', 'extension'], 'classification.moderation.status' => ['classification', 'moderation', 'status']];

    /**
     * Keyword search like the API: every whitespace-separated token (case-insensitive, at most 8
     * distinct) must appear in some field. Results rank by the API's score, then newest first;
     * the mock has no semantic index.
     */
    private function search(array $query): array
    {
        // Like the API's query schema: a trimmed query of 1 to 200 characters, a limit of 1 to 20.
        $text = trim((string) ($query['query'] ?? ''));
        if ($text === '') {
            self::invalid('validation/too-small', 'query');
        }
        if (mb_strlen($text) > 200) {
            self::invalid('validation/too-big', 'query');
        }
        $limit = self::size($query, 'limit', 10, 20);
        $normalized = strtolower($text);
        $tokens = array_slice(array_values(array_unique(preg_split('/\s+/', $normalized))), 0, 8);
        $items = [];
        foreach ($this->assets as $asset) {
            $values = [];
            foreach (self::SEARCH_FIELDS as $field => $path) {
                $value = $asset;
                foreach ($path as $key) {
                    $value = is_array($value) ? ($value[$key] ?? null) : null;
                }
                $values[$field] = strtolower(implode(' ', array_map('strval', is_array($value) ? $value : ($value === null ? [] : [$value]))));
            }
            $contains = fn (string $value) => array_filter($tokens, fn ($token) => str_contains($value, $token)) !== [];
            foreach ($tokens as $token) {
                if (array_filter($values, fn ($value) => str_contains($value, $token)) === []) {
                    continue 2;
                }
            }
            $items[] = ['asset' => $asset, 'score' => self::searchScore($values, $normalized),
                'matchedFields' => array_keys(array_filter($values, $contains))];
        }
        usort($items, fn ($a, $b) => [$b['score'], $b['asset']['createdAt']] <=> [$a['score'], $a['asset']['createdAt']]);
        return ['query' => $text, 'items' => array_slice($items, 0, $limit), 'semanticStatus' => 'disabled'];
    }

    /** The API's keyword score for the whole normalized query. */
    private static function searchScore(array $values, string $query): int
    {
        ['id' => $id, 'externalId' => $externalId, 'name' => $name] = $values;
        return match (true) {
            $id === $query => 1000,
            $externalId === $query => 950,
            $name === $query => 900,
            str_starts_with($id, $query) => 800,
            str_starts_with($externalId, $query) => 750,
            str_starts_with($name, $query) => 700,
            str_contains($name, $query) => 600,
            str_contains($values['tags'], $query) => 500,
            default => 100,
        };
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
                self::fail(ErrorCodes::DUPLICATE_FOLDER_NAME, null, "A folder named \"$name\" already exists in this location.");
            }
        }
    }

    private function createFolder(array $json): array
    {
        if (!is_string($json['name'] ?? null) || $json['name'] === '') {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'Folder name is required');
        }
        $parentId = $json['parentId'] ?? null;
        if ($parentId !== null) {
            $this->folder($parentId);
        }
        $this->uniqueFolderName($json['name'], $parentId);
        $now = ($this->now)();
        $folder = ['id' => ($this->createId)(), 'projectId' => $this->projectId, 'parentId' => $parentId, 'name' => $json['name'],
            'createdAt' => $now, 'updatedAt' => $now];
        // Like the API, a new folder is 201 Created.
        $this->status = 201;
        return $this->folders[$folder['id']] = $folder;
    }

    /** One level of a folder tree with its visible ancestors, like the API's folder page. */
    private function listFolders(array $query): array
    {
        $size = self::size($query, 'pageSize', 100, 100);
        $search = strtolower((string) ($query['search'] ?? ''));
        $parentId = $query['parentId'] ?? null;
        $resolveOnly = self::flag($query['resolveOnly'] ?? null);
        $found = array_values(array_filter($this->folders, fn ($folder) => (($search !== '' && self::flag($query['searchAll'] ?? null)) || $folder['parentId'] === $parentId)
            && ($search === '' || str_contains(strtolower($folder['name']), $search))));
        $byDate = ($query['sort'] ?? null) === 'createdAt';
        // Like the database: names compare by code point, so case matters.
        usort($found, fn ($a, $b) => ($byDate ? $a['createdAt'] <=> $b['createdAt'] : strcmp($a['name'], $b['name'])) ?: strcmp($a['id'], $b['id']));
        if (strtoupper((string) ($query['direction'] ?? 'ASC')) === 'DESC') {
            $found = array_reverse($found);
        }
        $start = (int) ($query['pageIndex'] ?? 0) * $size;
        $page = $resolveOnly ? [] : array_slice($found, $start, $size);
        $ids = array_fill_keys(array_merge(array_values((array) ($query['ids'] ?? [])), $parentId === null ? [] : [$parentId], array_column($page, 'id')), true);
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
                if (isset($json['name']) && $json['name'] !== $folder['name']) {
                    $this->uniqueFolderName($json['name'], $folder['parentId'], $id);
                }
                if (isset($json['name'])) {
                    $folder['name'] = $json['name'];
                }
                return $this->folders[$id] = $this->touch($folder);
            case 'DELETE ':
                $hasAssets = array_filter($this->assets, fn ($asset) => $asset['folderId'] === $id) !== [];
                $hasChildren = array_filter($this->folders, fn ($child) => $child['parentId'] === $id) !== [];
                if ($hasAssets || $hasChildren) {
                    self::fail(ErrorCodes::FOLDER_NOT_EMPTY, null, 'The folder is not empty', ['hasAssets' => $hasAssets, 'hasChildren' => $hasChildren]);
                }
                unset($this->folders[$id]);
                return null;
            case 'POST move':
                $parentId = $json['parentId'] ?? null;
                for ($current = $parentId, $seen = []; $current !== null; $current = $this->folder($current)['parentId']) {
                    if ($current === $id || isset($seen[$current])) {
                        self::fail(ErrorCodes::FOLDER_PARENT_CYCLE);
                    }
                    $seen[$current] = true;
                }
                if ($parentId !== $folder['parentId']) {
                    $this->uniqueFolderName($folder['name'], $parentId, $id);
                }
                return $this->folders[$id] = $this->touch(['parentId' => $parentId] + $folder);
        }
        throw new \LogicException("MockServerClient does not emulate $method $suffix for a folder; enqueue a response for it");
    }

    /** Without `after` the feed starts from now, like the API; `limit` is 1 to 100, 50 by default. */
    private function listEvents(array $query): array
    {
        $limit = self::size($query, 'limit', 50, 100);
        if (!isset($query['after']) || $query['after'] === '') {
            return ['events' => [], 'cursor' => 'mock_' . count($this->events), 'hasMore' => false];
        }
        if (!preg_match('/^mock_(\d+)$/D', (string) $query['after'], $match) || (int) $match[1] > count($this->events)) {
            self::fail(ErrorCodes::INVALID_EVENT_CURSOR, null, 'Invalid event cursor', ['after' => $query['after']]);
        }
        $taken = array_slice($this->events, (int) $match[1], $limit);
        $next = (int) $match[1] + count($taken);
        return ['events' => $taken, 'cursor' => 'mock_' . $next, 'hasMore' => $next < count($this->events)];
    }

    /**
     * Saves each definition in order, like the API: an unchanged one returns the stored lens, a
     * changed one needs a greater version (`lens/version-conflict` otherwise, after the earlier
     * definitions are saved).
     */
    private function saveLenses(array $definitions): array
    {
        $saved = [];
        foreach ($definitions as $definition) {
            $old = $this->lenses[$definition['identifier']] ?? null;
            $now = ($this->now)();
            if ($old === null) {
                $saved[] = $this->lenses[$definition['identifier']] = ['id' => ($this->createId)(), 'projectId' => $this->projectId, 'userId' => null]
                    + $definition + ['createdAt' => $now, 'updatedAt' => $now];
                continue;
            }
            $same = ($old['name'] ?? null) === ($definition['name'] ?? null)
                && ($old['description'] ?? null) === ($definition['description'] ?? null)
                && ($old['type'] ?? null) === ($definition['type'] ?? null)
                && ($old['active'] ?? null) === ($definition['active'] ?? null)
                && Values::json(Values::canonical($old['transforms'] ?? null)) === Values::json(Values::canonical($definition['transforms'] ?? null));
            if ($same && ($old['version'] ?? null) === ($definition['version'] ?? null)) {
                $saved[] = $old;
                continue;
            }
            if (($definition['version'] ?? 0) > ($old['version'] ?? 0)) {
                $saved[] = $this->lenses[$definition['identifier']] = array_replace($old, $definition, ['updatedAt' => $now]);
                continue;
            }
            self::fail(ErrorCodes::LENS_VERSION_CONFLICT, null, 'A changed lens needs a greater version',
                ['currentVersion' => $old['version'], 'minimumVersion' => $old['version'] + 1, 'requestedVersion' => $definition['version'] ?? null]);
        }
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

    /** Serves stored content and placeholders like the CDN, with its headers. */
    private function serve(string $method, array $segments, array $query): Response
    {
        [, $project, $identifier, $resource] = $segments + [null, null, null, null];
        $asset = null;
        foreach ($this->assets as $candidate) {
            if ($candidate['id'] === $identifier || ($candidate['externalId'] ?? null) === $identifier) {
                $asset = $candidate;
            }
        }
        if ($project !== $this->projectId || $asset === null || !in_array($resource, ['original', 'rendered', 'placeholder'], true)) {
            return $this->json(404, ['code' => 'asset/not-found', 'message' => 'Asset not found']);
        }
        $notAvailable = fn () => $this->json(403, ['code' => 'asset/not-available', 'message' => 'Asset is not available']);
        $status = $asset['classification']['moderation']['status'];
        if ($resource === 'placeholder') {
            // Like the CDN: an image's ThumbHash, public for public assets whatever their moderation
            // status; refused for purged assets, assets without one and, for private assets, keys
            // without `assets:download`.
            $thumbhash = $asset['content']['image']['thumbhash'] ?? null;
            $public = $asset['visibility'] === 'public';
            if ($thumbhash === null || $status === 'purged' || (!$public && !$this->canDownload($asset['folderId'] ?? null))) {
                return $notAvailable();
            }
            return $this->cdnResponse($method, Placeholder::png($thumbhash), ['Content-Type' => 'image/png',
                'Cache-Control' => ($public ? 'public' : 'private') . ', max-age=3600', 'Cache-Tag' => 'asset-' . $asset['id'],
                'ETag' => '"' . $thumbhash . '"']);
        }
        // Delivery checks come first and refuse everyone, like the CDN.
        $stored = $this->content[$asset['id']] ?? null;
        if ($stored === null || $asset['upload']['status'] === 'uploading' || in_array($status, ['blocked', 'purged'], true)
            || $asset['classification']['status'] === 'failed' || $asset['content']['status'] === 'removed') {
            return $notAvailable();
        }
        // Age-restricted assets are delivered like private ones, unless a public one is requested
        // with `allowAgeRestricted=true`.
        $private = $asset['visibility'] !== 'public' || ($status === 'age-restricted' && ($query['allowAgeRestricted'] ?? null) !== 'true');
        if ($private && !$this->canDownload($asset['folderId'] ?? null)) {
            return $this->json(403, ['code' => 'asset/api-key-missing-permission', 'message' => 'This API key needs assets:download permission for this asset’s folder.']);
        }
        $type = $stored['type'] === '' ? 'application/octet-stream' : $stored['type'];
        $image = $asset['type'] === 'image';
        $base = strtolower(trim(explode(';', $type)[0]));
        // Like the CDN: an image's bytes are immutable for a year, other content is kept for an hour,
        // by shared caches only when delivery is public.
        return $this->cdnResponse($method, $stored['bytes'], ['Content-Type' => $type,
            'Cache-Control' => ($private ? 'private' : 'public') . ', ' . ($image ? 'max-age=31536000, immutable' : 'max-age=3600'),
            'Cache-Tag' => 'asset-' . $asset['id']]
            + ($image ? ['ETag' => '"' . $asset['id'] . '"', 'Expires' => gmdate('D, d M Y H:i:s', intdiv(($this->now)(), 1000) + 31536000) . ' GMT'] : [])
            + ['X-Content-Type-Options' => 'nosniff', 'Content-Security-Policy' => "sandbox; default-src 'none'"]
            // Content a browser could run as a document is served as a download.
            + (in_array($base, self::ACTIVE_CONTENT_TYPES, true) || str_ends_with($base, '+xml') ? ['Content-Disposition' => 'attachment'] : []));
    }

    private function cdnResponse(string $method, string $bytes, array $headers): Response
    {
        return new Response(200, $headers + ['Content-Length' => (string) strlen($bytes), 'X-Request-Id' => $this->requestId()],
            $method === 'HEAD' ? '' : $bytes);
    }
}
