<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\Assets;
use CalmLens\CalmLensException;
use CalmLens\Cdn;
use CalmLens\ErrorCodes;
use CalmLens\Internal\Session;
use CalmLens\Internal\Transforms;
use CalmLens\Internal\Values;
use CalmLens\ModerationContext;
use CalmLens\SdkErrorCodes;
use CalmLens\ServerClient;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Exception\ConnectTimeoutException;
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
 * retrieve, list, search, update, move and delete; folders, hash lists, policies, lenses, idempotency keys
 * and the events feed behave like the API's (uploads are not matched against hash lists); the CDN serves stored bytes and placeholders; and errors use
 * the API's codes, statuses, `X-Request-Id` header and body shape (schema errors are
 * `validation/invalid-request`, listing each field's `path`, `message` and issue `code`, such as
 * `validation/too-big`, in `details.issues`). It does not classify content: the
 * `moderate` callable decides each asset the mock moderates (see the constructor), and
 * `completeProcessing` finishes a queued one. A decided asset gets the decision's full report.
 * Content is kept only with `keepContentAfterProcessing: true`; otherwise it is removed once
 * classification completes, as in the API. A `purged` decision removes the content with reason
 * `policy`; a reviewer's purge (`decide`) with reason `requested`. Like the API, an asset whose
 * content is held reports its `content.rendered` file and `content.preview` (see `rendering`), a
 * decided one's preview with a ThumbHash for its placeholder, and both go with its content or
 * while a safety hold is on. Like the API, a completed upload adds
 * `asset.uploaded`, then `asset.classified` and the automated `asset.<status>` once decided, or
 * `asset.failed`; deleting an asset, removing its content and retrying it add `asset.deleted`,
 * `asset.content-removed` and `asset.retried`. Every event names its `actor`: the mock API key
 * (`['type' => 'api-key', 'id' => null]`, as mock keys have no ID) for what the client does,
 * `automated` moderation for the pipeline's decisions, and a `user` for `decide`. The project starts on the organisation's own
 * General preset policy, `live`; the mock's presets have one release (version 1), every category at its default action with no rules, and policies never decide uploads.
 *
 * Like the CDN, a safety hold refuses every resource, the placeholder included, with 403
 * `asset/not-available`. Then it checks delivery: blocked, purged and failed assets, and assets whose
 * content was removed or is still uploading, return 403 `asset/not-available` whatever the key.
 * Then access: an age-restricted asset requested without `'viewerClaims' => ['ageConfirmed' => true]`
 * returns 403 `viewer/age-confirmation-required` whatever the key, and a private asset needs an
 * `assets:download` grant for its folder, or a grant from `cdn->signAssetUrl`, which `fetchCdn`
 * loads without the API key as a browser would. Then whether the asset has the resource (404
 * `asset/no-rendered-version`), and lenses and transforms only on a still image: the preview, or a
 * rendered image. The mock converts nothing: an upload stands in for its rendered file and an
 * image's preview, and the placeholder PNG for a website screenshot, document page or audio
 * waveform. The default
 * key has no grants, like a real key without `assets:download`; pass an `apiKey` from
 * `createApiKey()`, or call `setApiKeyGrants()`, to grant downloads.
 *
 * Waits (retry backoff and `assets->waitForDecision`) take no real time: they advance a virtual
 * clock, so a decision that never comes times out at once.
 *
 * `failNextRequest` failures come first (for any request, or the next to one operation), then
 * enqueued responses and exceptions in order, before the stand-in answers. Each failure fails one
 * request, so a client retry takes the next failure or reaches the stand-in.
 */
final class MockServerClient
{
    /** What `decide` accepts: a reviewer's decision. */
    public const DECISIONS = ['allowed', 'limited', 'age-restricted', 'blocked', 'purged'];
    /** The moderation status each `asset.<status>` event announces. */
    private const ANNOUNCED_STATUSES = ['asset.allowed' => 'allowed', 'asset.limited' => 'limited',
        'asset.age-restricted' => 'age-restricted', 'asset.blocked' => 'blocked', 'asset.purged' => 'purged'];
    /** The ThumbHash the mock gives every processed asset's preview, standing in for one computed from its pixels. */
    public const THUMBHASH = '1QcSHQRnh493V4dIh4eXh1h4kJUI';
    /** Audio and video formats browsers play as uploaded, so the API serves them as stored. */
    private const BROWSER_SAFE_MEDIA_FORMATS = ['video/mp4', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/ogg'];
    /** Spreadsheets, which have no rendered file or preview. */
    private const SPREADSHEET_MIME_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.macroenabled.12', 'application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet'];
    /** Removing or withholding content removes its rendered file and preview, as the API does. */
    private const NO_RENDERING = ['rendered' => null, 'hls' => null, 'preview' => null];
    /** The size of the waveform the API makes as an audio asset's preview. */
    private const WAVEFORM_SIZE = ['width' => 1200, 'height' => 300];
    /** The resources an asset's CDN path names. */
    private const PATH_RESOURCES = ['original', 'rendered', 'preview', 'hls', 'embed', 'placeholder', 'info'];
    /** The page the mock serves at `/embed`, standing in for the CDN's embed page. */
    private const EMBED_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title></head><body></body></html>';
    private const MIB = 1024 * 1024;
    /** Like the API: an upload has at most this many parts. */
    private const MAX_UPLOAD_PARTS = 10000;
    /** An asset ID as the API's schema accepts it: `asset_` and 20 base62 characters. */
    private const ASSET_ID_PATTERN = '/^asset_[0-9A-Za-z]{20}$/D';
    /** The actor of events the mock's API key causes: mock keys have no ID. */
    public const API_KEY_ACTOR = ['type' => 'api-key', 'id' => null];
    /** The actor of a reviewer's decision through the `decide` test hook. */
    public const REVIEWER_ACTOR = ['type' => 'user', 'id' => null];
    /** The actor of the pipeline's moderation events. */
    public const AUTOMATED_ACTOR = ['type' => 'automated', 'id' => null];
    /** An event type's shape (`resource.action`), as the mock checks `types` without the catalog. */
    private const EVENT_TYPE_PATTERN = '/^[a-z][a-z-]*\.[a-z][a-z-]*$/D';
    /** The client methods `failNextRequest` can target. */
    public const OPERATIONS = ['assets.list', 'assets.each', 'assets.search', 'assets.retrieve', 'assets.waitForDecision', 'assets.update',
        'assets.listChildren', 'assets.eachChild', 'assets.listTimeline', 'assets.eachTimelineSegment', 'assets.create', 'assets.classify',
        'assets.uploadPart', 'assets.move', 'assets.retry', 'assets.explain', 'assets.decide', 'assets.removeContent', 'assets.delete',
        'assets.batch', 'text.classify', 'cdn.serve', 'cdn.getAssetInfo', 'cdn.signAssetUrl', 'events.list', 'folders.list', 'folders.each',
        'folders.retrieve', 'folders.create', 'folders.update', 'folders.delete', 'folders.move', 'hashLists.list', 'hashLists.each',
        'hashLists.retrieve', 'hashLists.create', 'hashLists.update', 'hashLists.delete', 'hashLists.listEntries', 'hashLists.eachEntry',
        'hashLists.addEntry', 'hashLists.removeEntry', 'policies.list', 'policies.each', 'policies.retrieve', 'policies.create',
        'policies.update', 'policies.reset', 'policies.upgrade', 'policies.setAutomaticUpdates', 'policies.delete',
        'policies.retrieveAssigned', 'policies.assign', 'lenses.list', 'lenses.each', 'lenses.create', 'lenses.retrieve',
        'lenses.update', 'lenses.delete', 'ensureLens', 'ensureLenses'];
    private const ACTIVE_CONTENT_TYPES = ['image/svg+xml', 'application/xhtml+xml', 'text/html', 'application/xml', 'text/xml'];

    /** @var array<string, array> Assets by ID, with the API's field names. Change them to arrange a test. */
    public array $assets = [];
    /** @var array<string, array{type: string, bytes: string}> Stored content by asset ID. */
    public array $content = [];
    /** @var array<string, array> Folders by ID. */
    public array $folders = [];
    /** @var array<string, array> Hash lists by ID, oldest first. */
    public array $hashLists = [];
    /** @var array<string, array> Hash list entries by ID, oldest first. */
    public array $hashListEntries = [];
    /** @var list<array> The events feed, oldest first. */
    public array $events = [];
    /** @var array<string, int> Each asset's latest `assetSequence`, which the API keeps on the asset row. */
    private array $assetEventSequences = [];
    /** @var array<string, array> Lenses by identifier. */
    public array $lenses = [];

    private ServerClient $client;
    private array $queue = [];
    /** @var list<array{failure: string|\Throwable, operation: ?string, details: array, retryAfter: ?int}> */
    private array $failures = [];
    /** @var list<RecordedRequest> */
    private array $history = [];
    /** @var array<string, array{0: string, 1: int, 2: string}> Saved responses by idempotency key. */
    private array $idempotent = [];
    /** @var array<string, array{queue: bool, total: ?int}> Open multipart uploads, as they started. */
    private array $uploads = [];
    /** The processing options each asset was uploaded with, which the API keeps but doesn't return. */
    private array $processingOptions = [];
    private array $grants;
    /** The client's API key: a CDN request without it, as `fetchCdn` sends, has no grants. */
    private string $apiKey;
    /** Sends a CDN request through the mock without the API key, for `fetchCdn`. */
    private Client $browser;
    private float $elapsed = 0.0;
    private int $requestCount = 0;
    /** Every API cursor list returns this many items unless `pageSize` says otherwise. */
    private const DEFAULT_PAGE_SIZE = 50;
    private const MAX_PAGE_SIZE = 100;
    /** The status of the response being answered: 200, 201 for a new folder, hash list, entry or policy, or 202 for a queued batch. */
    private int $status = 200;
    private \Closure $now;
    private \Closure $createId;
    private \Closure $moderate;
    private string $baseUrl;
    private string $cdnBaseUrl;

    /**
     * @param ?callable(MockModerationInput): (string|MockDecision) $moderate decides each asset the
     *   mock moderates: uploads (`assets->create`, `assets->classify`, `text->classify` and final
     *   parts), retries, reruns and `completeProcessing` without a decision. It receives the stored
     *   asset with its content, the trigger and whether the work is queued, and returns a status
     *   from `MockDecision::STATUSES` or a `MockDecision`. `pending` leaves the asset processing and
     *   `failed` fails it with `failureReason` `processing-error`, retryable. By default queued work
     *   stays `pending` until `completeProcessing`, which allows it, and everything else is `allowed`.
     * @param ?string $apiKey the client's API key. Its grants, from `createApiKey()`, decide CDN
     *   downloads of private and age-restricted content; the default key has none.
     * @param ?callable $createId receives the prefix of the new object's ID (`asset`, `fldr`, `hl`,
     *   `hle`, `pol`, `lens`, `evt`, `rev` or `batch`) and returns the ID; by default, like the API, the prefix, `_`
     *   and 20 random base62 characters, such as `asset_5Gm2Rk8XqT3wLp9VbN4c`.
     * @param int $maxRetries retries for the mock's client; 0 by default so enqueued failures surface.
     * @param int $maxResponseBytes the largest response body the mock's client reads, as for `ServerClient`.
     * @param int|float|null $uploadTimeout the mock's client's binary upload timeout, as for `ServerClient`.
     * @param int $partSizeBytes content larger than this is uploaded in parts, as for `ServerClient`.
     */
    public function __construct(
        public readonly string $projectId = 'project-1',
        ?callable $moderate = null,
        ?callable $now = null,
        ?callable $createId = null,
        string $baseUrl = 'https://api.calmlens.invalid/v1',
        string $cdnBaseUrl = 'https://cdn.calmlens.invalid/v1',
        #[\SensitiveParameter] ?string $apiKey = null,
        int $maxRetries = 0,
        int|float $maxResponseBytes = ServerClient::DEFAULT_MAX_RESPONSE_BYTES,
        int|float|null $uploadTimeout = ServerClient::DEFAULT_UPLOAD_TIMEOUT,
        int|float $partSizeBytes = ServerClient::DEFAULT_PART_SIZE_BYTES,
    ) {
        $this->moderate = \Closure::fromCallable($moderate
            ?? fn (MockModerationInput $input): string => $input->queued && $input->trigger !== MockModerationInput::COMPLETE ? 'pending' : 'allowed');
        $last = 0;
        // The default clock moves on by at least a millisecond per reading, so assets created in a
        // row have increasing createdAt and orderings never depend on random IDs.
        $this->now = \Closure::fromCallable($now ?? function () use (&$last): int {
            return $last = max((int) floor(microtime(true) * 1000), $last + 1);
        });
        $this->createId = \Closure::fromCallable($createId ?? fn (string $prefix): string => Values::id($prefix));
        $this->grants = $apiKey === null ? [] : self::grantsOf($apiKey);
        $this->apiKey = $apiKey ?? 'mock-key';
        $stack = HandlerStack::create(fn (RequestInterface $request, array $options) => $this->handle($request));
        $this->browser = new Client(['handler' => $stack]);
        $this->client = new ServerClient($apiKey ?? 'mock-key', $projectId, $baseUrl, $cdnBaseUrl, maxRetries: $maxRetries,
            httpClient: new Client(['handler' => $stack]), maxResponseBytes: $maxResponseBytes,
            uploadTimeout: $uploadTimeout, partSizeBytes: $partSizeBytes);
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
     * Fails the next request (or, with `operation`, the next one that client method sends, one of
     * `OPERATIONS`, such as `assets.create` or `cdn.serve`) instead of answering it, leaving the
     * stored state unchanged. Each queued failure fails one request, so a retry takes the next
     * failure or reaches the stand-in. `transport-error` and `timeout` fail the connection, so the
     * client throws `ConnectionException` (`sdk/transport-error`) or `TimeoutException`
     * (`sdk/timeout`). An API error code, such as `usage/free-uploads-exhausted`, is answered as the API
     * answers it: its HTTP status, message and request ID, with `details` and, with `retryAfter`,
     * a `Retry-After` header of that many seconds. A `CalmLensException` is answered with its
     * status (or the API's status for its code), a JSON `{code, message, details}` body and its
     * headers (such as `Retry-After`). Any other exception is thrown by the transport as given.
     * Throws `InvalidArgumentException` (`sdk/invalid-argument`) for an unknown failure or
     * operation, or `details` or `retryAfter` without an API error code.
     */
    public function failNextRequest(string|\Throwable $failure = 'transport-error', ?string $operation = null, array $details = [], ?int $retryAfter = null): self
    {
        $code = is_string($failure) && isset(ErrorCodes::STATUSES[$failure]);
        if (is_string($failure) && !$code && !in_array($failure, ['transport-error', 'timeout'], true)) {
            throw self::invalidArgument("Mock failures are transport-error, timeout, an API error code or an exception (got $failure)");
        }
        if ($operation !== null && !in_array($operation, self::OPERATIONS, true)) {
            throw self::invalidArgument("$operation is not a client method the mock can fail; use one of MockServerClient::OPERATIONS");
        }
        if (!$code && ($details !== [] || $retryAfter !== null)) {
            throw self::invalidArgument('details and retryAfter apply only to an API error code');
        }
        if ($retryAfter !== null && $retryAfter < 0) {
            throw self::invalidArgument('retryAfter must be a whole number of seconds');
        }
        $this->failures[] = ['failure' => $failure, 'operation' => $operation, 'details' => $details, 'retryAfter' => $retryAfter];
        return $this;
    }

    /** Queued responses and failures not used yet. */
    public function pending(): int { return count($this->queue) + count($this->failures); }

    /** @return list<RecordedRequest> every request received, oldest first, with the status it was answered with. */
    public function requests(): array { return $this->history; }

    /** Forgets the recorded requests, so `requests()` lists only those sent afterwards. */
    public function clearRequests(): self
    {
        $this->history = [];
        return $this;
    }

    /**
     * Adds an event to the feed returned by `events.list`. Omitted `id`, `projectId`, `severity`,
     * `title`, `description`, `assetId`, `asset`, `actor` (the mock API key,
     * `['type' => 'api-key', 'id' => null]`), `facts` and `createdAt` are filled in; when `assetId` names a stored
     * asset, the event carries a snapshot of its status, as the API's events do, with the moderation
     * status an `asset.<status>` event announces. `assetSequence` is assigned like the API's (any
     * given one is ignored): the asset's next number, from 1, or null without an `assetId`. Pass the result to
     * `Webhooks::toPayload` to build a matching webhook body.
     */
    public function enqueueEvent(array $event): array
    {
        $now = ($this->now)();
        $assetId = $event['assetId'] ?? null;
        $snapshot = is_string($assetId) && isset($this->assets[$assetId]) ? $this->snapshot($this->assets[$assetId]) : null;
        // An `asset.<status>` event carries the moderation status it announces.
        $announced = self::ANNOUNCED_STATUSES[$event['type'] ?? ''] ?? null;
        if ($snapshot !== null && $announced !== null) {
            $snapshot['classification']['moderation']['status'] = $announced;
        }
        // Like the API: each event about an asset takes the asset's next number; others have none.
        $sequence = null;
        if (is_string($assetId) && $assetId !== '') {
            $sequence = $this->assetEventSequences[$assetId] = ($this->assetEventSequences[$assetId] ?? 0) + 1;
        }
        unset($event['assetSequence']);
        $event += ['id' => ($this->createId)('evt'), 'projectId' => $this->projectId, 'severity' => 'low',
            'title' => $event['type'] ?? '', 'description' => null, 'assetId' => null, 'assetSequence' => $sequence,
            'asset' => $snapshot, 'actor' => self::API_KEY_ACTOR, 'facts' => [], 'createdAt' => $now];
        $this->events[] = $event;
        return $event;
    }

    /**
     * Applies a reviewer's decision (`allowed`, `limited`, `age-restricted`, `blocked` or `purged`) to a
     * stored asset, as the portal would: the moderation status changes (`purged` also removes the
     * content with reason `requested` and first adds an `asset.content-removed` event), the review
     * joins `manualReviews`, and an `asset.<decision>` event with the catalog's severity (`low` for
     * `allowed` and `limited`, `high` otherwise) whose `actor` is a `user` joins the feed.
     * The moderation report stays as it was. Throws `InvalidArgumentException`
     * (`sdk/invalid-argument`) for another outcome, and `NotFoundException` (`asset/not-found`)
     * for an unknown asset. To finish processing as moderation would, use `completeProcessing`.
     */
    public function decide(string $assetId, string $outcome): array
    {
        if (!in_array($outcome, self::DECISIONS, true)) {
            throw self::invalidArgument('decide takes ' . implode(', ', self::DECISIONS) . " (got $outcome)");
        }
        $asset = $this->applyOutcome($this->ownAsset($assetId), $outcome, 'requested');
        $asset['classification']['moderation']['manualReviews'][] = self::review(($this->createId)('rev'), $outcome, null, ($this->now)());
        $this->assets[$assetId] = $asset;
        if ($outcome === 'purged') {
            $this->lifecycleEvent('asset.content-removed', $asset, actor: self::REVIEWER_ACTOR);
        }
        $this->enqueueEvent(['type' => 'asset.' . $outcome, 'severity' => in_array($outcome, ['allowed', 'limited'], true) ? 'low' : 'high',
            'title' => 'asset.' . $outcome, 'assetId' => $assetId, 'asset' => $this->snapshot($asset), 'actor' => self::REVIEWER_ACTOR,
            'facts' => [['key' => 'asset-type', 'value' => $asset['type']],
                ['key' => 'asset-name', 'value' => $asset['name'], 'url' => 'https://calmlens.com/go/asset/' . $assetId], ['key' => 'note', 'value' => null]]]);
        return $asset;
    }

    /**
     * Finishes processing an asset as moderation would: with `$decision` (a status from
     * `MockDecision::STATUSES` or a `MockDecision`), or else what `moderate` returns for the
     * `complete` trigger. A decision adds `asset.classified` and the automated `asset.<status>`
     * event, `failed` adds `asset.failed`, and `pending` leaves the asset processing; no manual
     * review is recorded. Throws `NotFoundException` (`asset/not-found`) for an unknown asset and
     * `InvalidArgumentException` (`sdk/invalid-argument`) for one that isn't processing.
     */
    public function completeProcessing(string $assetId, string|MockDecision|null $decision = null): array
    {
        $asset = $this->ownAsset($assetId);
        if ($asset['classification']['status'] !== 'processing') {
            throw self::invalidArgument("asset $assetId isn't processing");
        }
        return $this->moderateStored($asset, MockModerationInput::COMPLETE, $decision === null ? null : MockDecision::from($decision));
    }

    /**
     * A manual review as the API returns it. Either way the review is the mock API key's, and mock
     * API keys have no ID, so `decidedBy` is `['type' => 'api-key', 'id' => null]`; the test hook
     * records no note, the API's handler records it.
     */
    private static function review(string $id, string $decision, ?string $note, int $reviewedAt): array
    {
        return ['id' => $id, 'decision' => $decision, 'note' => $note, 'decidedBy' => ['type' => 'api-key', 'id' => null],
            'reviewedAt' => $reviewedAt, 'applied' => true];
    }

    private function ownAsset(string $assetId): array
    {
        return $this->assets[$assetId] ?? throw CalmLensException::create(ErrorCodes::ASSET_NOT_FOUND, 'Asset not found', 404);
    }

    private static function invalidArgument(string $message): CalmLensException
    {
        return CalmLensException::create(SdkErrorCodes::INVALID_ARGUMENT, $message);
    }

    /**
     * Adds an `asset.deleted`, `asset.content-removed` or `asset.retried` event, like the API: the
     * mock API key's unless `$actor` says otherwise, with a `batch-id` fact when a batch caused it.
     */
    private function lifecycleEvent(string $type, array $asset, ?string $batchId = null, array $actor = self::API_KEY_ACTOR): void
    {
        $name = ['key' => 'asset-name', 'value' => $asset['name']];
        // A deleted asset has no portal page to link to.
        if ($type !== 'asset.deleted') {
            $name['url'] = 'https://calmlens.com/go/asset/' . $asset['id'];
        }
        $facts = [$name, ['key' => 'asset-type', 'value' => $asset['type']]];
        if ($batchId !== null) {
            $facts[] = ['key' => 'batch-id', 'value' => $batchId];
        }
        $this->enqueueEvent(['type' => $type, 'severity' => 'low', 'assetId' => $asset['id'], 'asset' => $this->snapshot($asset),
            'actor' => $actor, 'facts' => $facts]);
    }

    private function snapshot(array $asset): array
    {
        return ['id' => $asset['id'], 'externalId' => $asset['externalId'] ?? null, 'uploadPresetId' => $asset['uploadPresetId'] ?? null,
            'upload' => ['status' => $asset['upload']['status']], 'classification' => ['status' => $asset['classification']['status'],
                'testInput' => $asset['classification']['testInput'], 'moderation' => ['status' => $asset['classification']['moderation']['status']]], 'content' => ['status' => $asset['content']['status']]];
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
            return rawurldecode($this->cdnSegments($request)[3] ?? '') === 'info' ? ['cdn.getAssetInfo'] : ['cdn.serve'];
        }
        $method = $request->getMethod();
        if (($parts[0] ?? null) === 'projects') {
            if (self::isTimelineRoute($method, $parts)) {
                return ['assets.listTimeline', 'assets.eachTimelineSegment'];
            }
            $route = $method . ' ' . implode('/', array_slice($parts, 2));
            return match ($route) {
                'GET events' => ['events.list'],
                'PUT lenses' => ['ensureLenses', 'ensureLens'],
                'GET lenses' => ['lenses.list', 'lenses.each'],
                'POST lenses' => ['lenses.create'],
                'GET folders' => ['folders.list', 'folders.each'],
                'POST folders' => ['folders.create'],
                'GET hash-lists' => ['hashLists.list', 'hashLists.each'],
                'POST hash-lists' => ['hashLists.create'],
                'GET policy' => ['policies.retrieveAssigned'],
                'PUT policy' => ['policies.assign'],
                'GET assets' => ['assets.list', 'assets.each'],
                'GET assets/search' => ['assets.search'],
                'POST assets/batch' => ['assets.batch'],
                'POST signed-asset-urls' => ['cdn.signAssetUrl'],
                'POST assets' => self::waits($query) ? ['assets.classify', 'text.classify'] : ['assets.create'],
                default => [],
            };
        }
        $suffix = $parts[2] ?? '';
        $resource = $parts[0] ?? '';
        if ($resource === 'policies' && count($parts) <= 3) {
            $name = isset($parts[1])
                ? ['GET ' => 'retrieve', 'PATCH ' => 'update', 'DELETE ' => 'delete', 'POST reset' => 'reset', 'POST upgrade' => 'upgrade',
                    'PUT automatic-updates' => 'setAutomaticUpdates'][$method . ' ' . $suffix] ?? null
                : ['GET' => 'list', 'POST' => 'create'][$method] ?? null;
            return $name === null ? [] : ($name === 'list' ? ['policies.list', 'policies.each'] : ["policies.$name"]);
        }
        if ($resource === 'lenses' && isset($parts[1]) && !isset($parts[2])) {
            $name = ['GET' => 'retrieve', 'PATCH' => 'update', 'DELETE' => 'delete'][$method] ?? null;
            return $name === null ? [] : ["lenses.$name"];
        }
        if ($resource === 'hash-lists' && isset($parts[1])) {
            $name = ['GET ' => 'retrieve', 'PATCH ' => 'update', 'DELETE ' => 'delete', 'GET entries' => 'listEntries', 'POST entries' => 'addEntry'][$method . ' ' . $suffix] ?? null;
            return $name === null ? [] : ($name === 'listEntries' ? ['hashLists.listEntries', 'hashLists.eachEntry'] : ["hashLists.$name"]);
        }
        if ($resource === 'hash-list-entries' && isset($parts[1])) {
            return $method === 'DELETE' && $suffix === '' ? ['hashLists.removeEntry'] : [];
        }
        $names = ['GET ' => 'retrieve', 'PATCH ' => 'update', 'DELETE ' => 'delete', 'POST move' => 'move',
            'GET children' => 'listChildren', 'DELETE content' => 'removeContent', 'POST retry' => 'retry',
            'POST explain' => 'explain', 'POST decision' => 'decide', 'POST part' => 'uploadPart'];
        $name = $names[$method . ' ' . $suffix] ?? null;
        if ($name === null || !in_array($resource, ['assets', 'folders'], true)) {
            return [];
        }
        return match (true) {
            $name === 'retrieve' && $resource === 'assets' => ['assets.retrieve', 'assets.waitForDecision'],
            $name === 'listChildren' => ['assets.listChildren', 'assets.eachChild'],
            default => ["$resource.$name"],
        };
    }

    /**
     * The path segments of a CDN request after the CDN base URL, as sent, still percent-encoded:
     * like the CDN, the asset segment and the selector are read before decoding, as an external ID
     * may hold an encoded `/`.
     *
     * @return list<string>
     */
    private function cdnSegments(RequestInterface $request): array
    {
        $raw = substr((string) $request->getUri()->withQuery('')->withFragment(''), strlen($this->cdnBaseUrl));
        return array_values(array_filter(explode('/', $raw), fn ($part) => $part !== ''));
    }

    /** Records the request with the status it is answered with, null when it fails without a response. */
    private function handle(RequestInterface $request): PromiseInterface
    {
        $body = (string) $request->getBody();
        $request = $request->withBody(\GuzzleHttp\Psr7\Utils::streamFor($body));
        $cdn = str_starts_with((string) $request->getUri()->withQuery(''), $this->cdnBaseUrl . '/');
        $recorded = RecordedRequest::of($request, null, $cdn ? $this->cdnBaseUrl : $this->baseUrl);
        try {
            $answer = $this->answer($request, $body, $cdn, $recorded->path);
        } finally {
            $this->history[] = new RecordedRequest($recorded->method, $recorded->path, $recorded->query,
                isset($answer) && $answer instanceof ResponseInterface ? $answer->getStatusCode() : null, $request);
        }
        return $answer instanceof ResponseInterface ? Create::promiseFor($answer) : Create::rejectionFor($answer);
    }

    private function answer(RequestInterface $request, string $body, bool $cdn, string $path): ResponseInterface|\Throwable
    {
        parse_str($request->getUri()->getQuery(), $query);
        $parts = RecordedRequest::segments($path);
        $operations = $this->operations($request, $cdn, $parts, $query);
        foreach ($this->failures as $index => $failure) {
            if ($failure['operation'] === null || in_array($failure['operation'], $operations, true)) {
                array_splice($this->failures, $index, 1);
                return $this->failure($failure, $request);
            }
        }
        $queued = array_shift($this->queue);
        if ($queued !== null) {
            return $queued;
        }
        if ($cdn) {
            return $this->serve($request->getMethod(), $this->cdnSegments($request), $query, $request->getHeaderLine('X-Api-Key') === $this->apiKey);
        }
        // The HTTP library trims header values, as every HTTP stack does before the API sees them.
        $key = $request->hasHeader('Idempotency-Key') ? $request->getHeaderLine('Idempotency-Key') : null;
        if ($key !== null && (strlen($key) > 255 || !preg_match('/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/D', $key))) {
            return $this->error(ErrorCodes::INVALID_IDEMPOTENCY_KEY, 'Invalid idempotency key');
        }
        $fingerprint = hash('sha256', Values::json([$request->getMethod(), $path, $request->getUri()->getQuery(), hash('sha256', $body)]));
        if ($key !== null && isset($this->idempotent[$key])) {
            [$saved, $status, $bytes] = $this->idempotent[$key];
            return $saved !== $fingerprint
                ? $this->error(ErrorCodes::IDEMPOTENCY_KEY_REUSED, 'Idempotency key reused with a different request')
                : new Response($status, ['Content-Type' => 'application/json', 'Idempotent-Replayed' => 'true', 'X-Request-Id' => $this->requestId()], $bytes);
        }
        try {
            $json = $request->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : [];
            $this->status = 200;
            $data = $this->api($request, $parts, $query, is_array($json) ? $json : [], $body);
            // Like the API, deletes answer 200 with an empty object.
            $response = $this->json($this->status, $data ?? new \stdClass());
        } catch (CalmLensException $failure) {
            // A test's own mistake, such as `moderate` returning an unknown status, is thrown as is.
            if ($failure->status === null) {
                throw $failure;
            }
            // Raised by fail(): answer like the API does, and leave the key unsaved.
            return $this->error($failure->errorCode, $failure->getMessage(), $failure->status, $failure->details);
        }
        if ($key !== null) {
            $this->idempotent[$key] = [$fingerprint, $response->getStatusCode(), (string) $response->getBody()];
            $response->getBody()->rewind();
        }
        return $response;
    }

    /** @param array{failure: string|\Throwable, details: array, retryAfter: ?int} $failure */
    private function failure(array $failure, RequestInterface $request): ResponseInterface|\Throwable
    {
        ['failure' => $failure, 'details' => $details, 'retryAfter' => $retryAfter] = $failure;
        if ($failure instanceof CalmLensException) {
            $status = $failure->status ?? ErrorCodes::STATUSES[$failure->errorCode] ?? 400;
            return $this->error($failure->errorCode, $failure->getMessage(), $status, $failure->details, $failure->headers, $failure->requestId);
        }
        if ($failure instanceof \Throwable) {
            return $failure;
        }
        if (isset(ErrorCodes::STATUSES[$failure])) {
            return $this->error($failure, "Simulated $failure", null, $details, $retryAfter === null ? [] : ['Retry-After' => (string) $retryAfter]);
        }
        if ($failure !== 'timeout') {
            return new ConnectException('Simulated network failure', $request);
        }
        // Guzzle 8 throws a timeout class; Guzzle 7 a ConnectException carrying cURL's timeout errno.
        return class_exists(ConnectTimeoutException::class)
            ? new ConnectTimeoutException('Simulated timeout', $request)
            : new ConnectException('Simulated timeout', $request, null, ['errno' => 28]);
    }

    /** Fails the request being answered with an API error; the status defaults to the code's. */
    private static function fail(string $code, ?int $status = null, string $message = '', array $details = []): never
    {
        throw new CalmLensException($code, $message ?: $code, $status ?? ErrorCodes::STATUSES[$code] ?? 400, $details);
    }

    /**
     * A request the API's schema refuses: `validation/invalid-request` with HTTP 400, listing the
     * field and its issue code (such as `validation/too-big`) in `details.issues`.
     */
    private static function invalid(string $code, string $path): never
    {
        self::fail(ErrorCodes::INVALID_REQUEST, 400, "Invalid $path", ['issues' => [['path' => $path, 'message' => "Invalid $path", 'code' => $code]]]);
    }

    /**
     * Refuses `metadata` the API's schema refuses: it is null or a list of `{ id, value }` objects
     * with a string `id` and any JSON `value`.
     */
    private static function checkMetadata(mixed $metadata): void
    {
        if ($metadata === null) {
            return;
        }
        if (!is_array($metadata) || !array_is_list($metadata)) {
            self::invalid('validation/invalid-type', 'metadata');
        }
        foreach ($metadata as $index => $item) {
            if (!is_array($item) || ($item !== [] && array_is_list($item))) {
                self::invalid('validation/invalid-type', "metadata.$index");
            }
            if (!is_string($item['id'] ?? null)) {
                self::invalid('validation/invalid-type', "metadata.$index.id");
            }
            if (!array_key_exists('value', $item)) {
                self::invalid('validation/invalid-value', "metadata.$index.value");
            }
        }
    }

    private function requestId(): string { return 'mock-request-' . ++$this->requestCount; }

    private function json(int $status, mixed $data, array $headers = [], ?string $requestId = null): Response
    {
        return new Response($status, ['Content-Type' => 'application/json', 'X-Request-Id' => $requestId ?? $this->requestId()] + $headers,
            json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /** The API's error body: `{ code, message, requestId, details }`, `requestId` as in the `X-Request-Id` header. */
    private function error(string $code, string $message, ?int $status = null, array $details = [], array $headers = [], ?string $requestId = null): Response
    {
        $requestId ??= $this->requestId();
        $headers = array_filter($headers, fn ($name) => strcasecmp((string) $name, 'X-Request-Id') !== 0, ARRAY_FILTER_USE_KEY);
        return $this->json($status ?? ErrorCodes::STATUSES[$code] ?? 400,
            ['code' => $code, 'message' => $message, 'requestId' => $requestId, 'details' => (object) $details], $headers, $requestId);
    }

    private function api(RequestInterface $request, array $parts, array $query, array $json, string $body): ?array
    {
        $method = $request->getMethod();
        $upload = $request->getHeaderLine('X-CalmLens-Upload');
        if (($parts[0] ?? null) === 'projects') {
            if (($parts[1] ?? null) !== $this->projectId) {
                self::fail(ErrorCodes::API_KEY_PROJECT_MISMATCH);
            }
            if (self::isTimelineRoute($method, $parts)) {
                return $this->timeline($parts[3], $query);
            }
            $route = $method . ' ' . implode('/', array_slice($parts, 2));
            return match (true) {
                $route === 'GET events' => $this->listEvents($query),
                $route === 'PUT lenses' => $this->saveLenses($json['lenses'] ?? []),
                $route === 'GET lenses' => $this->page($this->lenses, $query, Values::json(['lenses', $this->projectId])),
                $route === 'POST lenses' => $this->createLens($json),
                $route === 'GET folders' => $this->listFolders($query),
                $route === 'POST folders' => $this->createFolder($json),
                $route === 'GET hash-lists' => $this->page($this->hashLists, $query, $this->projectId . '/hash-lists'),
                $route === 'POST hash-lists' => $this->createHashList($json),
                $route === 'GET policy' => $this->toPolicy($this->policy($this->ensurePolicies())),
                $route === 'PUT policy' => $this->assignPolicy($json),
                $route === 'GET assets' => $this->listAssets($query),
                $route === 'GET assets/search' => $this->search($query),
                $route === 'POST assets/batch' => $this->batch($json),
                $route === 'POST signed-asset-urls' => $this->signAssetUrl($json),
                $route === 'POST assets' && $upload === '' => $this->createAsset($json, !self::waits($query), null, false),
                $route === 'POST assets' && in_array($upload, ['content', 'part'], true) => $this->createAsset($query, !self::waits($query), $body, $upload === 'part'),
                default => throw new \LogicException("MockServerClient does not emulate $route; enqueue a response for it"),
            };
        }
        if (($parts[0] ?? null) === 'policies' && count($parts) <= 3) {
            if (!isset($parts[1])) {
                return match ($method) {
                    'GET' => $this->listPolicies($query),
                    'POST' => $this->createPolicy($json),
                    default => throw new \LogicException("MockServerClient does not emulate $method /policies; enqueue a response for it"),
                };
            }
            return $this->policyRoute($method, $parts[1], $parts[2] ?? '', $json);
        }
        if (($parts[0] ?? null) === 'lenses' && isset($parts[1]) && !isset($parts[2])) {
            return $this->lensRoute($method, $parts[1], $json);
        }
        if (($parts[0] ?? null) === 'folders' && isset($parts[1])) {
            return $this->folderRoute($method, $parts[1], $parts[2] ?? '', $json);
        }
        if (($parts[0] ?? null) === 'hash-lists' && isset($parts[1])) {
            return $this->hashListRoute($method, $parts[1], $parts[2] ?? '', $query, $json);
        }
        if (($parts[0] ?? null) === 'hash-list-entries' && isset($parts[1]) && !isset($parts[2]) && $method === 'DELETE') {
            if (!isset($this->hashListEntries[$parts[1]])) {
                self::fail(ErrorCodes::HASH_LIST_ENTRY_NOT_FOUND, null, 'Hash list entry not found.');
            }
            unset($this->hashListEntries[$parts[1]]);
            return null;
        }
        if (($parts[0] ?? null) !== 'assets' || !isset($parts[1])) {
            throw new \LogicException("MockServerClient does not emulate $method /" . implode('/', $parts) . '; enqueue a response for it');
        }
        $id = $parts[1];
        $route = $method . ' ' . ($parts[2] ?? '');
        // Like the API, the body is checked against its schema before the asset is looked up.
        if ($route === 'PATCH ') {
            self::checkMetadata($json['metadata'] ?? null);
            if (array_key_exists('name', $json) && $json['name'] === null) {
                self::invalid('validation/invalid-type', 'name');
            }
        }
        $asset = $this->assets[$id] ?? self::fail(ErrorCodes::ASSET_NOT_FOUND, null, 'Asset not found');
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
                unset($this->assets[$id], $this->content[$id], $this->uploads[$id], $this->processingOptions[$id]);
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
                return $this->moderateStored($asset, MockModerationInput::RETRY);
            case 'POST decision':
                return $this->reviewerDecision($asset, $json);
            case 'POST explain':
                if ($asset['classification']['status'] !== 'completed') {
                    self::fail(ErrorCodes::ASSET_NOT_DECIDED);
                }
                if (empty($json['rerun'])) {
                    // Like the API: the evidence is completed and every action stays as decided.
                    if (($asset['classification']['moderation']['explanationComplete'] ?? null) !== false) {
                        return $asset;
                    }
                    $asset['classification']['moderation']['explanationComplete'] = true;
                    return $this->assets[$id] = $this->touch($asset);
                }
                if (($asset['classification']['moderation']['manualReviews'] ?? []) !== []) {
                    self::fail(ErrorCodes::ASSET_REVIEWED);
                }
                if ($asset['content']['status'] === 'removed') {
                    self::fail(ErrorCodes::ASSET_CONTENT_UNAVAILABLE);
                }
                // Like the API: back to processing, to be moderated again under the current policy.
                return $this->moderateStored($this->applyOutcome($asset, 'pending'), MockModerationInput::RERUN);
            case 'POST move':
                $folderId = $json['folderId'] ?? null;
                if ($folderId !== null) {
                    $this->folder($folderId);
                }
                return $this->assets[$id] = $this->touch(['folderId' => $folderId] + $asset);
            case 'POST part':
                return $this->uploadPart($asset, $query, $body);
        }
        throw new \LogicException("MockServerClient does not emulate $route for an asset; enqueue a response for it");
    }

    private static function flag(mixed $value): bool { return $value === 'true' || $value === true; }

    /** Whether an upload waits for its decision: unless it sends `wait=false`, like the API. */
    private static function waits(array $query): bool { return ($query['wait'] ?? null) !== 'false'; }

    /** `GET /projects/:projectId/assets/:assetId/timeline`. */
    private static function isTimelineRoute(string $method, array $parts): bool
    {
        return $method === 'GET' && count($parts) === 5 && $parts[2] === 'assets' && $parts[4] === 'timeline';
    }

    /** A MIME type lower-cased without its parameters. */
    private static function baseMimeType(?string $type): string
    {
        return trim(explode(';', strtolower($type ?? ''), 2)[0]);
    }

    /**
     * The rendered file and preview the API reports for an asset with its content held. Once
     * uploaded, an image renders as itself with a preview that has no ThumbHash yet, and a PDF and
     * browser-safe audio and video render as uploaded. Once processed, a website renders as its
     * screenshot; a document or presentation as a PDF, with its first page as the preview; video
     * and audio as a browser-safe file (MP4 or M4A unless browsers play the upload), audio with a
     * waveform preview and video with no poster; and every preview has its ThumbHash. Text,
     * spreadsheets and other files have neither. The mock decodes nothing, so sizes are unknown,
     * audio has no peaks, and audio and video never get an adaptive stream.
     *
     * @return array{rendered: ?array, preview: ?array}
     */
    private static function rendering(array $asset, bool $processed): array
    {
        $format = $asset['content']['format'] ?? null;
        $mime = self::baseMimeType($format);
        $browserSafe = in_array($mime, self::BROWSER_SAFE_MEDIA_FORMATS, true);
        $unsized = ['width' => null, 'height' => null];
        $preview = fn (array $size) => $size + ['thumbhash' => $processed ? self::THUMBHASH : null, 'averageColor' => $processed ? '#7f7f7f' : null];
        $type = $asset['type'];
        $rendersOnUpload = $type === 'image' || $mime === 'application/pdf' || (in_array($type, ['video', 'audio'], true) && $browserSafe);
        if (!$processed && !$rendersOnUpload) {
            return self::NO_RENDERING;
        }
        // The mock prepares no adaptive stream.
        return ['hls' => null] + match ($type) {
            'image' => ['rendered' => ['kind' => 'image', 'format' => $format ?? 'image/png'] + $unsized, 'preview' => $preview($unsized)],
            'website' => ['rendered' => ['kind' => 'image', 'format' => 'image/png'] + $unsized, 'preview' => $preview($unsized)],
            'multimedia-document' => in_array($mime, self::SPREADSHEET_MIME_TYPES, true) ? self::NO_RENDERING
                : ['rendered' => ['kind' => 'pdf', 'format' => 'application/pdf'] + $unsized, 'preview' => $processed ? $preview($unsized) : null],
            'video' => ['rendered' => ['kind' => 'video', 'format' => $browserSafe ? $format : 'video/mp4'] + $unsized, 'preview' => null],
            'audio' => ['rendered' => ['kind' => 'audio', 'format' => $browserSafe ? $format : 'audio/mp4'] + $unsized + ($processed ? ['peaks' => []] : []),
                'preview' => $processed ? $preview(self::WAVEFORM_SIZE) : null],
            default => self::NO_RENDERING,
        };
    }

    /** Like the API: image uploads in parts total at most 20 MiB, at any size below that. */
    private static function imageSizeError(string $type, int $size, bool $final): ?string
    {
        return match (true) {
            $type !== 'image' => null,
            $size > Assets::MAX_MULTIPART_IMAGE_BYTES => ErrorCodes::UPLOAD_TOO_LARGE,
            default => null,
        };
    }

    /** Like the API: the parts may not overshoot a declared total, and must reach it at the end. */
    private static function totalSizeError(?int $total, int $received, bool $final): ?string
    {
        return $total !== null && ($received > $total || ($final && $received !== $total)) ? ErrorCodes::UPLOAD_SIZE_MISMATCH : null;
    }

    /** Fails with `$code`; `upload/too-large` carries the plan's limit for images in parts. */
    private static function failIf(?string $code): void
    {
        if ($code === ErrorCodes::UPLOAD_TOO_LARGE) {
            self::fail($code, null, 'Multipart image uploads cannot exceed 20 MiB', ['limitBytes' => Assets::MAX_MULTIPART_IMAGE_BYTES, 'source' => 'plan']);
        }
        if ($code !== null) {
            self::fail($code);
        }
    }

    private function createAsset(array $options, bool $queue, ?string $bytes, bool $multipart): array
    {
        $mime = (string) ($options['contentType'] ?? '');
        $decode = fn (string $key) => is_string($options[$key] ?? null) && $bytes !== null ? json_decode($options[$key], true) : ($options[$key] ?? null);
        self::checkMetadata($decode('metadata'));
        // Like the API: content and a first part must be of a type CalmLens moderates; a URL is exempt.
        if ($bytes !== null && !Values::acceptedUploadMimeType($mime)) {
            self::fail(ErrorCodes::UNSUPPORTED_UPLOAD_TYPE, null, Values::refusedUploadMimeTypeMessage($mime), ['mimeType' => $mime, 'source' => 'calmlens']);
        }
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
        $processing = $decode('processingOptions') ?? ['keepContentAfterProcessing' => false];
        $keep = is_array($processing) && ($processing['keepContentAfterProcessing'] ?? false) === true;
        // Like the API, only the posts CalmLens uses are kept, and only while the content is held.
        $context = ModerationContext::select($decode('context')['items'] ?? []);
        // Fields the API returns as null when they are not set.
        $asset = [
            'id' => ($this->createId)('asset'), 'projectId' => $this->projectId, 'parentId' => null,
            'folderId' => $options['folderId'] ?? null, 'uploadPresetId' => $options['uploadPresetId'] ?? null,
            'createdAt' => $now, 'updatedAt' => $now, 'name' => $options['name'] ?? null,
            'description' => $options['description'] ?? null, 'externalId' => $options['externalId'] ?? null,
            'externalUrl' => $url ?? ($multipart ? null : ($options['externalUrl'] ?? null)),
            'type' => $type, 'metadata' => $decode('metadata') ?? [],
            'authorId' => $options['authorId'] ?? null, 'context' => $context === [] ? null : ['items' => $context], 'tags' => $decode('tags') ?? [],
            'visibility' => $options['visibility'] ?? 'private',
            'content' => ['status' => $keep ? 'stored' : 'temporary', 'removalReason' => null, 'updatedAt' => $now,
                'safetyHold' => null, 'format' => $mime === '' ? null : $mime, 'extension' => null, 'sizeInBytes' => $size,
                // The mock decodes nothing, so the file's own details are unknown.
                'checksums' => null, 'width' => null, 'height' => null, 'durationSeconds' => null, 'pageCount' => null,
                'perceptualHash' => null, 'perceptualHashQuality' => null, 'metadata' => null, 'extractedText' => null,
                // Like the API, the rendered file and preview come with processing.
                ...self::NO_RENDERING],
            'upload' => ['status' => $final ? 'completed' : 'uploading', 'updatedAt' => $now, 'partsReceived' => $final ? null : 1],
            'classification' => ['status' => $final ? 'processing' : 'queued', 'failureReason' => null, 'updatedAt' => $now, 'completedAt' => null,
                // The mock analyses nothing in sections, and never reads test inputs.
                'progress' => null, 'testInput' => false,
                'moderation' => ['status' => 'pending', 'manualReviews' => [], 'automatedStatus' => null, 'source' => null, 'rule' => null,
                    'explanationComplete' => null, 'categories' => null, 'flaggedCategories' => [], 'regions' => [], 'raw' => null,
                    'linkSafety' => null, 'timeline' => null],
                // Like the API, a feature's result is null until it has run.
                'ocr' => null, 'linkDetection' => null],
        ];
        if ($bytes !== null && $final) {
            $asset['content'] = array_replace($asset['content'], self::rendering($asset, false));
        }
        $this->assets[$asset['id']] = $asset;
        $this->processingOptions[$asset['id']] = $processing;
        if ($bytes !== null) {
            $this->content[$asset['id']] = ['type' => $mime, 'bytes' => $bytes];
        }
        if (!$final) {
            $this->uploads[$asset['id']] = ['queue' => $queue, 'total' => $total];
            return $asset;
        }
        return $this->finish($asset, $queue);
    }

    /**
     * Moderates an asset whose upload just completed, as the pipeline would: `asset.uploaded` with
     * the asset as it was, then the decision's events.
     */
    private function finish(array $asset, bool $queue): array
    {
        $decision = $this->decisionFor($asset, MockModerationInput::UPLOAD, $queue);
        $stored = $decision->status === 'pending' ? $asset : $this->decided($asset, $decision);
        $this->recordUploaded($asset);
        $this->recordProcessingEvents($stored, $decision);
        return $stored;
    }

    /** Asks `moderate` how to decide a processing asset, with its stored content (none once removed). */
    private function decisionFor(array $asset, string $trigger, bool $queued): MockDecision
    {
        $bytes = $asset['content']['status'] === 'removed' ? null : ($this->content[$asset['id']]['bytes'] ?? null);
        $text = $bytes !== null && $asset['type'] === 'plaintext-document' ? mb_scrub($bytes, 'UTF-8') : null;
        return MockDecision::from(($this->moderate)(new MockModerationInput($asset, new MockModerationContent($bytes, $text), $trigger, $queued)));
    }

    /**
     * Stores `$asset` decided as `$decision` says, with its report. Like the API for an image with
     * no text, QR codes, links, people or faces in it, a decided image reports the features its
     * upload turned on as finding nothing: OCR and person and face detection when requested, link
     * detection unless turned off.
     */
    private function decided(array $asset, MockDecision $decision): array
    {
        $next = $this->applyOutcome($asset, $decision->status, 'policy', $decision->report());
        if ($next['classification']['status'] !== 'completed' || $asset['type'] !== 'image') {
            return $next;
        }
        $features = $this->processingOptions[$asset['id']]['features'] ?? null;
        if (($features['ocr']['enabled'] ?? null) === true) {
            $next['classification']['ocr'] = ['status' => 'evaluated', 'textRegions' => []];
        }
        if (($features['linkDetection']['enabled'] ?? null) !== false) {
            $next['classification']['linkDetection'] = ['status' => 'evaluated', 'qrCodes' => [], 'links' => []];
        }
        if (($features['personDetection']['enabled'] ?? null) === true) {
            $next['classification']['personDetection'] = ['status' => 'evaluated', 'people' => []];
        }
        if (($features['faceDetection']['enabled'] ?? null) === true) {
            $next['classification']['faceDetection'] = ['status' => 'evaluated', 'faces' => []];
        }
        return $this->assets[$next['id']] = $next;
    }

    /** Asks `moderate` (unless `$decision` is given) and settles a processing asset; `pending` leaves it processing. */
    private function moderateStored(array $asset, string $trigger, ?MockDecision $decision = null): array
    {
        $decision ??= $this->decisionFor($asset, $trigger, true);
        if ($decision->status === 'pending') {
            return $asset;
        }
        $stored = $this->decided($asset, $decision);
        $this->recordProcessingEvents($stored, $decision);
        return $stored;
    }

    /** `asset.uploaded`, as the API records it when an upload completes. */
    private function recordUploaded(array $asset): void
    {
        $this->enqueueEvent(['type' => 'asset.uploaded', 'severity' => 'low', 'assetId' => $asset['id'], 'asset' => $this->snapshot($asset),
            'facts' => [['key' => 'asset-type', 'value' => $asset['type']], self::nameFact($asset),
                ['key' => 'file-format', 'value' => $asset['content']['format'] ?? null]]]);
    }

    /**
     * The events the pipeline records when it settles an asset: `asset.classified` and the
     * automated `asset.<status>`, or `asset.failed`.
     */
    private function recordProcessingEvents(array $asset, MockDecision $decision): void
    {
        $status = $decision->status;
        if ($status === 'pending') {
            return;
        }
        $event = ['assetId' => $asset['id'], 'asset' => $this->snapshot($asset), 'actor' => self::AUTOMATED_ACTOR];
        if ($status === 'failed') {
            $this->enqueueEvent($event + ['type' => 'asset.failed', 'severity' => 'high', 'facts' => [self::nameFact($asset),
                ['key' => 'asset-type', 'value' => $asset['type']], ['key' => 'previous-status', 'value' => 'processing'],
                ['key' => 'failure-reason', 'value' => $asset['classification']['failureReason'] ?? 'processing-error']]]);
            return;
        }
        $flagged = $decision->report()['flaggedCategories'];
        $this->enqueueEvent($event + ['type' => 'asset.classified', 'severity' => 'low', 'facts' => [
            ['key' => 'flagged-categories', 'value' => $flagged], ['key' => 'moderation-status', 'value' => $status],
            ['key' => 'asset-type', 'value' => $asset['type']], self::nameFact($asset)]]);
        $this->enqueueEvent($event + ['type' => 'asset.' . $status, 'severity' => in_array($status, ['allowed', 'limited'], true) ? 'low' : 'high',
            'facts' => [['key' => 'flagged-categories', 'value' => $flagged],
                ['key' => 'asset-type', 'value' => $asset['type']], self::nameFact($asset)]]);
    }

    /** An asset's name with its portal link, as event facts carry it. */
    private static function nameFact(array $asset): array
    {
        return ['key' => 'asset-name', 'value' => $asset['name'], 'url' => 'https://calmlens.com/go/asset/' . $asset['id']];
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
        // Like the API, an upload has at most 10,000 parts.
        if ($number !== $expected || $number > self::MAX_UPLOAD_PARTS) {
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
        // `wait=false` queues the final part; without `wait`, the choice saved when the upload started applies.
        $queue = array_key_exists('wait', $query) ? !self::waits($query) : $upload['queue'];
        unset($this->uploads[$id]);
        return $this->finish($this->applyOutcome($asset, 'pending'), $queue);
    }

    /**
     * Moves an asset to an outcome like the pipeline would, and stores it: a decision finishes
     * processing (with its `$report`, when moderation made it), `purged` removes the content (with
     * `$purgeReason`), and finished processing removes content kept only temporarily. Like the API,
     * an asset whose content is held has its rendered file and preview, completed by its decision
     * (with a ThumbHash for its placeholder); removing the content removes them with it, and a
     * safety hold withholds them.
     */
    private function applyOutcome(array $asset, string $outcome, string $purgeReason = 'policy', ?array $report = null): array
    {
        $now = ($this->now)();
        $decided = !in_array($outcome, ['pending', 'failed'], true);
        $status = $decided ? 'completed' : ($outcome === 'failed' ? 'failed' : 'processing');
        $purge = $outcome === 'purged' && $asset['content']['status'] !== 'removed';
        $remove = $purge || ($status === 'completed' && $asset['content']['status'] === 'temporary');
        $held = $asset['content']['status'] !== 'removed' && !$purge && ($asset['content']['safetyHold'] ?? null) === null;
        $asset['content'] = array_replace($asset['content'], $held ? self::rendering($asset, $decided) : self::NO_RENDERING);
        if ($remove) {
            $asset = $this->removeContent($asset, $purge ? $purgeReason : 'retention');
        }
        $asset['upload'] = ['status' => 'completed', 'updatedAt' => $now] + $asset['upload'];
        // Like the API, a failure carries its reason; the mock never decodes content, so it fails processing.
        $asset['classification'] = ['status' => $status, 'failureReason' => $status === 'failed' ? 'processing-error' : null,
            'updatedAt' => $now, 'completedAt' => $decided ? $now : null] + $asset['classification'];
        $asset['classification']['moderation'] = array_replace($asset['classification']['moderation'],
            ['status' => $decided ? $outcome : 'pending'], $report ?? []);
        $asset['updatedAt'] = $now;
        return $this->assets[$asset['id']] = $asset;
    }

    /**
     * DELETE /assets/:id/content, like the API: the record and report stay; stored content,
     * extracted text, metadata, the rendered file and the preview go. Content already removed keeps its reason, and an
     * `asset.content-removed` event is recorded either way.
     */
    /**
     * POST /assets/:id/decision, like the API: the body is validated, an asset still uploading or
     * processing is refused, a pending asset can only be blocked or purged, the same status is refused and purged
     * content can only be blocked. The status changes and a manual review is added; purging removes
     * the content (after an `asset.content-removed` event), and an `asset.<status>` event records
     * the reviewer's decision with its note.
     */
    private function reviewerDecision(array $asset, array $json): array
    {
        $decision = $json['decision'] ?? null;
        if (!is_string($decision) || !in_array($decision, self::DECISIONS, true)) {
            self::invalid('validation/invalid-value', 'decision');
        }
        if (!is_string($json['note'] ?? null)) {
            self::invalid('validation/invalid-type', 'note');
        }
        $note = trim($json['note']);
        if ($note === '') {
            self::invalid('validation/too-small', 'note');
        }
        if (mb_strlen($note) > 1499) {
            self::invalid('validation/too-big', 'note');
        }
        if ($decision === 'purged' && ($json['confirmPurge'] ?? null) !== true) {
            self::invalid('validation/invalid-value', 'confirmPurge');
        }
        if ($asset['upload']['status'] === 'uploading' || $asset['classification']['status'] === 'processing') {
            self::fail(ErrorCodes::ASSET_PROCESSING);
        }
        $status = $asset['classification']['moderation']['status'];
        $restrictive = in_array($decision, ['blocked', 'purged'], true);
        if (!$restrictive && $status === 'pending') {
            self::fail(ErrorCodes::ASSET_DECISION_NOT_ALLOWED);
        }
        if ($decision === $status) {
            self::fail(ErrorCodes::ASSET_DECISION_UNCHANGED);
        }
        if (!$restrictive && $status === 'purged') {
            self::fail(ErrorCodes::ASSET_CONTENT_PURGED);
        }
        $asset['classification']['moderation']['status'] = $decision;
        $asset['classification']['moderation']['manualReviews'][] = self::review(($this->createId)('rev'), $decision, $note, ($this->now)());
        $asset = $this->assets[$asset['id']] = $this->touch($asset);
        if ($decision === 'purged') {
            $asset = $this->requestedRemoval($asset);
        }
        $this->enqueueEvent(['type' => 'asset.' . $decision, 'severity' => in_array($decision, ['allowed', 'limited'], true) ? 'low' : 'high',
            'title' => 'asset.' . $decision, 'assetId' => $asset['id'], 'asset' => $this->snapshot($asset),
            'facts' => [['key' => 'asset-type', 'value' => $asset['type']],
                ['key' => 'asset-name', 'value' => $asset['name'], 'url' => 'https://calmlens.com/go/asset/' . $asset['id']], ['key' => 'note', 'value' => $note]]]);
        return $asset;
    }

    private function requestedRemoval(array $asset, ?string $batchId = null): array
    {
        unset($this->content[$asset['id']]);
        if ($asset['content']['status'] !== 'removed') {
            $asset = $this->touch($this->removeContent($asset, 'requested'));
        } else {
            $asset['content'] = array_replace($asset['content'], self::NO_RENDERING);
        }
        $this->assets[$asset['id']] = $asset;
        $this->lifecycleEvent('asset.content-removed', $asset, $batchId);
        return $asset;
    }

    /**
     * POST /projects/:id/assets/batch. Checks every asset like the API (an ID that is not an
     * asset ID is `validation/invalid-format`, an unknown one `asset/not-found`, and either refuses the whole
     * batch), then answers 202 and applies the operation at once, in request order, instead of in
     * the background: `delete` deletes each asset with its stored child assets and records
     * `asset.deleted` with the asset as it was; `remove-content` removes the content like
     * DELETE /assets/:id/content. It answers with a `batch_` ID, which each event it causes names
     * in a `batch-id` fact. Mock assets carry no safety holds, so none is skipped.
     */
    /**
     * Signs an asset URL like the API (`POST /projects/:projectId/signed-asset-urls`): a grant to
     * one asset, by ID or external ID, until it expires, serving the original only when asked. The
     * mock's grant is readable (`encodeGrant`), and only the mock's CDN accepts it.
     */
    private function signAssetUrl(array $json): array
    {
        // Like the API's schema, none of these fields takes null.
        foreach (['assetId', 'externalId', 'expiresIn', 'original'] as $field) {
            if (array_key_exists($field, $json) && $json[$field] === null) {
                self::invalid('validation/invalid-type', $field);
            }
        }
        if (array_key_exists('assetId', $json) === array_key_exists('externalId', $json)) {
            self::fail(ErrorCodes::INVALID_REQUEST, 400, 'Send either assetId or externalId',
                ['issues' => [['path' => '', 'message' => 'Send either assetId or externalId', 'code' => 'custom']]]);
        }
        $expiresIn = $json['expiresIn'] ?? Cdn::DEFAULT_SIGNED_URL_EXPIRES_IN;
        if (!is_int($expiresIn) && !(is_float($expiresIn) && is_finite($expiresIn) && floor($expiresIn) === $expiresIn)) {
            self::invalid('validation/invalid-type', 'expiresIn');
        }
        if ($expiresIn < 1) {
            self::invalid('validation/too-small', 'expiresIn');
        }
        if ($expiresIn > Cdn::MAX_SIGNED_URL_EXPIRES_IN) {
            self::invalid('validation/too-big', 'expiresIn');
        }
        $original = $json['original'] ?? false;
        if (!is_bool($original)) {
            self::invalid('validation/invalid-type', 'original');
        }
        $asset = null;
        if (array_key_exists('externalId', $json)) {
            foreach ($this->assets as $candidate) {
                if (($candidate['externalId'] ?? null) === $json['externalId']) {
                    $asset = $candidate;
                    break;
                }
            }
        } elseif (is_string($json['assetId'])) {
            $asset = $this->assets[$json['assetId']] ?? null;
        }
        if ($asset === null) {
            self::fail(ErrorCodes::ASSET_NOT_FOUND, null, 'Asset not found');
        }
        if (($asset['content']['safetyHold'] ?? null) !== null) {
            self::fail(ErrorCodes::ASSET_HELD, null, 'This asset is held', ['hold' => 'safety']);
        }
        $expiresAt = ($this->now)() + (int) $expiresIn * 1000;
        return ['url' => $this->cdnBaseUrl . '/assets/' . Values::component($this->projectId) . '/'
            . self::encodeGrant($asset['id'], $original, $expiresAt), 'expiresAt' => $expiresAt];
    }

    /**
     * The mock's grant, the asset segment of a URL `signAssetUrl` signs: `sig_` and the lowercase
     * hex of the UTF-8 string `{assetId}.{1|0}.{expiresAt}`, its asset, original access and expiry.
     * Every SDK's mock writes it the same way. It is readable, not signed, as the mock has no
     * secret to keep.
     */
    private static function encodeGrant(string $assetId, bool $original, int $expiresAt): string
    {
        return 'sig_' . bin2hex($assetId . '.' . ($original ? '1' : '0') . '.' . $expiresAt);
    }

    /** @return ?array{assetId: string, original: bool, expiresAt: int} a grant, or null for a segment the mock didn't sign */
    private static function decodeGrant(string $segment): ?array
    {
        $hex = substr($segment, strlen('sig_'));
        if (!preg_match('/^(?:[0-9a-f]{2})+$/D', $hex)) {
            return null;
        }
        $text = (string) hex2bin($hex);
        if (preg_match('//u', $text) !== 1 || !preg_match('/^(.+)\.([01])\.(\d+)$/sD', $text, $match)) {
            return null;
        }
        return ['assetId' => $match[1], 'original' => $match[2] === '1', 'expiresAt' => (int) $match[3]];
    }

    /**
     * Fetches a URL of the mock's CDN as a browser would, with a GET and without the API key: a
     * signed asset URL from `cdn->signAssetUrl` (with a resource appended), or a public one from
     * `cdn->getAssetUrl`. The request is recorded like any other, and an HTTP error is returned,
     * not thrown.
     */
    public function fetchCdn(string $url): ResponseInterface
    {
        try {
            return $this->browser->send(new \GuzzleHttp\Psr7\Request('GET', $url), ['http_errors' => false, 'allow_redirects' => false]);
        } catch (\GuzzleHttp\Exception\TransferException $error) {
            throw CalmLensException::create(SdkErrorCodes::TRANSPORT_ERROR, 'Request failed', previous: $error);
        }
    }

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
            if (!is_string($id) || !preg_match(self::ASSET_ID_PATTERN, $id)) {
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
        $batchId = ($this->createId)('batch');
        foreach ($assets as $asset) {
            if ($operation === Assets::BATCH_DELETE) {
                $this->deleteTree($asset['id']);
                $this->lifecycleEvent('asset.deleted', $asset, $batchId);
            } else {
                $this->requestedRemoval($this->assets[$asset['id']] ?? $asset, $batchId);
            }
        }
        $this->status = 202;
        return ['batchId' => $batchId, 'status' => 'queued', 'assetCount' => count($assets)];
    }

    /** Deletes an asset, its stored child assets and their content. */
    private function deleteTree(string $id): void
    {
        foreach ($this->assets as $childId => $child) {
            if (($child['parentId'] ?? null) === $id) {
                $this->deleteTree((string) $childId);
            }
        }
        unset($this->assets[$id], $this->content[$id], $this->uploads[$id], $this->processingOptions[$id]);
    }

    private function removeContent(array $asset, string $reason): array
    {
        unset($this->content[$asset['id']]);
        $asset['context'] = null;
        $asset['content'] = ['status' => 'removed', 'removalReason' => $reason, 'updatedAt' => ($this->now)(), 'extractedText' => null,
            'metadata' => null, ...self::NO_RENDERING] + $asset['content'];
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
        return $this->page($this->assets, $query, Values::json([$this->projectId, $query['filter'] ?? null]));
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
     * GET /projects/:projectId/assets/:assetId/timeline, like the API: refused while a safety hold
     * is on. The mock analyses no audio or video, so it keeps no segments: every timeline is empty,
     * and no cursor continues one.
     */
    private function timeline(string $assetId, array $query): array
    {
        $asset = $this->assets[$assetId] ?? self::fail(ErrorCodes::ASSET_NOT_FOUND, null, 'Asset not found');
        self::size($query, 'pageSize', self::DEFAULT_PAGE_SIZE, self::MAX_PAGE_SIZE);
        if (($asset['content']['safetyHold'] ?? null) !== null) {
            self::fail(ErrorCodes::ASSET_HELD, null, 'This asset is held', ['hold' => 'safety']);
        }
        if (array_key_exists('cursor', $query)) {
            self::fail(ErrorCodes::INVALID_CURSOR, null, 'The cursor is invalid or belongs to a different query.');
        }
        return ['items' => [], 'nextCursor' => null, 'hasMore' => false];
    }

    /**
     * A `sort` query value as the API reads it: comma-separated fields from `$fields`, each
     * descending when prefixed with `-`, none repeated and at most `$max`; anything else is
     * `validation/invalid-value` at `sort`. Null when the query sends none.
     *
     * @return ?list<array{field: string, direction: string}>
     */
    private static function sort(array $query, array $fields, int $max): ?array
    {
        if (!array_key_exists('sort', $query)) {
            return null;
        }
        $value = $query['sort'];
        $sort = [];
        foreach (is_string($value) ? explode(',', $value) : [null] as $part) {
            $part = trim((string) $part);
            $field = ltrim($part, '-');
            if (!preg_match('/^-?[A-Za-z][A-Za-z0-9.]*$/D', $part) || !in_array($field, $fields, true)
                || in_array($field, array_column($sort, 'field'), true)) {
                self::invalid(ErrorCodes::INVALID_VALUE, 'sort');
            }
            $sort[] = ['field' => $field, 'direction' => str_starts_with($part, '-') ? 'desc' : 'asc'];
        }
        if (count($sort) > $max) {
            self::invalid(ErrorCodes::INVALID_VALUE, 'sort');
        }
        return $sort;
    }

    /**
     * One keyset page like the API's: the query's `sort` is checked first, like its schema
     * (`createdAt` or `id`, at most two), then the filter, then the cursor. Ordered by `sort`
     * (`$defaultSort` without one) with an `id` tie-breaker, resuming after the cursor's values. A
     * cursor only continues the query (`$scope` and sort) it came from.
     */
    private function page(array $items, array $query, string $scope, array $defaultSort = [['field' => 'createdAt', 'direction' => 'desc']]): array
    {
        $size = self::size($query, 'pageSize', self::DEFAULT_PAGE_SIZE, self::MAX_PAGE_SIZE);
        $sort = self::sort($query, ['createdAt', 'id'], 2) ?: $defaultSort;
        $items = array_values($items);
        if (($query['filter'] ?? '') !== '') {
            $items = array_values(array_filter($items, self::filter((string) $query['filter'])));
        }
        if (!in_array('id', array_column($sort, 'field'), true)) {
            $sort[] = ['field' => 'id', 'direction' => $sort[0]['direction']];
        }
        $compare = fn ($a, $b): int => is_string($a) || is_string($b) ? strcmp((string) $a, (string) $b) : $a <=> $b;
        usort($items, function (array $a, array $b) use ($sort, $compare): int {
            foreach ($sort as $order) {
                $result = $compare($a[$order['field']] ?? null, $b[$order['field']] ?? null);
                if ($result !== 0) {
                    return $order['direction'] === 'desc' ? -$result : $result;
                }
            }
            return 0;
        });
        $signature = Values::json([$scope, $sort]);
        if (isset($query['cursor'])) {
            $decoded = base64_decode((string) $query['cursor'], true);
            $cursor = $decoded === false ? null : json_decode($decoded, true);
            $after = $cursor['values'] ?? null;
            if (!is_array($cursor) || ($cursor['scope'] ?? null) !== $signature || !is_array($after) || !array_is_list($after) || count($after) !== count($sort)) {
                self::fail(ErrorCodes::INVALID_CURSOR, null, 'The cursor is invalid or belongs to a different query.');
            }
            // Keyset: resume strictly after the last returned item's values.
            $items = array_values(array_filter($items, function (array $item) use ($sort, $after, $compare): bool {
                foreach ($sort as $i => $order) {
                    $result = $compare($item[$order['field']] ?? null, $after[$i]);
                    if ($result !== 0) {
                        return ($order['direction'] === 'desc' ? -$result : $result) > 0;
                    }
                }
                return false;
            }));
        }
        $more = count($items) > $size;
        $taken = array_slice($items, 0, $size);
        $last = $taken === [] ? null : $taken[array_key_last($taken)];
        $cursor = $more && $last !== null
            ? base64_encode(Values::json(['scope' => $signature, 'values' => array_map(fn (array $order) => $last[$order['field']] ?? null, $sort)])) : null;
        return ['items' => $taken, 'hasMore' => $more, 'nextCursor' => $cursor];
    }

    /**
     * An RSQL filter like the API's (zodbase/rsql with @rsql/parser): comparisons on the fields in
     * {@see AssetFilters::FIELDS}, each with its own operators, joined by
     * `;` or `and` (which bind tighter) and `,` or `or`, grouped with parentheses. Anything else
     * fails with `filter/invalid`, like the API.
     */
    private static function filter(string $expression): \Closure
    {
        $tokens = self::filterTokens($expression);
        $position = 0;
        $test = self::alternatives($tokens, $position);
        if ($position !== count($tokens)) {
            self::invalidFilter();
        }
        return $test;
    }

    private static function invalidFilter(): never
    {
        self::fail(ErrorCodes::INVALID_FILTER, 400, 'Invalid filter');
    }

    /**
     * The filter's tokens, as `[type, text]` pairs: `value` (unquoted), `quoted` (unescaped),
     * `(`, `)`, `and`, `or` and `operator`. Like @rsql/parser, whitespace separates tokens and an
     * unquoted run stops at a reserved character.
     *
     * @return list<array{string, string}>
     */
    private static function filterTokens(string $expression): array
    {
        $tokens = [];
        $length = strlen($expression);
        $position = 0;
        while ($position < $length) {
            $char = $expression[$position];
            $rest = substr($expression, $position);
            if (str_contains(" \n\t\r", $char)) {
                $position++;
            } elseif ($char === '"' || $char === "'") {
                if (!preg_match('/^' . $char . '((?:[^' . $char . '\\\\]|\\\\.)*)' . $char . '/s', $rest, $match)) {
                    self::invalidFilter();
                }
                $tokens[] = ['quoted', (string) preg_replace('/\\\\(.)/s', '$1', $match[1])];
                $position += strlen($match[0]);
            } elseif ($char === '(' || $char === ')') {
                $tokens[] = [$char, $char];
                $position++;
            } elseif ($char === ';' || $char === ',') {
                $tokens[] = [$char === ';' ? 'and' : 'or', $char];
                $position++;
            } elseif (preg_match('/^(==|!=|<=|>=|<|>|=[a-z]*=)/', $rest, $match)) {
                $tokens[] = ['operator', $match[1]];
                $position += strlen($match[1]);
            } elseif (str_contains('=!~<>', $char)) {
                self::invalidFilter();
            } elseif (preg_match('/^(and|or) /', $rest, $match)) {
                $tokens[] = [$match[1], $match[1]];
                $position += strlen($match[1]);
            } else {
                preg_match('/^[^"\'();,=!~<> \n\t\r]+/', $rest, $match);
                $tokens[] = ['value', $match[0]];
                $position += strlen($match[0]);
            }
        }
        if ($tokens === []) {
            self::invalidFilter();
        }
        return $tokens;
    }

    /** `or` of `and` terms, read from `$tokens` until a closing `)` or the end. */
    private static function alternatives(array $tokens, int &$position): \Closure
    {
        $alternatives = [[]];
        while (true) {
            $alternatives[array_key_last($alternatives)][] = self::term($tokens, $position);
            $type = $tokens[$position][0] ?? null;
            if ($type === 'and') {
                $position++;
            } elseif ($type === 'or') {
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

    /** A `( … )` group, or a comparison: a field, an operator and a value or `( … )` value list. */
    private static function term(array $tokens, int &$position): \Closure
    {
        if (($tokens[$position][0] ?? null) === '(') {
            $position++;
            $group = self::alternatives($tokens, $position);
            if (($tokens[$position][0] ?? null) !== ')') {
                self::invalidFilter();
            }
            $position++;
            return $group;
        }
        [$type, $name] = $tokens[$position] ?? [null, ''];
        [$opType, $operator] = $tokens[$position + 1] ?? [null, ''];
        if ($type !== 'value' || $opType !== 'operator') {
            self::invalidFilter();
        }
        $position += 2;
        $values = [];
        if (($tokens[$position][0] ?? null) === '(') {
            $position++;
            while (true) {
                [$valueType, $value] = $tokens[$position] ?? [null, ''];
                if ($valueType !== 'value' && $valueType !== 'quoted') {
                    self::invalidFilter();
                }
                $values[] = $value;
                $position++;
                $next = $tokens[$position][0] ?? null;
                $position++;
                if ($next === ')') {
                    break;
                }
                if ($next !== 'or') {
                    self::invalidFilter();
                }
            }
        } else {
            [$valueType, $value] = $tokens[$position] ?? [null, ''];
            if ($valueType !== 'value' && $valueType !== 'quoted') {
                self::invalidFilter();
            }
            $values[] = $value;
            $position++;
        }
        return self::comparison($name, $operator, $values);
    }

    /**
     * One comparison, read like zodbase/rsql: the value is a number for a number field (anything
     * else is refused), `null` is a missing value only on a nullable field, and other values stay
     * text. `*` in an `==` or `!=` text value matches any run of characters regardless of case;
     * every other character matches itself. As in SQL, no comparison matches a missing value.
     *
     * @param list<string> $raw
     */
    private static function comparison(string $name, string $operator, array $raw): \Closure
    {
        $field = AssetFilters::FIELDS[$name] ?? null;
        if ($field === null || !in_array($operator, $field['operators'], true)) {
            self::invalidFilter();
        }
        $values = array_map(function (string $value) use ($field): int|float|string|null {
            if ($value === 'null' && $field['nullable']) {
                return null;
            }
            if ($field['kind'] !== 'number') {
                return $value;
            }
            $number = trim($value);
            if (!is_numeric($number) || !is_finite((float) $number)) {
                self::invalidFilter();
            }
            return $number + 0;
        }, $raw);
        $value = $values[0];
        $pattern = is_string($value) && str_contains($value, '*') && ($operator === '==' || $operator === '!=')
            ? '/^' . implode('.*', array_map(fn (string $part) => preg_quote($part, '/'), explode('*', $value))) . '$/isu'
            : null;
        $list = $field['kind'] === 'list';
        return function (array $asset) use ($name, $operator, $values, $value, $pattern, $list): bool {
            $actual = $asset;
            foreach (explode('.', $name) as $key) {
                $actual = is_array($actual) ? ($actual[$key] ?? null) : null;
            }
            if ($list) {
                // A list holds any of the values (=in=) or none of them (=out=); a missing list holds none.
                $held = array_intersect($values, is_array($actual) ? $actual : []) !== [];
                return $held === ($operator === '=in=');
            }
            if ($actual === null) {
                return $operator === '==' && $value === null && $pattern === null;
            }
            $equals = fn ($item, $expected): bool => $expected !== null && (is_string($expected) ? $item === $expected : (is_int($item) || is_float($item)) && $item == $expected);
            $matches = fn ($item): bool => $pattern !== null
                ? is_string($item) && preg_match($pattern, $item) === 1
                : $equals($item, $value);
            $items = [$actual];
            $any = fn (callable $test): bool => array_filter($items, $test) !== [];
            return match ($operator) {
                '==' => $value !== null && $any($matches),
                '!=' => $value === null || !$any($matches),
                '=in=' => $any(fn ($item) => array_filter($values, fn ($expected) => $equals($item, $expected)) !== []),
                '=out=' => !in_array(null, $values, true)
                    && !$any(fn ($item) => array_filter($values, fn ($expected) => $equals($item, $expected)) !== []),
                default => $value !== null && match ($operator) {
                    '>' => self::compareFilterValues($actual, $value) > 0,
                    '>=' => self::compareFilterValues($actual, $value) >= 0,
                    '<' => self::compareFilterValues($actual, $value) < 0,
                    default => self::compareFilterValues($actual, $value) <= 0,
                },
            };
        };
    }

    /** Numbers compare numerically and text by code point, like the database. */
    private static function compareFilterValues(mixed $actual, int|float|string $value): int
    {
        return is_string($value) ? strcmp((string) $actual, $value) : $actual <=> $value;
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
        // Like the API's query schema: a trimmed query of 1 to 200 characters, 1 to 20 results.
        $text = trim((string) ($query['query'] ?? ''));
        if ($text === '') {
            self::invalid('validation/too-small', 'query');
        }
        if (mb_strlen($text) > 200) {
            self::invalid('validation/too-big', 'query');
        }
        $limit = self::size($query, 'pageSize', 10, 20);
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
        $folder = ['id' => ($this->createId)('fldr'), 'projectId' => $this->projectId, 'parentId' => $parentId, 'name' => $json['name'],
            'createdAt' => $now, 'updatedAt' => $now];
        // Like the API, a new folder is 201 Created.
        $this->status = 201;
        return $this->folders[$folder['id']] = $folder;
    }

    /**
     * One page of a folder level (optionally matching a name search) with its visible ancestors, like the API: keyset
     * pages ordered by `name` (by code point, the default, ascending) or `createdAt`, with the
     * folder ID breaking ties. A cursor only continues the query it came from.
     */
    private function listFolders(array $query): array
    {
        $size = self::size($query, 'pageSize', self::DEFAULT_PAGE_SIZE, self::MAX_PAGE_SIZE);
        $search = strtolower((string) ($query['search'] ?? ''));
        $parentId = $query['parentId'] ?? null;
        // The folder list sorts by one field, `name` or `createdAt`.
        ['field' => $field, 'direction' => $direction] = (self::sort($query, ['name', 'createdAt'], 1) ?: [['field' => 'name', 'direction' => 'asc']])[0];
        $sign = $direction === 'desc' ? -1 : 1;
        // Like the database: names compare by code point, so case matters; IDs break ties.
        $compare = fn ($a, $b, string $aId, string $bId): int => $sign * ((is_string($a) ? strcmp($a, (string) $b) : $a <=> $b) ?: strcmp($aId, $bId));
        $found = array_values(array_filter($this->folders, fn ($folder) => $folder['parentId'] === $parentId
            && ($search === '' || str_contains(strtolower($folder['name']), $search))));
        usort($found, fn ($a, $b) => $compare($a[$field], $b[$field], $a['id'], $b['id']));
        $signature = Values::json([$this->projectId, $parentId, $search, $field, $direction]);
        if (isset($query['cursor']) && $query['cursor'] !== '') {
            $decoded = base64_decode((string) $query['cursor'], true);
            $cursor = $decoded === false ? null : json_decode($decoded, true);
            if (!is_array($cursor) || ($cursor['scope'] ?? null) !== $signature || !is_string($cursor['id'] ?? null) || !array_key_exists('value', $cursor)
                || !($field === 'name' ? is_string($cursor['value']) : is_int($cursor['value']))) {
                self::fail(ErrorCodes::INVALID_CURSOR, null, 'The cursor is invalid or belongs to a different query.');
            }
            $found = array_values(array_filter($found, fn ($folder) => $compare($folder[$field], $cursor['value'], $folder['id'], $cursor['id']) > 0));
        }
        $page = array_slice($found, 0, $size);
        $more = count($found) > $size;
        $ids = array_fill_keys(array_merge($parentId === null ? [] : [$parentId], array_column($page, 'id')), true);
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
        $last = $page === [] ? null : $page[array_key_last($page)];
        $next = $more ? base64_encode(Values::json(['scope' => $signature, 'value' => $last[$field], 'id' => $last['id']])) : null;
        return ['items' => $page, 'ancestors' => $ancestors, 'nextCursor' => $next, 'hasMore' => $more];
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

    private function hashList(string $id): array
    {
        return $this->hashLists[$id] ?? self::fail(ErrorCodes::HASH_LIST_NOT_FOUND, null, 'Hash list not found.');
    }

    private static function hashListAction(mixed $action): bool { return $action === 'flag' || $action === 'block'; }

    private function createHashList(array $json): array
    {
        $name = $json['name'] ?? null;
        if (!is_string($name) || trim($name) === '' || !self::hashListAction($json['action'] ?? null)) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'A hash list needs a name and an action of flag or block');
        }
        $now = ($this->now)();
        $list = ['id' => ($this->createId)('hl'), 'projectId' => $this->projectId, 'name' => trim($name),
            'description' => is_string($json['description'] ?? null) ? $json['description'] : null, 'action' => $json['action'],
            'createdAt' => $now, 'updatedAt' => $now];
        // Like the API, a new hash list is 201 Created.
        $this->status = 201;
        return $this->hashLists[$list['id']] = $list;
    }

    /** GET, PATCH and DELETE /hash-lists/:id and its entries, like the API. Deleting a list deletes its entries. */
    private function hashListRoute(string $method, string $id, string $suffix, array $query, array $json): ?array
    {
        $list = $this->hashList($id);
        switch ($method . ' ' . $suffix) {
            case 'GET ':
                return $list;
            case 'PATCH ':
                if (is_string($json['name'] ?? null)) {
                    $list['name'] = trim($json['name']);
                }
                if (array_key_exists('description', $json)) {
                    $list['description'] = is_string($json['description']) ? $json['description'] : null;
                }
                if (self::hashListAction($json['action'] ?? null)) {
                    $list['action'] = $json['action'];
                }
                $list['updatedAt'] = ($this->now)();
                return $this->hashLists[$id] = $list;
            case 'DELETE ':
                unset($this->hashLists[$id]);
                $this->hashListEntries = array_filter($this->hashListEntries, fn (array $entry) => $entry['hashListId'] !== $id);
                return null;
            case 'GET entries':
                return $this->page(array_filter($this->hashListEntries, fn (array $entry) => $entry['hashListId'] === $id),
                    $query, Values::json(['hash-list-entries', $id]));
            case 'POST entries':
                return $this->addHashListEntry($list, $json);
        }
        throw new \LogicException("MockServerClient does not emulate $method $suffix for a hash list; enqueue a response for it");
    }

    /** A hash, or an image asset's perceptual hash; a hash the list already holds returns its entry with 200. */
    private function addHashListEntry(array $list, array $json): array
    {
        $hash = is_string($json['hash'] ?? null) ? strtolower(trim($json['hash'])) : null;
        $quality = is_int($json['quality'] ?? null) ? $json['quality'] : null;
        $assetId = is_string($json['assetId'] ?? null) ? $json['assetId'] : null;
        if (($hash === null) === ($assetId === null)) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'Send either hash or assetId');
        }
        if ($assetId !== null) {
            $content = ($this->assets[$assetId] ?? self::fail(ErrorCodes::ASSET_NOT_FOUND, null, 'Asset not found'))['content'];
            if (!is_string($content['perceptualHash'] ?? null) || $content['perceptualHash'] === '') {
                self::fail(ErrorCodes::HASH_LIST_ASSET_NOT_HASHED, null, 'This asset has no perceptual hash.');
            }
            $hash = $content['perceptualHash'];
            $quality = $content['perceptualHashQuality'] ?? null;
        }
        if (!preg_match('/^[0-9a-f]{64}$/D', $hash)) {
            self::fail(ErrorCodes::INVALID_UPLOAD_PAYLOAD, null, 'Use a PDQ hash of 64 hexadecimal characters');
        }
        foreach ($this->hashListEntries as $entry) {
            if ($entry['hashListId'] === $list['id'] && $entry['hash'] === $hash) {
                return $entry;
            }
        }
        $entry = ['id' => ($this->createId)('hle'), 'projectId' => $this->projectId, 'hashListId' => $list['id'], 'hash' => $hash,
            'quality' => $quality, 'label' => is_string($json['label'] ?? null) ? $json['label'] : null,
            'assetId' => $assetId, 'createdAt' => ($this->now)()];
        $this->status = 201;
        return $this->hashListEntries[$entry['id']] = $entry;
    }

    /**
     * Without `cursor` the page is empty and its `nextCursor` is now, like the API; `pageSize` is 1
     * to 100, 50 by default. `types` (comma-separated event types) and `assetId` narrow the feed.
     * Cursors are `mock_<n>~<filters>`: the feed position when taken and the filters they were
     * issued with, so a cursor used with other filters is `cursor/invalid`, like the API's. The
     * mock's key holds every permission, so no event type is excluded.
     */
    private function listEvents(array $query): array
    {
        $size = self::size($query, 'pageSize', self::DEFAULT_PAGE_SIZE, self::MAX_PAGE_SIZE);
        $typesValue = $query['types'] ?? null;
        $types = $typesValue === null ? [] : explode(',', (string) $typesValue);
        if ($typesValue !== null && (!is_string($typesValue) || array_filter($types, fn ($type) => !preg_match(self::EVENT_TYPE_PATTERN, $type)) !== [])) {
            self::invalid(ErrorCodes::INVALID_VALUE, 'types');
        }
        $assetId = $query['assetId'] ?? null;
        if ($assetId !== null && (!is_string($assetId) || !preg_match(self::ASSET_ID_PATTERN, $assetId))) {
            self::invalid(ErrorCodes::INVALID_FORMAT, 'assetId');
        }
        // Like the API, a cursor belongs to the filters it was issued with.
        $unique = array_values(array_unique($types));
        sort($unique);
        $filter = rtrim(strtr(base64_encode(Values::json([$unique, $assetId])), '+/', '-_'), '=');
        $matches = fn (array $event): bool => ($types === [] || in_array($event['type'] ?? null, $types, true))
            && ($assetId === null || ($event['assetId'] ?? null) === $assetId);
        if (!isset($query['cursor']) || $query['cursor'] === '') {
            return ['items' => [], 'nextCursor' => 'mock_' . count($this->events) . '~' . $filter, 'hasMore' => false, 'excludedTypes' => []];
        }
        if (!preg_match('/^mock_(\d+)~(.*)$/D', (string) $query['cursor'], $match) || $match[2] !== $filter || (int) $match[1] > count($this->events)) {
            self::fail(ErrorCodes::INVALID_CURSOR, null, 'The cursor is invalid or belongs to a different query.');
        }
        $items = [];
        $next = (int) $match[1];
        while ($next < count($this->events) && count($items) < $size) {
            $event = $this->events[$next++];
            if ($matches($event)) {
                $items[] = $event;
            }
        }
        $hasMore = array_filter(array_slice($this->events, $next), $matches) !== [];
        return ['items' => $items, 'nextCursor' => "mock_$next~$filter", 'hasMore' => $hasMore, 'excludedTypes' => []];
    }

    // Policies: the project starts on the organisation's own General preset policy, following
    // automatic updates (mode `live`). The mock's presets have one release, version 1, with
    // `presetSettings()`, and uploads are never decided by a policy.

    /** The built-in presets the mock knows, by display name. */
    private const PRESET_NAMES = ['general-community' => 'General', 'children-platform' => 'Kids',
        'education-support' => 'Learning and support', 'wholesome-community' => 'Teen-safe'];

    /**
     * @var array<string, array> Policies by ID, without `preset.latestVersion`, `preset.mode` and
     *   `projectIds`, each with its reset `baseline`, its `preset.own` and whether it follows its
     *   preset (`followsPreset`, mode `live`).
     */
    private array $policies = [];
    private ?string $projectPolicyId = null;

    /** The project's policy, after creating the organisation's own General policy on first use. */
    private function ensurePolicies(): string
    {
        return $this->projectPolicyId ??= $this->newPolicy('General', '', self::presetSettings(), true, 'general-community', true)['id'];
    }

    /**
     * The settings of the mock's presets: every category with its default action (`allow` for
     * personal information and profanity, `block` otherwise) and no rules.
     */
    private static function presetSettings(): array
    {
        $categories = [];
        foreach (Classification::CATEGORIES as $category) {
            $categories[$category] = ['action' => in_array($category, ['personal-information', 'profanity'], true) ? 'allow' : 'block',
                'allowances' => [], 'restrictions' => []];
        }
        return ['categorySettings' => $categories];
    }

    /**
     * Refuses settings the API refuses: every category, each with an `action` and its `allowances`
     * and `restrictions` lists, and no other category.
     */
    private static function checkPolicySettings(mixed $settings): void
    {
        $categories = is_array($settings) ? ($settings['categorySettings'] ?? null) : null;
        if (!is_array($categories) || ($categories !== [] && array_is_list($categories))) {
            self::invalid('validation/invalid-type', 'settings.categorySettings');
        }
        foreach (Classification::CATEGORIES as $category) {
            $value = $categories[$category] ?? null;
            if (!is_array($value) || ($value !== [] && array_is_list($value))) {
                self::invalid('validation/invalid-type', "settings.categorySettings.$category");
            }
            foreach (['allowances', 'restrictions'] as $key) {
                if (!is_array($value[$key] ?? null) || !array_is_list($value[$key])) {
                    self::invalid('validation/invalid-type', "settings.categorySettings.$category.$key");
                }
            }
            if (!is_string($value['action'] ?? null)) {
                self::invalid(ErrorCodes::INVALID_VALUE, "settings.categorySettings.$category.action");
            }
        }
        foreach (array_keys($categories) as $key) {
            if (!in_array($key, Classification::CATEGORIES, true)) {
                self::invalid('validation/unknown-field', "settings.categorySettings.$key");
            }
        }
    }

    private function newPolicy(string $name, string $description, array $settings, bool $followsPreset, ?string $preset, bool $presetOwn): array
    {
        $now = ($this->now)();
        $policy = ['id' => ($this->createId)('pol'), 'name' => $name, 'description' => $description, 'settings' => $settings,
            'revision' => 1, 'followsPreset' => $followsPreset,
            'preset' => $preset === null ? null : ['id' => $preset, 'version' => 1, 'own' => $presetOwn],
            'createdAt' => $now, 'updatedAt' => $now, 'baseline' => $settings];
        return $this->policies[$policy['id']] = $policy;
    }

    /** A stored policy as the API shows it. */
    private function toPolicy(array $policy): array
    {
        $shown = array_diff_key($policy, ['baseline' => true, 'followsPreset' => true, 'createdAt' => true, 'updatedAt' => true]);
        if ($shown['preset'] !== null) {
            $preset = $shown['preset'];
            $shown['preset'] = ['id' => $preset['id'], 'version' => $preset['version'], 'latestVersion' => 1,
                'mode' => $preset['own'] ? ($policy['followsPreset'] ? 'live' : 'pinned') : 'copy'];
        }
        return $shown + ['projectIds' => $policy['id'] === $this->projectPolicyId ? [$this->projectId] : [],
            'createdAt' => $policy['createdAt'], 'updatedAt' => $policy['updatedAt']];
    }

    private function policy(mixed $id): array
    {
        $this->ensurePolicies();
        return (is_string($id) ? $this->policies[$id] ?? null : null) ?? self::fail(ErrorCodes::POLICY_NOT_FOUND, null, 'Policy not found.');
    }

    /** A page of the organisation's policies, oldest first unless `sort` says otherwise. */
    private function listPolicies(array $query): array
    {
        $this->ensurePolicies();
        return $this->page(array_map(fn (array $policy) => $this->toPolicy($policy), $this->policies), $query,
            Values::json(['policies', $this->projectId]), [['field' => 'createdAt', 'direction' => 'asc']]);
    }

    private function createPolicy(array $json): array
    {
        $this->ensurePolicies();
        $name = $json['name'] ?? null;
        $preset = is_string($json['presetId'] ?? null) ? $json['presetId'] : null;
        $settings = $json['settings'] ?? null;
        if (($settings === null) === ($preset === null) || ($preset !== null && !isset(self::PRESET_NAMES[$preset]))
            || ($preset === null && (!is_string($name) || trim($name) === ''))) {
            self::fail(ErrorCodes::INVALID_VALUE, null, 'Send settings with a name, or presetId');
        }
        if ($preset === null) {
            self::checkPolicySettings($settings);
        }
        $policy = $this->newPolicy(is_string($name) && trim($name) !== '' ? trim($name) : self::PRESET_NAMES[$preset],
            is_string($json['description'] ?? null) ? $json['description'] : '', $preset !== null ? self::presetSettings() : $settings,
            false, $preset, false);
        // Like the API, a new policy is 201 Created.
        $this->status = 201;
        return $this->toPolicy($policy);
    }

    /** Saves `$values` under the next revision, once `$revision` is the current one. */
    private function savePolicy(array $policy, mixed $revision, array $values): array
    {
        if ($revision !== $policy['revision']) {
            self::fail(ErrorCodes::POLICY_REVISION_CONFLICT, null, 'The policy changed.');
        }
        $saved = array_replace($policy, $values, ['revision' => $policy['revision'] + 1, 'updatedAt' => ($this->now)()]);
        return $this->toPolicy($this->policies[$policy['id']] = $saved);
    }

    /** GET, PATCH and DELETE /policies/:policyId, its reset, upgrade and automatic updates, like the API. */
    private function policyRoute(string $method, string $id, string $action, array $json): ?array
    {
        $policy = $this->policy($id);
        $preset = $policy['preset'];
        switch ($method . ' ' . $action) {
            case 'GET ':
                return $this->toPolicy($policy);
            case 'PATCH ':
                if (array_key_exists('settings', $json)) {
                    self::checkPolicySettings($json['settings']);
                }
                return $this->savePolicy($policy, $json['revision'] ?? null, array_filter([
                    'name' => is_string($json['name'] ?? null) ? trim($json['name']) : null,
                    'description' => is_string($json['description'] ?? null) ? $json['description'] : null,
                    'settings' => $json['settings'] ?? null,
                ], fn ($value) => $value !== null) + [
                    // Saving a `live` policy pins it.
                    'followsPreset' => false,
                ]);
            case 'DELETE ':
                if ($id === $this->projectPolicyId) {
                    self::fail(ErrorCodes::POLICY_IN_USE, null, 'Projects still use this policy.');
                }
                unset($this->policies[$id]);
                return null;
            case 'POST reset':
            case 'POST upgrade':
                if ($preset === null || $policy['followsPreset']) {
                    self::fail(ErrorCodes::POLICY_NO_PRESET, null, 'This policy has no preset baseline.');
                }
                if (($json['presetVersion'] ?? null) !== $preset['version']) {
                    self::fail(ErrorCodes::POLICY_PRESET_VERSION_CONFLICT, null, 'The preset changed.');
                }
                // The mock's presets have one release, so an upgrade never has a newer one to apply.
                if ($action === 'upgrade') {
                    self::fail(ErrorCodes::POLICY_PRESET_UPDATE_UNAVAILABLE, null, 'Only an unchanged policy on an older preset release can be upgraded.');
                }
                return $this->savePolicy($policy, $json['revision'] ?? null, ['settings' => $policy['baseline']]);
            case 'PUT automatic-updates':
                $enabled = ($json['enabled'] ?? null) === true;
                if (!($preset['own'] ?? false) || $policy['followsPreset'] === $enabled) {
                    self::fail(ErrorCodes::POLICY_AUTOMATIC_UPDATES_UNAVAILABLE, null, "Automatic updates can't be switched this way for this policy.");
                }
                if (($json['revision'] ?? null) !== $policy['revision']) {
                    self::fail(ErrorCodes::POLICY_REVISION_CONFLICT, null, 'The policy changed.');
                }
                if (($json['presetVersion'] ?? null) !== 1) {
                    self::fail(ErrorCodes::POLICY_PRESET_VERSION_CONFLICT, null, 'The preset changed.');
                }
                return $this->savePolicy($policy, $json['revision'], ['followsPreset' => $enabled] + ($enabled
                    ? ['name' => self::PRESET_NAMES[$preset['id']], 'description' => '', 'settings' => $policy['baseline']] : []));
        }
        throw new \LogicException("MockServerClient does not emulate $method /policies/$id/$action; enqueue a response for it");
    }

    private function assignPolicy(array $json): array
    {
        $policy = $this->policy($json['policyId'] ?? null);
        $this->projectPolicyId = $policy['id'];
        return $this->toPolicy($policy);
    }

    /**
     * Saves each definition in order, like the API: a new identifier creates a lens, an unchanged
     * definition returns the stored lens, and a changed one updates it in place.
     */
    private function saveLenses(array $definitions): array
    {
        $saved = [];
        foreach ($definitions as $definition) {
            $old = $this->lenses[$definition['identifier']] ?? null;
            $saved[] = $old === null ? $this->saveNewLens($definition) : $this->changeLens($old, $definition);
        }
        return ['lenses' => $saved];
    }

    private function saveNewLens(array $definition): array
    {
        $now = ($this->now)();
        return $this->lenses[$definition['identifier']] = ['id' => ($this->createId)('lens'), 'projectId' => $this->projectId]
            + $definition + ['createdAt' => $now, 'updatedAt' => $now];
    }

    /** `$old` with `$definition`'s fields, saved unless nothing changed. */
    private function changeLens(array $old, array $definition): array
    {
        $same = true;
        foreach (['name', 'description', 'type', 'active'] as $field) {
            if (array_key_exists($field, $definition) && ($old[$field] ?? null) !== $definition[$field]) {
                $same = false;
            }
        }
        if (array_key_exists('transform', $definition)
            && Values::json(Values::canonical($old['transform'] ?? null)) !== Values::json(Values::canonical($definition['transform']))) {
            $same = false;
        }
        if ($same) {
            return $old;
        }
        return $this->lenses[$old['identifier']] = array_replace($old, $definition, ['updatedAt' => ($this->now)()]);
    }

    /** POST /projects/:projectId/lenses: a lens whose identifier is new to the project. */
    private function createLens(array $json): array
    {
        if (!is_string($json['identifier'] ?? null) || $json['identifier'] === '') {
            self::invalid('validation/invalid-type', 'identifier');
        }
        if (isset($this->lenses[$json['identifier']])) {
            self::fail(ErrorCodes::LENS_IDENTIFIER_TAKEN, null, 'The project already has a lens with this identifier.', ['identifier' => $json['identifier']]);
        }
        $this->status = 201;
        return $this->saveNewLens($json);
    }

    /** GET, PATCH and DELETE /lenses/:lensId, like the API; an update can't change the identifier. */
    private function lensRoute(string $method, string $id, array $json): ?array
    {
        $lens = null;
        foreach ($this->lenses as $candidate) {
            if ($candidate['id'] === $id) {
                $lens = $candidate;
            }
        }
        $lens ??= self::fail(ErrorCodes::LENS_NOT_FOUND, null, 'Lens not found.');
        switch ($method) {
            case 'GET':
                return $lens;
            case 'PATCH':
                return $this->changeLens($lens, array_diff_key($json, ['identifier' => true, 'id' => true, 'projectId' => true]));
            case 'DELETE':
                unset($this->lenses[$lens['identifier']]);
                return null;
        }
        throw new \LogicException("MockServerClient does not emulate $method /lenses/$id; enqueue a response for it");
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

    /**
     * Serves an asset's resources like the CDN, with its headers: `original` is the upload;
     * `rendered` the image, PDF, video or audio file `content.rendered` describes; `preview` the
     * still `content.preview` describes; `hls` the adaptive stream's files, which the mock never
     * prepares; `embed` a small page standing in for the embed page of any asset; `placeholder` the preview's
     * ThumbHash as a PNG; and `info` the display info. The asset is named by its ID, `ext:` and its
     * URL-encoded external ID, or a grant from `signAssetUrl`. The mock converts
     * nothing: an upload stands in for its rendered file and an image's preview, and the placeholder
     * PNG for a website screenshot, document page or audio waveform.
     */
    private function serve(string $method, array $segments, array $query, bool $keyed): Response
    {
        [$root, $project, $assetSegment, $resource] = array_map('rawurldecode', array_slice($segments, 0, 4)) + ['', '', '', ''];
        $assetSegment = $segments[2] ?? '';
        $selector = implode('/', array_slice($segments, 4));
        $noRenderedVersion = fn () => $this->json(404, ['code' => 'asset/no-rendered-version', 'message' => 'This asset has no such resource']);
        $invalidTransform = fn () => $this->json(400, ['code' => ErrorCodes::INVALID_TRANSFORM, 'message' => 'Invalid transform selector']);
        $notFound = fn () => $this->json(404, ['code' => 'asset/not-found', 'message' => 'Asset not found']);
        // Like the CDN, the adaptive stream's files sit beneath `/hls/` (its master playlist is
        // `/hls/index.m3u8`). Otherwise the selector after the resource is read; the original, the
        // embed page and the info take none.
        $transform = Transforms::parse($resource === 'hls' ? '' : $selector);
        $selected = $transform !== null && ($transform['lens'] !== null || $transform['options'] !== null);
        if ($transform === null || (in_array($resource, ['original', 'embed', 'info'], true) && $selected)) {
            return $invalidTransform();
        }
        if ($root !== 'assets' || $project !== $this->projectId || $assetSegment === '') {
            return $notFound();
        }
        // Like the CDN, the asset is `ext:` and its URL-encoded external ID, a grant (`sig_…`) or its ID.
        $grant = null;
        $find = function (string $field, string $value): ?array {
            foreach ($this->assets as $candidate) {
                if (($candidate[$field] ?? null) === $value) {
                    return $candidate;
                }
            }
            return null;
        };
        if (str_starts_with($assetSegment, 'sig_')) {
            $grant = self::decodeGrant($assetSegment);
            if ($grant === null) {
                return $this->json(403, ['code' => ErrorCodes::SIGNED_URL_INVALID, 'message' => "The signed asset URL's grant is invalid"]);
            }
            if ($grant['expiresAt'] <= ($this->now)()) {
                return $this->json(403, ['code' => ErrorCodes::SIGNED_URL_EXPIRED, 'message' => 'The signed URL has expired']);
            }
            $asset = $find('id', $grant['assetId']);
        } elseif (str_starts_with($assetSegment, 'ext:')) {
            $externalId = rawurldecode(substr($assetSegment, strlen('ext:')));
            $asset = $externalId === '' ? null : $find('externalId', $externalId);
        } else {
            $asset = $find('id', rawurldecode($assetSegment));
        }
        if ($asset === null || !in_array($resource, self::PATH_RESOURCES, true)) {
            return $notFound();
        }
        if ($resource === 'original' && $grant !== null && !$grant['original']) {
            return $this->json(403, ['code' => ErrorCodes::SIGNED_URL_ORIGINAL_NOT_GRANTED, 'message' => "This signed asset URL doesn't grant the original file"]);
        }
        // A grant authorises a private asset without the API key; a request without the key has no grants.
        $canDownload = fn (): bool => $grant !== null || ($keyed && $this->canDownload($asset['folderId'] ?? null));
        if ($resource === 'info') {
            return $this->serveInfo($method, $asset, $query, $canDownload());
        }
        $notAvailable = fn () => $this->json(403, ['code' => 'asset/not-available', 'message' => 'Asset is not available']);
        $status = $asset['classification']['moderation']['status'];
        $rendered = $asset['content']['rendered'] ?? null;
        $preview = $asset['content']['preview'] ?? null;
        // Like the CDN, a safety hold refuses every resource.
        if (($asset['content']['safetyHold'] ?? null) !== null) {
            return $notAvailable();
        }
        if ($resource === 'placeholder') {
            // Like the CDN: the preview's ThumbHash, public whatever the asset's visibility or
            // moderation status; refused for purged assets and assets without one (not yet
            // processed, without a preview, or content removed).
            $thumbhash = $preview['thumbhash'] ?? null;
            if ($thumbhash === null || $status === 'purged') {
                return $notAvailable();
            }
            return $this->cdnResponse($method, Placeholder::png($thumbhash), ['Content-Type' => 'image/png',
                'Cache-Control' => 'public, max-age=3600', 'Cache-Tag' => 'asset-' . $asset['id'],
                'ETag' => '"' . $thumbhash . '"']);
        }
        // Delivery checks come first and refuse everyone, like the CDN.
        $stored = $this->content[$asset['id']] ?? null;
        if ($asset['upload']['status'] === 'uploading' || in_array($status, ['blocked', 'purged'], true)
            || $asset['classification']['status'] === 'failed' || $asset['content']['status'] === 'removed'
            || ($resource === 'original' && $stored === null)) {
            return $notAvailable();
        }
        // Age-restricted assets need `viewerClaims.ageConfirmed=true` whatever the key.
        $claims = json_decode($query['viewerClaims'] ?? '{}', true);
        if ($status === 'age-restricted' && ($claims['ageConfirmed'] ?? false) !== true) return $this->json(403, ['code' => 'viewer/age-confirmation-required']);
        $private = $asset['visibility'] !== 'public';
        if ($private && !$canDownload()) {
            return $this->json(403, ['code' => ErrorCodes::PERMISSION_DENIED, 'message' => 'This API key needs assets:download permission for this asset’s folder.',
                'details' => ['permission' => 'assets:download']]);
        }
        // The embed page shows any asset that may be delivered, as its viewer for the asset's type
        // or a notice that the type has none.
        if ($resource === 'embed') {
            return $this->cdnResponse($method, self::EMBED_HTML, ['Content-Type' => 'text/html; charset=utf-8',
                'Cache-Control' => $claims ? 'private, no-store' : ($private ? 'private' : 'public') . ', max-age=3600',
                'Cache-Tag' => 'asset-' . $asset['id'], 'X-Content-Type-Options' => 'nosniff']);
        }
        // Then whether the asset has the resource, and whether it is a still image that takes a
        // lens or transform: the preview always is, the rendered file only when it is an image.
        if (($resource === 'rendered' && $rendered === null) || ($resource === 'preview' && $preview === null)) {
            return $noRenderedVersion();
        }
        // The mock prepares no stream, so it has no HLS files.
        if ($resource === 'hls') {
            return $noRenderedVersion();
        }
        $still = $resource === 'preview' || ($resource === 'rendered' && $rendered['kind'] === 'image');
        if (!$still && $selected) {
            return $invalidTransform();
        }
        // Then the options, checked against the transform schema once the asset may be served.
        if ($transform['options'] !== null) {
            ['unknownKeys' => $unknown, 'invalidKeys' => $invalid] = Transforms::check($transform['options']);
            if ($unknown !== [] || $invalid !== []) {
                return $this->json(400, ['code' => ErrorCodes::INVALID_TRANSFORM_OPTIONS,
                    'message' => 'Invalid transform options: ' . implode(', ', [...$unknown, ...$invalid])]);
            }
        }
        // The bytes: the upload, which stands in for its own rendered file and an image's preview,
        // or the placeholder PNG for a still the mock doesn't make.
        if ($resource === 'original' || ($resource === 'rendered' && $rendered['kind'] !== 'image') || $asset['type'] === 'image') {
            if ($stored === null) {
                return $notAvailable();
            }
            $bytes = $stored['bytes'];
            $type = $resource === 'rendered' ? $rendered['format'] : ($stored['type'] === '' ? 'application/octet-stream' : $stored['type']);
        } else {
            $bytes = Placeholder::png($preview['thumbhash'] ?? self::THUMBHASH);
            $type = 'image/png';
        }
        $immutable = $still || ($resource === 'original' && $asset['type'] === 'image');
        $base = strtolower(trim(explode(';', $type)[0]));
        // Like the CDN: a still image's bytes are immutable for a year, other content is kept for
        // an hour, by shared caches only when delivery is public.
        return $this->cdnResponse($method, $bytes, ['Content-Type' => $type,
            'Cache-Control' => $claims ? 'private, no-store' : ($private ? 'private' : 'public') . ', ' . ($immutable ? 'max-age=31536000, immutable' : 'max-age=3600'),
            'Cache-Tag' => 'asset-' . $asset['id']]
            + ($immutable ? ['ETag' => '"' . $asset['id'] . '"', 'Expires' => gmdate('D, d M Y H:i:s', intdiv(($this->now)(), 1000) + 31536000) . ' GMT'] : [])
            + ['X-Content-Type-Options' => 'nosniff', 'Content-Security-Policy' => "sandbox; default-src 'none'"]
            // Content a browser could run as a document is served as a download.
            + (in_array($base, self::ACTIVE_CONTENT_TYPES, true) || str_ends_with($base, '+xml') ? ['Content-Disposition' => 'attachment'] : []));
    }

    /**
     * The display info at `/info`, like the CDN's: the allowlisted fields and whether the viewer
     * the claims describe can see the content, decided as the other resources decide it. A private
     * asset's needs a grant or an API key with `assets:download`.
     */
    private function serveInfo(string $method, array $asset, array $query, bool $authorised): Response
    {
        $private = $asset['visibility'] !== 'public';
        if ($private && !$authorised) {
            return $this->json(404, ['code' => 'asset/not-available', 'message' => 'Asset is not available']);
        }
        $claims = json_decode($query['viewerClaims'] ?? '{}', true);
        if (!is_array($claims)) {
            return $this->json(400, ['code' => ErrorCodes::INVALID_VIEWER_CLAIMS, 'message' => 'Invalid viewer claims']);
        }
        $content = $asset['content'];
        $status = $asset['classification']['moderation']['status'];
        $availability = match (true) {
            ($content['safetyHold'] ?? null) !== null, $asset['upload']['status'] === 'uploading', in_array($status, ['blocked', 'purged'], true),
            $asset['classification']['status'] === 'failed', $content['status'] === 'removed' => Cdn::AVAILABILITY_UNAVAILABLE,
            $status === 'age-restricted' && ($claims['ageConfirmed'] ?? null) !== true => Cdn::AVAILABILITY_AGE_RESTRICTED,
            default => Cdn::AVAILABILITY_AVAILABLE,
        };
        $info = ['id' => $asset['id'], 'projectId' => $asset['projectId'], 'type' => $asset['type'], 'externalUrl' => $asset['externalUrl'] ?? null,
            'content' => ['format' => $content['format'] ?? null, 'width' => $content['width'] ?? null, 'height' => $content['height'] ?? null,
                'durationSeconds' => $content['durationSeconds'] ?? null, 'pageCount' => $content['pageCount'] ?? null,
                'rendered' => $content['rendered'] ?? null, 'preview' => $content['preview'] ?? null, 'hls' => $content['hls'] ?? null],
            'availability' => $availability];
        return $this->cdnResponse($method, json_encode($info, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            ['Content-Type' => 'application/json', 'Cache-Control' => ($private ? 'private' : 'public') . ', max-age=60', 'Cache-Tag' => 'asset-' . $asset['id']]);
    }

    private function cdnResponse(string $method, string $bytes, array $headers): Response
    {
        return new Response(200, $headers + ['Content-Length' => (string) strlen($bytes), 'X-Request-Id' => $this->requestId()],
            $method === 'HEAD' ? '' : $bytes);
    }
}
