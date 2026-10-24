<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Session;
use CalmLens\Internal\Values;
use GuzzleHttp\ClientInterface;

final class ServerClient
{
    public readonly Assets $assets;
    public readonly Folders $folders;
    public readonly Events $events;
    public readonly Text $text;
    public readonly Cdn $cdn;
    public readonly UploadTokens $uploadTokens;
    private Session $session;
    private array $lenses = [];

    public function __construct(
        #[\SensitiveParameter] string $apiKey,
        public readonly string $projectId,
        string $baseUrl = 'https://api.calmlens.com/v1',
        string $cdnBaseUrl = 'https://cdn.calmlens.com/v1',
        float $timeout = 120,
        float $connectTimeout = 10,
        int $maxRetries = 2,
        ?ClientInterface $httpClient = null,
    ) {
        if (!preg_match('/^[\x21-\x7e]+$/D', $apiKey) || $projectId === '' || in_array($projectId, ['.', '..'], true)) {
            Values::invalid('Invalid API key or project ID', 'sdk/invalid-config');
        }
        $this->session = new Session($apiKey, $projectId, Values::url($baseUrl), Values::url($cdnBaseUrl),
            compact('timeout', 'connectTimeout', 'maxRetries'), $httpClient);
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
        foreach (array_chunk($missing, 100, true) as $chunk) {
            $sent = array_values($chunk);
            $response = $this->session->request('PUT', $this->session->project('lenses'), body: ['lenses' => $sent], options: $options['requestOptions'] ?? []);
            $returned = $response['lenses'] ?? $response;
            if (!is_array($returned) || count($returned) !== count($sent)) {
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
