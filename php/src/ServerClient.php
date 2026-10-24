<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Session;
use CalmLens\Internal\Values;
use GuzzleHttp\ClientInterface;

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
    /** ensureLenses sends new definitions in consecutive requests of at most this many. */
    public const ENSURE_LENSES_BATCH_SIZE = 100;

    public readonly Assets $assets;
    public readonly Folders $folders;
    public readonly Events $events;
    public readonly Text $text;
    public readonly Cdn $cdn;
    public readonly UploadTokens $uploadTokens;
    private Session $session;
    private array $lenses = [];

    /**
     * @param float $timeout seconds each API request attempt may take, reading the response included.
     * @param ?float $uploadTimeout seconds each binary upload attempt (file content and multipart
     *   parts) may take; none by default, since files may be large. Text uploads use `timeout`.
     * @param int $maxRetries retries after a retryable failure, for reads and for requests carrying
     *   an Idempotency-Key, unless their body is a one-shot stream.
     * @param int $maxResponseBytes the largest API response body the client reads.
     */
    public function __construct(
        #[\SensitiveParameter] string $apiKey,
        public readonly string $projectId,
        string $baseUrl = self::DEFAULT_BASE_URL,
        string $cdnBaseUrl = self::DEFAULT_CDN_BASE_URL,
        int|float $timeout = self::DEFAULT_TIMEOUT,
        int|float $connectTimeout = 10,
        int|float $maxRetries = self::DEFAULT_MAX_RETRIES,
        ?ClientInterface $httpClient = null,
        int|float $maxResponseBytes = self::DEFAULT_MAX_RESPONSE_BYTES,
        int|float|null $uploadTimeout = self::DEFAULT_UPLOAD_TIMEOUT,
    ) {
        if (!preg_match('/^[\x21-\x7e]+$/D', $apiKey) || $projectId === '' || in_array($projectId, ['.', '..'], true)) {
            Values::invalid('Invalid API key or project ID', 'sdk/invalid-config');
        }
        $this->session = new Session($apiKey, $projectId, Values::url($baseUrl), Values::url($cdnBaseUrl),
            compact('timeout', 'connectTimeout', 'maxRetries', 'maxResponseBytes', 'uploadTimeout'), $httpClient);
        $this->assets = new Assets($this->session);
        $this->folders = new Folders($this->session);
        $this->events = new Events($this->session);
        $this->text = new Text($this->assets);
        $this->cdn = new Cdn($this->session);
        $this->uploadTokens = new UploadTokens($apiKey);
    }

    public function __debugInfo(): array { return ['projectId' => $this->projectId]; }

    public function ensureLens(array $options): array
    {
        $request = $options['requestOptions'] ?? [];
        unset($options['requestOptions']);
        return $this->ensureLenses(['lenses' => [$options], 'requestOptions' => $request])[0];
    }

    public function ensureLenses(array $options): array
    {
        $definitions = $options['lenses'] ?? null;
        if (!is_array($definitions) || !array_is_list($definitions) || $definitions === []) {
            Values::invalid('Supply a non-empty list of lenses');
        }
        $keys = [];
        $missing = [];
        foreach ($definitions as $definition) {
            if (!is_array($definition) || !is_string($definition['identifier'] ?? null) || $definition['identifier'] === '') {
                Values::invalid('Every lens needs an identifier');
            }
            $key = Values::json(Values::canonical($definition));
            $keys[] = $key;
            if (!isset($this->lenses[$key])) {
                $missing[$key] = $definition;
            }
        }
        $resolved = $this->lenses;
        foreach (array_chunk($missing, self::ENSURE_LENSES_BATCH_SIZE, true) as $chunk) {
            $sent = array_values($chunk);
            $response = $this->session->request('PUT', $this->session->project('lenses'), body: ['lenses' => $sent], options: $options['requestOptions'] ?? []);
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
                foreach ($this->lenses as $oldKey => $old) {
                    if ($old['identifier'] === $returned[$index]['identifier']) {
                        unset($this->lenses[$oldKey]);
                    }
                }
                $resolved[$key] = $this->lenses[$key] = $returned[$index];
            }
        }
        return array_map(fn ($key) => $resolved[$key], $keys);
    }
}
