<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\ErrorCodes;
use CalmLens\Exception;
use CalmLens\Testing\MockServerClient;
use CalmLens\ServerClient;
use CalmLens\Webhooks;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Replays every shared SDK contract fixture (packages/sdk-contract/README.md): requests, paths,
 * webhooks, errors, transform options, mock behaviour scenarios, the capability surface and
 * rejected requests. Each fixture case is its own named test.
 */
final class ContractTest extends TestCase
{
    private static function fixtures(string $name): array
    {
        // Reuse the generated native contract in place: no PHP copy that can drift.
        return json_decode(file_get_contents(__DIR__ . '/../../ruby/testdata/' . $name . '.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /** A client whose transport fails the test if anything is sent. */
    private static function offlineClient(): ServerClient
    {
        return new ServerClient('key', 'project-1', maxRetries: 0, httpClient: new Client(['handler' => function () { self::fail('Unexpected network request'); }]));
    }

    private static function invoke(ServerClient $client, string $operation, array $options): mixed
    {
        $parts = explode('.', $operation);
        return count($parts) === 1 ? $client->{$parts[0]}($options) : $client->{$parts[0]}->{$parts[1]}($options);
    }

    // requests.json

    public static function requests(): iterable
    {
        foreach (self::fixtures('requests') as $i => $fixture) {
            yield $i . ': ' . $fixture['operation'] => [$fixture];
        }
    }

    private static function captured(Psr\Http\Message\RequestInterface $request): array
    {
        $query = [];
        foreach (explode('&', $request->getUri()->getQuery()) as $pair) {
            if ($pair !== '') {
                [$key, $value] = explode('=', $pair, 2);
                $query[rawurldecode($key)] = rawurldecode($value);
            }
        }
        $body = (string) $request->getBody();
        $body = $request->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : ($body === '' ? null : $body);
        return ['method' => $request->getMethod(), 'path' => $request->getUri()->getPath(), 'query' => $query, 'body' => $body];
    }

    private static function expectedResult(array $fixture): mixed
    {
        return match (true) {
            str_ends_with($fixture['operation'], '.delete') => null,
            $fixture['operation'] === 'ensureLenses' => $fixture['response']['lenses'],
            default => $fixture['response'],
        };
    }

    #[DataProvider('requests')]
    public function testSharedRequestContract(array $fixture): void
    {
        $calls = 0;
        $handler = function ($request) use ($fixture, &$calls) {
            $calls++;
            self::assertSame('key', $request->getHeaderLine('X-Api-Key'));
            self::assertEquals($fixture['request'], self::captured($request));
            return Create::promiseFor(new Response(200, [], json_encode($fixture['response'])));
        };
        $client = new ServerClient('key', 'project-1', httpClient: new Client(['handler' => $handler]));
        self::assertSame(self::expectedResult($fixture), self::invoke($client, $fixture['operation'], $fixture['options']));
        self::assertSame(1, $calls);
    }

    /** Enqueued responses still pass through the real client, so every request contract holds against the mock. */
    #[DataProvider('requests')]
    public function testMockQueuedResponsesReplayEveryRequestContract(array $fixture): void
    {
        $mock = new MockServerClient(projectId: 'project-1');
        $mock->enqueueJson($fixture['response']);
        self::assertSame(self::expectedResult($fixture), self::invoke($mock->client(), $fixture['operation'], $fixture['options']));
        self::assertEquals($fixture['request'], self::captured($mock->requests()[0]));
        self::assertSame(0, $mock->pending());
    }

    // paths.json

    public static function paths(): iterable
    {
        foreach (self::fixtures('paths')['rejections'] as $i => $fixture) {
            yield 'rejection ' . $i => [$fixture];
        }
        foreach (self::fixtures('paths')['cdnUrls'] as $i => $fixture) {
            yield 'cdn ' . $i => [$fixture + ['operation' => 'cdn.getAssetUrl']];
        }
    }

    #[DataProvider('paths')]
    public function testSharedPathContract(array $fixture): void
    {
        $client = self::offlineClient();
        if (isset($fixture['url'])) {
            self::assertSame($fixture['url'], self::invoke($client, $fixture['operation'], $fixture['options']));
            return;
        }
        try {
            self::invoke($client, $fixture['operation'], $fixture['options']);
            self::fail('Expected ' . $fixture['error']);
        } catch (Exception\InvalidArgumentException $error) {
            self::assertSame($fixture['error'], $error->errorCode);
        }
    }

    // webhooks.json

    public static function webhooks(): iterable
    {
        $fixtures = self::fixtures('webhooks');
        foreach ($fixtures['signatures'] as $i => $entry) {
            yield 'signature ' . $i => ['signatures', $entry];
        }
        foreach ($fixtures['verification'] as $i => $entry) {
            yield 'verification ' . $i . ': ' . $entry['name'] => ['verification', $entry];
        }
        foreach ($fixtures['parsing'] as $i => $entry) {
            yield 'parsing ' . $i => ['parsing', $entry];
        }
        foreach ($fixtures['payloads'] as $i => $entry) {
            yield 'payload ' . $i => ['payloads', $entry];
        }
    }

    #[DataProvider('webhooks')]
    public function testSharedWebhookContract(string $kind, array $entry): void
    {
        switch ($kind) {
            case 'signatures':
                self::assertSame($entry['signature'], Webhooks::signatureHeader($entry['body'], $entry['timestamp'], $entry['secret']));
                return;
            case 'verification':
                self::assertSame($entry['valid'], Webhooks::verify($entry['body'], $entry['signature'], $entry['timestamp'], $entry['secret'], $entry['toleranceSeconds'] ?? 300, $entry['now']));
                return;
            case 'parsing':
                $event = Webhooks::parseEvent($entry['body'], $entry['signature'], $entry['timestamp'], $entry['secret'], now: $entry['now']);
                self::assertSame(json_decode($entry['body'], true), $event);
                self::assertSame($entry['expectedType'], $event['type']);
                self::assertSame($entry['expectedFactKey'], $event['data']['facts'][0]['key']);
                return;
            case 'payloads':
                $body = json_encode($entry['payload']);
                $event = Webhooks::parseEvent($body, Webhooks::signatureHeader($body, 1760000000, 'secret'), '1760000000', 'secret', now: 1760000000);
                self::assertSame($entry['payload'], $event);
                self::assertSame($entry['event']['facts'], $event['data']['facts']);
                return;
        }
        self::fail('Unknown webhook fixture kind ' . $kind);
    }

    // errors.json

    public static function errors(): iterable
    {
        foreach (self::fixtures('errors') as $entry) {
            yield $entry['code'] => [$entry];
        }
    }

    #[DataProvider('errors')]
    public function testSharedApiErrorPreservesCodeAndStatus(array $entry): void
    {
        $mock = new CalmLens\Testing\MockTransport();
        $mock->enqueueJson(['code' => $entry['code'], 'details' => ['reason' => 'test'], 'traceId' => 'trace-1'], $entry['status']);
        try {
            $mock->client()->assets->retrieve(['assetId' => 'asset']);
            self::fail('Expected API error');
        } catch (Exception\ApiException $error) {
            self::assertSame($entry['code'], $error->errorCode);
            self::assertSame($entry['status'], $error->status);
            self::assertSame(['reason' => 'test', 'network' => true, 'traceId' => 'trace-1'], $error->details);
            $class = [400 => Exception\BadRequestException::class, 401 => Exception\AuthenticationException::class,
                403 => Exception\PermissionDeniedException::class, 404 => Exception\NotFoundException::class,
                409 => Exception\ConflictException::class, 429 => Exception\RateLimitException::class][$entry['status']]
                ?? ($entry['status'] >= 500 ? Exception\ServerException::class : Exception\ApiException::class);
            self::assertInstanceOf($class, $error);
        }
    }

    // surface.json retryable: whether an error is retryable follows from its code and status alone.

    public static function retryable(): iterable
    {
        foreach (self::fixtures('surface')['retryable'] as $entry) {
            yield $entry['code'] . ' ' . json_encode($entry['status']) => [$entry];
        }
    }

    #[DataProvider('retryable')]
    public function testRetryableFollowsCodeAndStatus(array $entry): void
    {
        // The base class and the specific class the SDK raises for this code and status.
        foreach ([new CalmLensException($entry['code'], status: $entry['status']),
            CalmLensException::create($entry['code'], status: $entry['status'])] as $error) {
            self::assertSame($entry['retryable'], $error->isRetryable(), $error::class);
        }
    }

    /** The mock answers each code with this status, so a stale ErrorCodes class would mislead callers and tests. */
    public function testErrorCodesMatchTheSharedErrorsFixture(): void
    {
        self::assertSame(array_column(self::fixtures('errors'), 'status', 'code'), ErrorCodes::STATUSES);
        $constants = (new ReflectionClass(ErrorCodes::class))->getConstants();
        unset($constants['STATUSES']);
        self::assertEqualsCanonicalizing(array_column(self::fixtures('errors'), 'code'), array_values($constants));
    }

    // transform-options.json

    public static function transformOptions(): iterable
    {
        foreach (self::fixtures('transform-options')['cases'] as $i => $case) {
            yield 'transform ' . $i . ': ' . $case['selector'] => [$case];
        }
    }

    /** Every transform option serializes to the step the CDN writes for it, through the public URL builder. */
    #[DataProvider('transformOptions')]
    public function testTransformOption(array $case): void
    {
        $step = ['type' => 'imageTransform', 'options' => $case['options']];
        $url = self::offlineClient()->cdn->getAssetUrl(['assetIdentifier' => 'asset-1', 'transform' => $step]);
        self::assertSame($case['selector'], explode('/rendered/', $url, 2)[1]);
    }

    public function testTransformColourKeysMatchTheFixture(): void
    {
        self::assertSame(self::fixtures('transform-options')['colourKeys'], (new ReflectionClassConstant(\CalmLens\Internal\Transforms::class, 'COLOUR_KEYS'))->getValue());
    }

    // mock-scenarios.json: replayed against MockServerClient.

    public static function scenarios(): iterable
    {
        foreach (self::fixtures('mock-scenarios')['scenarios'] as $scenario) {
            yield $scenario['name'] => [$scenario];
        }
    }

    /** Follows a dotted path: numeric segments index arrays, `length` is an array's length. */
    private static function at(mixed $value, string $path): mixed
    {
        foreach (explode('.', $path) as $segment) {
            if (is_array($value) && array_is_list($value)) {
                $value = $segment === 'length' ? count($value) : ($value[(int) $segment] ?? null);
            } else {
                $value = is_array($value) ? ($value[$segment] ?? null) : null;
            }
        }
        return $value;
    }

    private static function resolve(mixed $value, array $saved): mixed
    {
        if (is_array($value) && isset($value['$ref'])) {
            [$name, $rest] = explode('.', $value['$ref'], 2);
            return self::at($saved[$name], $rest);
        }
        return is_array($value) ? array_map(fn ($item) => self::resolve($item, $saved), $value) : $value;
    }

    private static function runStep(MockServerClient $mock, string $operation, array $args): mixed
    {
        $client = $mock->client();
        switch ($operation) {
            case 'mock.decide':
                return $mock->decide($args['assetId'], $args['outcome']);
            case 'mock.enqueueEvent':
                return $mock->enqueueEvent($args);
            case 'cdn.serve':
                $response = $client->cdn->serve($args);
                $body = (string) $response->getBody();
                $json = $response->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : null;
                return ['status' => $response->getStatusCode(), 'code' => $json['code'] ?? null, 'body' => $body,
                    'headers' => $response->getHeaders()];
            case 'assets.waitForDecision':
                $args['timeout'] = $args['timeoutMs'] / 1000;
                unset($args['timeoutMs']);
                return $client->assets->waitForDecision($args);
        }
        if (array_key_exists('idempotencyKey', $args)) {
            $args['requestOptions'] = ['idempotencyKey' => $args['idempotencyKey']];
            unset($args['idempotencyKey']);
        }
        return self::invoke($client, $operation, $args);
    }

    #[DataProvider('scenarios')]
    public function testMockScenario(array $scenario): void
    {
        $options = $scenario['mock'];
        $mock = new MockServerClient(
            queuedOutcome: $options['queuedOutcome'] ?? 'pending',
            analyzedOutcome: $options['analyzedOutcome'] ?? 'allowed',
            apiKey: MockServerClient::createApiKey($options['apiKeyGrants'] ?? []),
        );
        $saved = [];
        $started = microtime(true);
        foreach ($scenario['steps'] as $step) {
            $label = $step['operation'] . ' ' . json_encode($step['args'] ?? []);
            $args = self::resolve($step['args'] ?? [], $saved);
            $expect = $step['expect'] ?? [];
            if (isset($expect['error'])) {
                try {
                    self::runStep($mock, $step['operation'], $args);
                    self::fail("$label: expected {$expect['error']['code']}");
                } catch (CalmLensException $error) {
                    self::assertSame($expect['error'], ['code' => $error->errorCode, 'status' => $error->status], $label);
                }
                continue;
            }
            $result = self::runStep($mock, $step['operation'], $args);
            if (isset($expect['cdn'])) {
                $actual = [];
                foreach (array_keys($expect['cdn']) as $key) {
                    $actual[$key] = $result[$key];
                }
                // Header names are case-insensitive.
                if (isset($expect['cdn']['headers'])) {
                    $served = array_change_key_case(array_map(fn ($values) => implode(', ', $values), $result['headers']));
                    $actual['headers'] = [];
                    foreach (array_keys($expect['cdn']['headers']) as $name) {
                        $actual['headers'][$name] = $served[strtolower($name)] ?? null;
                    }
                }
                self::assertSame($expect['cdn'], $actual, $label);
            }
            if (isset($expect['sameAs'])) {
                self::assertArrayHasKey($expect['sameAs'], $saved, "$label: nothing saved as {$expect['sameAs']}");
                self::assertSame($saved[$expect['sameAs']], $result, "$label: same as {$expect['sameAs']}");
            }
            foreach ($expect['result'] ?? [] as $path => $raw) {
                if (is_array($raw) && array_key_exists('$contains', $raw)) {
                    self::assertContains(self::resolve($raw['$contains'], $saved), self::at($result, $path), "$label: $path");
                } else {
                    self::assertSame(self::resolve($raw, $saved), self::at($result, $path), "$label: $path");
                }
            }
            if (isset($step['save'])) {
                $saved[$step['save']] = $result;
            }
        }
        // Mock waits take no real time.
        self::assertLessThan(5, microtime(true) - $started);
    }

    // surface.json: every capability a server SDK must offer exists under its PHP name.

    public static function capabilities(): iterable
    {
        foreach (self::fixtures('surface')['capabilities'] as $capability) {
            yield $capability['id'] => [$capability];
        }
    }

    private static function raisedError(array $spec): CalmLensException
    {
        $client = new ServerClient('key', 'project-1', maxRetries: 0, httpClient: new Client(['handler' => fn () => Create::promiseFor(new Response($spec['status'], $spec['headers'], json_encode($spec['body'])))]));
        try {
            self::invoke($client, $spec['operation'], $spec['options']);
        } catch (CalmLensException $error) {
            return $error;
        }
        self::fail($spec['operation'] . ' did not fail');
    }

    private static function mockOutcome(string $option): ?string
    {
        $mock = new MockServerClient(...[$option => 'blocked']);
        $content = ['name' => 'note.txt', 'content' => ['plainText' => 'hello', 'type' => 'text/plain']];
        $assets = $mock->client()->assets;
        $asset = $option === 'queuedOutcome' ? $assets->create($content) : $assets->classify($content);
        return $asset['classification']['moderation']['status'] ?? null;
    }

    /** `Class::member` with the class relative to the CalmLens namespace. */
    private static function member(string $name): array
    {
        [$class, $member] = explode('::', $name, 2);
        return ['CalmLens\\' . $class, $member];
    }

    private static function present(array $capability): bool
    {
        $name = $capability['names']['php'];
        switch ($capability['kind']) {
            case 'method':
                $parts = explode('->', $name);
                $method = array_pop($parts);
                $target = self::offlineClient();
                foreach ($parts as $property) {
                    if (!property_exists($target, $property)) {
                        return false;
                    }
                    $target = $target->{$property};
                }
                return method_exists($target, $method);
            case 'function':
            case 'mock-function':
                [$class, $method] = self::member($name);
                return method_exists($class, $method) && (new ReflectionMethod($class, $method))->isStatic();
            case 'constant':
                [$class, $constant] = self::member($name);
                return defined($class . '::' . $constant) && constant($class . '::' . $constant) === $capability['value'];
            case 'error-field':
                $spec = self::fixtures('surface')['errorResponse'];
                $expected = $spec['expected'];
                $want = [
                    'errors.code' => $expected['code'],
                    'errors.status' => $expected['status'],
                    'errors.requestId' => $expected['requestId'],
                    'errors.retryAfter' => (float) $expected['retryAfterSeconds'],
                ][$capability['id']];
                $error = self::raisedError($spec);
                if (str_ends_with($name, '()')) {
                    $method = substr($name, 0, -2);
                    return method_exists($error, $method) && $error->{$method}() === $want;
                }
                return property_exists($error, $name) && $error->{$name} === $want;
            case 'cdn-resource':
                $url = self::offlineClient()->cdn->getAssetUrl(['assetIdentifier' => 'asset-1', 'resource' => $name]);
                return str_ends_with($url, '/asset-1/' . $capability['value']);
            case 'cdn-option':
                $url = self::offlineClient()->cdn->getAssetUrl(['assetIdentifier' => 'asset-1', $name => true]);
                return str_ends_with($url, '?allowAgeRestricted=true');
            case 'mock-client':
                return class_exists('CalmLens\\' . $name);
            case 'mock-method':
                return method_exists(MockServerClient::class, $name);
            case 'mock-option':
                return self::mockOutcome($name) === 'blocked';
        }
        self::fail('Unknown capability kind ' . $capability['kind']);
    }

    #[DataProvider('capabilities')]
    public function testOffersCapability(array $capability): void
    {
        self::assertTrue(self::present($capability), $capability['id'] . ' (' . $capability['names']['php'] . ')');
    }

    // rejections.json: every request the API would reject is refused before anything is sent.

    public static function rejections(): iterable
    {
        foreach (self::fixtures('rejections') as $fixture) {
            yield $fixture['name'] => [$fixture];
        }
    }

    #[DataProvider('rejections')]
    public function testRefusesRejectedRequestBeforeSending(array $fixture): void
    {
        try {
            self::invoke(self::offlineClient(), $fixture['operation'], $fixture['options']);
            self::fail('Expected ' . $fixture['error']);
        } catch (CalmLensException $error) {
            self::assertSame($fixture['error'], $error->errorCode);
        }
    }
}
