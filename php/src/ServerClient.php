<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Session;
use CalmLens\Internal\Values;
use CalmLens\Model\Lens;
use Psr\Http\Client\ClientInterface;
use Psr\Log\LoggerInterface;

/**
 * @phpstan-import-type LensType from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class ServerClient
{
    public const DEFAULT_BASE_URL = 'https://api.calmlens.com/v1';
    public const DEFAULT_CDN_BASE_URL = 'https://cdn.calmlens.com/v1';
    /** Seconds each API request attempt may take, reading the response included. */
    public const DEFAULT_TIMEOUT = 120;
    /** Seconds each binary upload attempt may take: none unless set. */
    public const DEFAULT_UPLOAD_TIMEOUT = null;
    public const DEFAULT_MAX_RETRIES = 2;
    /** The largest API response body the client reads (32 MiB). */
    public const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
    /** Content larger than this many bytes that the client can read again is uploaded in parts of this size (8 MiB). */
    public const DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;
    /** The smallest and largest `partSizeBytes`: every part but the last is at least 5 MiB. */
    public const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
    public const MAX_PART_SIZE_BYTES = 64 * 1024 * 1024;
    /** ensureLenses sends new definitions in consecutive requests of at most this many. */
    public const ENSURE_LENSES_BATCH_SIZE = 100;

    public readonly Assets $assets;
    public readonly Folders $folders;
    public readonly HashLists $hashLists;
    public readonly Policies $policies;
    public readonly Lenses $lenses;
    public readonly UploadPresets $uploadPresets;
    public readonly ProjectSettings $projectSettings;
    public readonly MetadataFields $metadataFields;
    public readonly Events $events;
    public readonly Text $text;
    public readonly Cdn $cdn;
    public readonly UploadTokens $uploadTokens;
    private Session $session;
    public readonly string $projectId;

    /**
     * @param ?ClientInterface $httpClient the PSR-18 client that sends requests; by default the one
     *   installed (found with php-http/discovery), such as Guzzle. The timeouts below apply per
     *   attempt when it is Guzzle; configure another client's timeouts on that client.
     * @param ?string $apiKey the API key; `CALMLENS_API_KEY` when not passed.
     * @param ?string $projectId the project the client works in; `CALMLENS_PROJECT_ID` when not passed.
     * @param ?string $baseUrl the API's base URL; `CALMLENS_BASE_URL`, or the default, when not passed.
     * @param ?array{name: string, version?: string, url?: string} $appInfo your application, added to
     *   the user agent as ` name/version (url)`.
     * @param ?LoggerInterface $logger a PSR-3 logger for each request's outcome (info) and retries
     *   (debug); `CALMLENS_LOG=info` or `debug` logs to standard error instead. Logs never hold the
     *   API key, bodies, queries or a CDN URL's asset segment.
     * @param ?\Closure(array{operation: ?string, method: string, path: string, attempt: int, delayMs: ?int,
     *   status: ?int, requestId: ?string, errorCode: ?string, duration: float}): void $onAttempt called
     *   after each request attempt, with the wait in milliseconds before the next one (null for the
     *   last) and the error code the attempt failed with; `operation` is null for `request()`.
     * @param float $timeout seconds each API request attempt may take, reading the response included.
     * @param ?float $uploadTimeout seconds each binary upload attempt (file content and multipart
     *   parts) may take; none by default, since files may be large. Text uploads use `timeout`.
     * @param int $maxRetries retries after a retryable failure, for reads and for requests carrying
     *   an Idempotency-Key, unless their body is a one-shot stream.
     * @param int $maxResponseBytes the largest API response body the client reads.
     * @param int $partSizeBytes content larger than this (bytes, base64 or a seekable stream or
     *   file with a known size) is uploaded by `assets->create` and `assets->classify` as a
     *   multipart upload in parts of this size, from 5 MiB to 64 MiB (default 8 MiB). Each part is
     *   retried on its own, and repeating the call with the same `idempotencyKey` resumes an
     *   interrupted upload. One-shot streams and text go in one request.
     */
    public function __construct(
        #[\SensitiveParameter] ?string $apiKey = null,
        ?string $projectId = null,
        ?string $baseUrl = null,
        string $cdnBaseUrl = self::DEFAULT_CDN_BASE_URL,
        int|float $timeout = self::DEFAULT_TIMEOUT,
        int|float $connectTimeout = 10,
        int|float $maxRetries = self::DEFAULT_MAX_RETRIES,
        ?ClientInterface $httpClient = null,
        int|float $maxResponseBytes = self::DEFAULT_MAX_RESPONSE_BYTES,
        int|float|null $uploadTimeout = self::DEFAULT_UPLOAD_TIMEOUT,
        int|float $partSizeBytes = self::DEFAULT_PART_SIZE_BYTES,
        ?array $appInfo = null,
        ?LoggerInterface $logger = null,
        ?\Closure $onAttempt = null,
    ) {
        $apiKey ??= self::env('CALMLENS_API_KEY');
        $projectId ??= self::env('CALMLENS_PROJECT_ID');
        $baseUrl ??= self::env('CALMLENS_BASE_URL') ?? self::DEFAULT_BASE_URL;
        if ($apiKey === null || $projectId === null) {
            Values::invalid('Pass apiKey and projectId, or set CALMLENS_API_KEY and CALMLENS_PROJECT_ID', 'sdk/invalid-config');
        }
        if (!preg_match('/^[\x21-\x7e]+$/D', $apiKey) || $projectId === '' || in_array($projectId, ['.', '..'], true)) {
            Values::invalid('Invalid API key or project ID', 'sdk/invalid-config');
        }
        $this->projectId = $projectId;
        $this->session = new Session($apiKey, $projectId, Values::url($baseUrl), Values::url($cdnBaseUrl),
            compact('timeout', 'connectTimeout', 'maxRetries', 'maxResponseBytes', 'uploadTimeout'), $httpClient,
            self::appInfo($appInfo), $logger, $onAttempt);
        if (!is_int($partSizeBytes) || $partSizeBytes < self::MIN_PART_SIZE_BYTES || $partSizeBytes > self::MAX_PART_SIZE_BYTES) {
            Values::invalid('partSizeBytes must be an integer from 5 MiB (5242880) to 64 MiB (67108864)', 'sdk/invalid-config');
        }
        $this->session->partSizeBytes = $partSizeBytes;
        $this->assets = new Assets($this->session);
        $this->folders = new Folders($this->session);
        $this->hashLists = new HashLists($this->session);
        $this->policies = new Policies($this->session);
        $this->lenses = new Lenses($this->session);
        $this->uploadPresets = new UploadPresets($this->session);
        $this->projectSettings = new ProjectSettings($this->session);
        $this->metadataFields = new MetadataFields($this->session);
        $this->events = new Events($this->session);
        $this->text = new Text($this->assets);
        $this->cdn = new Cdn($this->session);
        $this->uploadTokens = new UploadTokens($apiKey);
    }

    public function __debugInfo(): array { return ['projectId' => $this->projectId]; }

    /** An environment variable's value, or null when it is unset or empty. */
    private static function env(string $name): ?string
    {
        $value = getenv($name);
        return is_string($value) && $value !== '' ? $value : null;
    }

    /** `appInfo` as the user agent suffix ` name/version (url)`, or null. */
    private static function appInfo(?array $appInfo): ?string
    {
        if ($appInfo === null) {
            return null;
        }
        $token = '/^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$/D';
        $unknown = array_diff(array_map('strval', array_keys($appInfo)), ['name', 'version', 'url']);
        $name = $appInfo['name'] ?? null;
        $version = $appInfo['version'] ?? null;
        $url = $appInfo['url'] ?? null;
        if ($unknown !== [] || !is_string($name) || !preg_match($token, $name)
            || ($version !== null && (!is_string($version) || !preg_match($token, $version)))
            || ($url !== null && (!is_string($url) || !preg_match('#^https?://[\x21-\x7e]+$#D', $url) || str_contains($url, ')')))) {
            Values::invalid('appInfo takes a name, and an optional version and http(s) url, without spaces', 'sdk/invalid-config');
        }
        return $name . ($version === null ? '' : "/$version") . ($url === null ? '' : " ($url)");
    }

    /**
     * Sends an API request the SDK has no method for, with the client's API key, retries, timeouts
     * and error mapping, and returns the response with its decoded JSON body (`json`). `$path` is
     * beneath the base URL, such as `'/projects/' . $client->projectId . '/assets'`; `$query` becomes
     * the query string and an array or object `$body` the JSON body. Reads, and writes with an
     * `idempotencyKey`, are retried like the SDK's own.
     *
     * @param array<string, mixed> $query
     * @param array<string, mixed> $requestOptions
     */
    public function request(string $method, string $path, array $query = [], array|object|null $body = null, array $requestOptions = []): ApiResponse
    {
        $method = strtoupper($method);
        if (!preg_match('/^[A-Z]+$/D', $method) || !str_starts_with($path, '/') || str_starts_with($path, '//') || preg_match('/[\s?#]/', $path)) {
            Values::invalid('Pass an HTTP method and a path beneath the base URL, starting with /, without a query');
        }
        $this->session->operation = null;
        $json = $this->session->request($method, $path, query: $query, body: $body, options: $requestOptions);
        $last = $this->session->lastResponse;
        return new ApiResponse($last->status ?? 204, $last->headers ?? [], $last?->requestId, $json, $last?->idempotencyKey);
    }

    /**
     * Creates a named lens, or changes it to this definition; `active` is true unless it says
     * otherwise. Sending the same definition again returns the lens unchanged, from the client's
     * lens cache once it has seen it.
     *
     * @param array{
     *     identifier: string, name: string, description?: ?string, type: LensType, active?: bool,
     *     transform?: array<string, mixed>|null,
     * } $params
     * @param RequestOptions $requestOptions
     */
    public function ensureLens(array $params, array $requestOptions = []): Lens
    {
        Values::knownOptions($params, 'ensureLens');
        return $this->ensureLenses(['lenses' => [$params]], $requestOptions)[0];
    }

    /**
     * Creates or changes several named lenses, as `ensureLens` does. New definitions are sent in
     * one request, or in consecutive requests of at most `ENSURE_LENSES_BATCH_SIZE`, in order.
     *
     * @param array{
     *     lenses: list<array{
     *         identifier: string, name: string, description?: ?string, type: LensType, active?: bool,
     *         transform?: array<string, mixed>|null,
     *     }>,
     * } $params
     * @param RequestOptions $requestOptions
     * @return list<Lens>
     */
    public function ensureLenses(array $params, array $requestOptions = []): array
    {
        Values::knownOptions($params, 'ensureLenses');
        $this->session->operation = 'ensureLenses';
        $definitions = $params['lenses'] ?? null;
        if (!is_array($definitions) || !array_is_list($definitions) || $definitions === []) {
            Values::invalid('Supply a non-empty list of lenses');
        }
        $keys = [];
        $missing = [];
        foreach ($definitions as $definition) {
            if (!is_array($definition) || !is_string($definition['identifier'] ?? null) || $definition['identifier'] === '') {
                Values::invalid('Every lens needs an identifier');
            }
            // The API takes a lens without `active` as active, so both name the same definition.
            $key = Values::json(Values::canonical($definition + ['active' => true]));
            $keys[] = $key;
            if (!isset($this->session->ensuredLenses[$key])) {
                $missing[$key] = $definition;
            }
        }
        $resolved = $this->session->ensuredLenses;
        foreach (array_chunk($missing, self::ENSURE_LENSES_BATCH_SIZE, true) as $chunk) {
            $sent = array_values($chunk);
            $response = $this->session->request('PUT', $this->session->project('lenses'), body: ['lenses' => $sent], options: $requestOptions);
            $returned = is_array($response['lenses'] ?? null) && array_is_list($response['lenses']) ? $response['lenses'] : [];
            if (count($returned) !== count($sent)) {
                throw CalmLensException::create('sdk/invalid-response', 'Unexpected lens response');
            }
            foreach ($sent as $index => $definition) {
                if (($returned[$index]['identifier'] ?? null) !== $definition['identifier']) {
                    throw CalmLensException::create('sdk/invalid-response', 'Unexpected lens identifier');
                }
            }
            foreach (array_keys($chunk) as $index => $key) {
                foreach ($this->session->ensuredLenses as $oldKey => $old) {
                    if ($old['identifier'] === $returned[$index]['identifier']) {
                        unset($this->session->ensuredLenses[$oldKey]);
                    }
                }
                $resolved[$key] = $returned[$index];
                $this->session->rememberLens($key, $returned[$index]);
            }
        }
        $last = $missing === [] ? null : $this->session->lastResponse;
        return array_map(fn ($key) => Lens::constructFrom($resolved[$key])->withLastResponse($last), $keys);
    }
}
