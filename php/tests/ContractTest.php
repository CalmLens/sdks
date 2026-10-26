<?php

declare(strict_types=1);

use CalmLens\Assets;
use CalmLens\CalmLensException;
use CalmLens\ErrorCodes;
use CalmLens\Exception;
use CalmLens\Internal\Session;
use CalmLens\ServerClient;
use CalmLens\Testing\MockServerClient;
use CalmLens\UploadTokens;
use CalmLens\Webhooks;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\NoSeekStream;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\ServerRequest;
use GuzzleHttp\Psr7\Utils;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * Replays every shared SDK contract fixture (packages/sdk-contract/README.md) from Ruby's testdata
 * copies: requests, paths, errors, the scripted client cases, webhooks, upload tokens, transform
 * options, mock behaviour scenarios, the capability surface with its defaults and retryable
 * rules, and rejected requests. Each fixture case is its own named test.
 */
final class ContractTest extends TestCase
{
    private static array $cache = [];

    private static function fixtures(string $name): array
    {
        // Reuse the generated native contract in place: no PHP copy that can drift.
        return self::$cache[$name] ??= json_decode(file_get_contents(__DIR__ . '/../../ruby/testdata/' . $name . '.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /** Sorts object keys at every level, so JSON values compare whatever their key order. */
    private static function canon(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            ksort($value, SORT_STRING);
        }
        return array_map(self::canon(...), $value);
    }

    private static function assertSameJson(mixed $expected, mixed $actual, string $label = ''): void
    {
        self::assertSame(self::canon($expected), self::canon($actual), $label);
    }

    /** The reason a capability does not apply to PHP, or null. */
    private static function notApplicable(string $id): ?string
    {
        foreach (self::fixtures('surface')['capabilities'] as $capability) {
            if ($capability['id'] === $id) {
                return $capability['notApplicable']['php'] ?? null;
            }
        }
        self::fail("Unknown capability $id");
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

    private static function captured(RequestInterface $request): array
    {
        $query = [];
        foreach (explode('&', $request->getUri()->getQuery()) as $pair) {
            if ($pair !== '') {
                [$key, $value] = explode('=', $pair, 2);
                $query[urldecode($key)] = urldecode($value);
            }
        }
        $body = (string) $request->getBody();
        $body = $request->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : ($body === '' ? null : $body);
        return ['method' => $request->getMethod(), 'path' => $request->getUri()->getPath(), 'query' => $query, 'body' => $body];
    }

    private static function expectedResult(array $fixture): mixed
    {
        return match (true) {
            str_ends_with($fixture['operation'], '.delete'), $fixture['operation'] === 'hashLists.removeEntry' => null,
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
        $client = new ServerClient('key', 'project-1', maxRetries: 0, httpClient: new Client(['handler' => $handler]));
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

    // errors.json: each API error code through the real client.

    public static function errors(): iterable
    {
        foreach (self::fixtures('errors') as $entry) {
            yield $entry['code'] => [$entry];
        }
    }

    /** The error fields every runner compares, null where there is none. */
    private static function errorFields(\Throwable $error): array
    {
        self::assertInstanceOf(CalmLensException::class, $error, $error->getMessage());
        $retryAfter = $error->retryAfter();
        return ['code' => $error->errorCode, 'status' => $error->status, 'requestId' => $error->requestId,
            'retryAfter' => $retryAfter !== null && floor($retryAfter) === $retryAfter ? (int) $retryAfter : $retryAfter,
            'details' => $error->details === [] ? null : $error->details];
    }

    #[DataProvider('errors')]
    public function testSharedApiErrorBecomesATypedError(array $entry): void
    {
        $response = $entry['response'];
        $client = new ServerClient('key', 'project-1', maxRetries: 0, httpClient: new Client(['handler' => fn () => Create::promiseFor(
            new Response($response['status'], $response['headers'], json_encode($response['body'])))]));
        try {
            self::invoke($client, $entry['operation'], $entry['args']);
            self::fail($entry['operation'] . ' succeeded');
        } catch (CalmLensException $error) {
            self::assertSameJson($entry['expected'], self::errorFields($error));
            $class = [400 => Exception\BadRequestException::class, 401 => Exception\AuthenticationException::class,
                403 => Exception\PermissionDeniedException::class, 404 => Exception\NotFoundException::class,
                409 => Exception\ConflictException::class, 429 => Exception\RateLimitException::class][$entry['status']]
                ?? ($entry['status'] >= 500 ? Exception\ServerException::class : Exception\ApiException::class);
            self::assertInstanceOf($class, $error);
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

    // client-cases.json: the real client against scripted responses.

    public static function clientCases(): iterable
    {
        foreach (self::fixtures('client-cases')['cases'] as $case) {
            yield $case['area'] . ': ' . $case['name'] => [$case];
        }
    }

    /** Decodes the `$bytes`, `$stream` and `$fill` argument markers. */
    private static function decodeArgs(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (array_key_exists('$bytes', $value)) {
            return base64_decode($value['$bytes'], true);
        }
        if (array_key_exists('$stream', $value)) {
            return new NoSeekStream(Utils::streamFor(base64_decode($value['$stream'], true)));
        }
        if (array_key_exists('$fill', $value)) {
            return str_repeat(chr($value['$fill']['byte']), $value['$fill']['length']);
        }
        $decoded = array_map(self::decodeArgs(...), $value);
        // JavaScript's byte inputs are PHP's `bytes`, its streams `data`.
        foreach (['uint8Array', 'buffer'] as $key) {
            if (array_key_exists($key, $decoded)) {
                $decoded['bytes'] = $decoded[$key];
                unset($decoded[$key]);
            }
        }
        return $decoded;
    }

    /** Translates JavaScript option names: an idempotency key and timeouts are request options. */
    private static function phpArgs(string $operation, array $args): array
    {
        if (array_key_exists('idempotencyKey', $args)) {
            $args['requestOptions'] = ['idempotencyKey' => $args['idempotencyKey']];
            unset($args['idempotencyKey']);
        }
        if ($operation === 'assets.waitForDecision' && array_key_exists('timeoutMs', $args)) {
            $args['timeout'] = $args['timeoutMs'] / 1000;
            unset($args['timeoutMs']);
        }
        return $args;
    }

    /** Collects an iterator, attaching what it yielded to a failure. */
    private static function collect(iterable $items): array
    {
        $all = [];
        try {
            foreach ($items as $item) {
                $all[] = $item;
            }
        } catch (CalmLensException $error) {
            throw new PartialResult($all, $error);
        }
        return $all;
    }

    private static function runClientStep(ServerClient $client, string $operation, array $args): mixed
    {
        $args = self::phpArgs($operation, $args);
        return match ($operation) {
            'assets.iterate' => self::collect($client->assets->each($args)),
            'assets.iterateChildren' => self::collect($client->assets->eachChild($args)),
            'events.iterate' => self::collect($client->events->eachPage($args)),
            default => self::invoke($client, $operation, $args),
        };
    }

    private static function clientOptions(array $options): array
    {
        $named = ['apiKey' => $options['apiKey'], 'projectId' => $options['projectId']];
        foreach (['baseUrl', 'cdnBaseUrl', 'maxRetries', 'maxResponseBytes'] as $key) {
            if (array_key_exists($key, $options)) {
                $named[$key] = $options[$key];
            }
        }
        if (array_key_exists('timeoutMs', $options)) {
            $named['timeout'] = $options['timeoutMs'] / 1000;
        }
        return $named;
    }

    /** Checks one header against its expectation; `$uuid` labels map one-to-one to values. */
    private static function checkHeader(string $label, string $name, ?string $actual, mixed $expected, array &$uuids): void
    {
        if (is_array($expected) && array_key_exists('$absent', $expected)) {
            self::assertNull($actual, "$label: $name is absent");
        } elseif (is_array($expected) && array_key_exists('$regex', $expected)) {
            self::assertMatchesRegularExpression('~' . str_replace('~', '\~', $expected['$regex']) . '~', (string) $actual, "$label: $name");
        } elseif (is_array($expected) && array_key_exists('$uuid', $expected)) {
            self::assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iD', (string) $actual, "$label: $name is a UUID");
            $known = $uuids[$expected['$uuid']] ?? null;
            if ($known === null) {
                self::assertNotContains($actual, $uuids, "$label: $name is a new value");
                $uuids[$expected['$uuid']] = $actual;
            } else {
                self::assertSame($known, $actual, "$label: $name reuses {$expected['$uuid']}");
            }
        } else {
            self::assertSame($expected, $actual, "$label: $name");
        }
    }

    /** Decoded query pairs, sorted: the order is free. */
    private static function queryPairs(string $query): array
    {
        $pairs = [];
        foreach (explode('&', $query) as $pair) {
            if ($pair !== '') {
                [$key, $value] = explode('=', $pair, 2) + [1 => ''];
                $pairs[] = [urldecode($key), urldecode($value)];
            }
        }
        usort($pairs, fn ($a, $b) => strcmp($a[0] . "\0" . $a[1], $b[0] . "\0" . $b[1]));
        return $pairs;
    }

    #[DataProvider('clientCases')]
    public function testScriptedClientCase(array $case): void
    {
        if (isset($case['requires']) && ($reason = self::notApplicable($case['requires'])) !== null) {
            self::markTestSkipped("not applicable: $reason");
        }
        $received = [];
        $handler = function (RequestInterface $request, array $options) use ($case, &$received) {
            $received[] = [$request, (string) $request->getBody()];
            $scripted = $case['responses'][count($received) - 1] ?? null;
            if ($scripted === null) {
                throw new \LogicException('request ' . count($received) . ' has no scripted response');
            }
            if (!empty($scripted['hang'])) {
                // No response until the attempt's deadline.
                $timeout = (float) ($options['timeout'] ?? 0);
                if ($timeout <= 0) {
                    throw new \LogicException('a hanging request needs a deadline');
                }
                usleep((int) ($timeout * 1_000_000));
                return Create::rejectionFor(new ConnectException('Operation timed out', $request, null, ['errno' => 28]));
            }
            if (!empty($scripted['transportError'])) {
                return Create::rejectionFor(new ConnectException('Connection reset by peer', $request, null, ['errno' => 56]));
            }
            $status = $scripted['status'] ?? 200;
            $body = match (true) {
                array_key_exists('body', $scripted) => json_encode($scripted['body'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                array_key_exists('bodyBase64', $scripted) => base64_decode($scripted['bodyBase64'], true),
                default => $scripted['bodyText'] ?? '',
            };
            return Create::promiseFor(new Response($status, $scripted['headers'] ?? [], $status === 204 ? '' : $body));
        };
        $sleeps = [];
        $client = null;
        $constructionError = null;
        try {
            $options = self::clientOptions(($case['client'] ?? []) + self::fixtures('client-cases')['client']);
            $client = new ServerClient(...$options, httpClient: new Client(['handler' => $handler]));
            // Waits are recorded rather than slept, on a virtual clock.
            $session = (fn (): Session => $this->session)->call($client);
            $elapsed = 0.0;
            $session->sleep = function (float $seconds) use (&$sleeps, &$elapsed): void { $sleeps[] = $seconds * 1000; $elapsed += $seconds; };
            $session->clock = function () use (&$elapsed): float { return $elapsed; };
        } catch (CalmLensException $error) {
            $constructionError = $error;
        }
        foreach ($case['steps'] as $index => $step) {
            $label = 'step ' . ($index + 1) . " ({$step['operation']})";
            $expected = $step['expect'] ?? [];
            $result = null;
            $error = $constructionError;
            if ($error === null) {
                try {
                    $result = self::runClientStep($client, $step['operation'], self::decodeArgs($step['args'] ?? []));
                } catch (CalmLensException|PartialResult $caught) {
                    $error = $caught;
                }
            }
            if (isset($expected['error'])) {
                self::assertNotNull($error, "$label: expected {$expected['error']['code']}");
                $partial = $error instanceof PartialResult ? $error->items : null;
                $actual = self::errorFields($error instanceof PartialResult ? $error->error : $error);
                $want = $expected['error'];
                if (is_array($want['retryAfter']) && isset($want['retryAfter']['$gte'])) {
                    self::assertGreaterThanOrEqual($want['retryAfter']['$gte'], $actual['retryAfter'], "$label: retryAfter");
                    $want['retryAfter'] = $actual['retryAfter'];
                }
                self::assertSameJson($want, $actual, $label);
                if (isset($expected['partialResult'])) {
                    self::assertSameJson($expected['partialResult'], $partial, "$label: yielded");
                }
                break;
            }
            if ($error !== null) {
                throw $error instanceof PartialResult ? $error->error : $error;
            }
            if (isset($expected['cdn'])) {
                self::assertInstanceOf(ResponseInterface::class, $result);
                $headers = [];
                foreach (array_keys($expected['cdn']['headers']) as $name) {
                    $headers[$name] = $result->hasHeader($name) ? $result->getHeaderLine($name) : null;
                }
                self::assertSame($expected['cdn'], ['status' => $result->getStatusCode(), 'headers' => $headers,
                    'bodyBase64' => base64_encode((string) $result->getBody())], $label);
            } else {
                self::assertSameJson($expected['result'] ?? null, $result, $label);
            }
        }

        self::assertCount(count($case['requests']), $received, 'requests sent');
        $uuids = [];
        foreach ($case['requests'] as $index => $want) {
            [$request, $body] = $received[$index];
            $label = 'request ' . ($index + 1);
            $uri = $request->getUri();
            self::assertSame([$want['method'], $want['origin'], $want['path']],
                [$request->getMethod(), $uri->getScheme() . '://' . $uri->getAuthority(), $uri->getPath()], $label);
            $wantPairs = $want['query'];
            usort($wantPairs, fn ($a, $b) => strcmp($a[0] . "\0" . $a[1], $b[0] . "\0" . $b[1]));
            self::assertSame($wantPairs, self::queryPairs($uri->getQuery()), "$label: query");
            self::assertSame($wantPairs, self::queryPairs($want['rawQuery']), "$label: rawQuery");
            foreach ($want['headers'] + self::fixtures('client-cases')['everyRequest']['headers'] as $name => $value) {
                self::checkHeader($label, $name, $request->hasHeader($name) ? $request->getHeaderLine($name) : null, $value, $uuids);
            }
            if (array_key_exists('body', $want)) {
                if ($want['body'] === null) {
                    self::assertSame('', $body, "$label: no body");
                } else {
                    self::assertSameJson($want['body'], json_decode($body, true), "$label: body");
                }
            } else {
                $raw = ['bodyLength' => strlen($body), 'bodySha256' => hash('sha256', $body)];
                if (isset($want['bodyBase64'])) {
                    $raw['bodyBase64'] = base64_encode($body);
                }
                self::assertSame(array_intersect_key($want, $raw), $raw, "$label: raw body");
            }
        }
        $wantSleeps = $case['sleepsMs'] ?? [];
        self::assertCount(count($wantSleeps), $sleeps, 'waits');
        foreach ($wantSleeps as $index => $sleep) {
            if (is_array($sleep)) {
                self::assertGreaterThanOrEqual($sleep[0], $sleeps[$index], "wait $index");
                self::assertLessThanOrEqual($sleep[1], $sleeps[$index], "wait $index");
            } else {
                self::assertEqualsWithDelta($sleep, $sleeps[$index], 0.001, "wait $index");
            }
        }
    }

    // webhooks.json

    public static function webhooks(): iterable
    {
        foreach (self::fixtures('webhooks') as $kind => $entries) {
            foreach ($entries as $i => $entry) {
                yield "$kind $i" . (isset($entry['name']) ? ': ' . $entry['name'] : '') => [$kind, $entry];
            }
        }
    }

    /** Every header container receivers pass: plain arrays, PSR-7 header lists and `$_SERVER`. */
    private static function headerContainers(array $headers): array
    {
        $server = [];
        foreach ($headers as $name => $value) {
            $server['HTTP_' . strtoupper(str_replace('-', '_', $name))] = is_array($value) ? implode(',', $value) : $value;
        }
        return ['array' => $headers, 'psr-7' => (new ServerRequest('POST', '/', $headers))->getHeaders(), '$_SERVER' => $server];
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
                self::assertSameJson(json_decode($entry['body'], true), $event);
                self::assertSame($entry['expectedType'], $event['type']);
                self::assertSame($entry['expectedFactKey'], $event['data']['facts'][0]['key']);
                return;
            case 'payloads':
                self::assertSameJson($entry['payload'], Webhooks::toPayload($entry['event']));
                $body = json_encode($entry['payload']);
                $event = Webhooks::parseEvent($body, Webhooks::signatureHeader($body, 1760000000, 'secret'), '1760000000', 'secret', now: 1760000000);
                self::assertSameJson($entry['payload'], $event);
                return;
            case 'headerCases':
                $headers = $entry['headers'];
                // A single-element list is also how PSR-7 presents one header value.
                foreach (self::headerContainers($headers) as $container => $values) {
                    if ($container === '$_SERVER' && array_filter($headers, 'is_array') !== []) {
                        continue; // PHP's server joins repeated headers itself; covered by the other containers.
                    }
                    self::assertSame($entry['valid'], Webhooks::verify($entry['body'], null, null, $entry['secret'], now: $entry['now'], headers: $values), $container);
                }
                return;
            case 'parseErrors':
                try {
                    Webhooks::parseEvent($entry['body'], $entry['signature'], $entry['timestamp'], $entry['secret'], now: $entry['now']);
                    self::fail('Expected ' . $entry['error']);
                } catch (Exception\WebhookVerificationException $error) {
                    self::assertSame($entry['error'], $error->errorCode);
                }
                return;
            case 'parsed':
                $event = Webhooks::parseEvent($entry['body'], $entry['signature'], $entry['timestamp'], $entry['secret'], now: $entry['now']);
                self::assertSameJson($entry['expected'], $event);
                self::assertSame($entry['isTest'], Webhooks::isTest($event));
                return;
            case 'testFacts':
                self::assertSame($entry['isTest'], Webhooks::isTest($entry['event']));
                return;
            case 'roundTrips':
                self::assertSameJson($entry['payload'], Webhooks::toPayload($entry['event']));
                $headers = Webhooks::createHeaders($entry['body'], $entry['deliveryId'], $entry['secret'], $entry['timestampSeconds']);
                self::assertSameJson($entry['headers'], $headers);
                $event = Webhooks::parseEvent($entry['body'], null, null, $entry['secret'], now: $entry['timestampSeconds'], headers: $headers);
                self::assertSameJson($entry['payload'], $event);
                self::assertSame($entry['isTest'], Webhooks::isTest($event));
                return;
        }
        self::fail('Unknown webhook fixture kind ' . $kind);
    }

    // upload-tokens.json

    public static function uploadTokens(): iterable
    {
        foreach (['signing', 'rejections', 'verification'] as $kind) {
            foreach (self::fixtures('upload-tokens')[$kind] as $entry) {
                yield "$kind: {$entry['name']}" => [$kind, $entry];
            }
        }
    }

    #[DataProvider('uploadTokens')]
    public function testSharedUploadTokenContract(string $kind, array $entry): void
    {
        $fixture = self::fixtures('upload-tokens');
        switch ($kind) {
            case 'signing':
                self::assertSame(['token' => $entry['expected']['token'], 'expiresAt' => $entry['expected']['expiresAt']],
                    MockServerClient::signUploadToken($entry['apiKey'], $entry['options'], $entry['now'], $entry['nonce']));
                // The real client signs the same claims with a fresh nonce and the real clock.
                $before = (int) floor(microtime(true) * 1000);
                $client = new ServerClient($entry['apiKey'], 'project-1');
                $signed = $client->uploadTokens->sign($entry['options']);
                $after = (int) floor(microtime(true) * 1000);
                self::assertStringStartsWith($fixture['prefix'], $signed['token']);
                [$body, $signature] = explode('.', substr($signed['token'], strlen($fixture['prefix'])), 2);
                self::assertSame(hash_hmac('sha256', $fixture['signingContext'] . $body, $entry['expected']['signingSecret']), $signature);
                $claims = json_decode(base64_decode(strtr($body, '-_', '+/'), true), true);
                $lifetime = ($entry['options']['expiresInSeconds'] ?? $fixture['defaultExpiresInSeconds']) * 1000;
                self::assertSame(array_diff_key($entry['expected']['claims'], ['n' => 0, 'e' => 0]), array_diff_key($claims, ['n' => 0, 'e' => 0]));
                self::assertNotSame($entry['nonce'], $claims['n']);
                self::assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $claims['n']);
                self::assertGreaterThanOrEqual($before + $lifetime, $claims['e']);
                self::assertLessThanOrEqual($after + $lifetime, $claims['e']);
                self::assertSame($claims['e'], $signed['expiresAt']);
                return;
            case 'rejections':
                foreach ([fn () => (new ServerClient($entry['apiKey'], 'project-1'))->uploadTokens->sign($entry['options']),
                    fn () => MockServerClient::signUploadToken($entry['apiKey'], $entry['options'], 1700000000000, '00000000-0000-4000-8000-000000000001')] as $sign) {
                    try {
                        $sign();
                        self::fail('Expected ' . $entry['error']);
                    } catch (CalmLensException $error) {
                        self::assertSame($entry['error'], $error->errorCode);
                    }
                }
                return;
            case 'verification':
                self::markTestSkipped('not applicable: the PHP SDK signs upload tokens but never decodes or verifies them; these cases document the server\'s check');
        }
    }

    public function testUploadTokenDefaultsMatchTheFixture(): void
    {
        $fixture = self::fixtures('upload-tokens');
        self::assertSame([$fixture['prefix'], $fixture['signingContext'], $fixture['defaultExpiresInSeconds'], $fixture['maxExpiresInSeconds']],
            [UploadTokens::PREFIX, UploadTokens::SIGNING_CONTEXT, UploadTokens::DEFAULT_EXPIRES_IN_SECONDS, UploadTokens::MAX_EXPIRES_IN_SECONDS]);
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

    // surface.json defaults: the client defaults every SDK follows.

    public static function defaults(): iterable
    {
        foreach (self::fixtures('surface')['defaults'] as $entry) {
            yield $entry['id'] => [$entry];
        }
    }

    #[DataProvider('defaults')]
    public function testClientDefault(array $entry): void
    {
        $session = (fn (): Session => $this->session)->call(new ServerClient('key', 'project-1'));
        $values = [
            'baseUrl' => $session->baseUrl,
            'cdnBaseUrl' => $session->cdnBaseUrl,
            'timeoutMs' => ServerClient::DEFAULT_TIMEOUT * 1000,
            'uploadTimeoutMs' => ServerClient::DEFAULT_UPLOAD_TIMEOUT,
            'maxRetries' => ServerClient::DEFAULT_MAX_RETRIES,
            'retryBaseDelayMs' => Session::RETRY_BASE_DELAY_MS,
            'retryMaxDelayMs' => Session::RETRY_MAX_DELAY_MS,
            'retryAfterMaxMs' => Session::RETRY_AFTER_MAX_MS,
            'maxResponseBytes' => ServerClient::DEFAULT_MAX_RESPONSE_BYTES,
            'signedUrlExpiresInSeconds' => Assets::DEFAULT_SIGNED_URL_SECONDS,
            'uploadTokenExpiresInSeconds' => UploadTokens::DEFAULT_EXPIRES_IN_SECONDS,
            'waitForDecisionTimeoutMs' => Assets::DEFAULT_DECISION_TIMEOUT * 1000,
            'waitForDecisionFirstIntervalMs' => Assets::DECISION_FIRST_INTERVAL * 1000,
            'waitForDecisionIntervalFactor' => Assets::DECISION_INTERVAL_FACTOR,
            'waitForDecisionMaxIntervalMs' => Assets::DECISION_MAX_INTERVAL * 1000,
            'ensureLensesBatchSize' => ServerClient::ENSURE_LENSES_BATCH_SIZE,
        ];
        self::assertArrayHasKey($entry['id'], $values, 'unknown default');
        self::assertEquals($entry['value'], $values[$entry['id']]);
        $names = array_column(self::fixtures('client-cases')['cases'], 'name');
        foreach ($entry['observedBy'] as $name) {
            self::assertContains($name, $names);
        }
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

    public static function transformOptionNames(): iterable
    {
        foreach (self::fixtures('transform-options')['options'] as $name) {
            yield $name => [$name];
        }
    }

    /** Every option the CDN accepts reaches the selector: a case sets it and the SDK writes it. */
    #[DataProvider('transformOptionNames')]
    public function testTransformOptionIsSerialized(string $name): void
    {
        $cases = array_values(array_filter(self::fixtures('transform-options')['cases'], fn ($case) => array_key_exists($name, $case['options'])));
        self::assertNotSame([], $cases, "no case sets $name");
        $url = self::offlineClient()->cdn->getAssetUrl(['assetIdentifier' => 'asset-1', 'transform' => ['type' => 'imageTransform', 'options' => $cases[0]['options']]]);
        self::assertMatchesRegularExpression('/(^|,)' . preg_quote($name, '/') . '[=.]/', explode('/rendered/', $url, 2)[1]);
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

    /** Resolves `$ref`, `$concat` and `$base64Repeat` values. */
    private static function resolve(mixed $value, array $saved): mixed
    {
        if (is_array($value) && array_key_exists('$ref', $value)) {
            [$name, $rest] = explode('.', $value['$ref'], 2) + [1 => null];
            return $rest === null ? $saved[$name] : self::at($saved[$name], $rest);
        }
        if (is_array($value) && array_key_exists('$concat', $value)) {
            return implode('', array_map(fn ($part) => (string) self::resolve($part, $saved), $value['$concat']));
        }
        if (is_array($value) && array_key_exists('$base64Repeat', $value)) {
            return base64_encode(str_repeat($value['$base64Repeat']['text'], $value['$base64Repeat']['count']));
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
            case 'mock.grant':
                $mock->setApiKeyGrants($args['grants']);
                return null;
            case 'mock.failNext':
                $mock->failNextRequest($args['failure'], $args['operation'] ?? null);
                return null;
            case 'cdn.serve':
                $response = $client->cdn->serve($args);
                $body = (string) $response->getBody();
                $json = str_starts_with($response->getHeaderLine('Content-Type'), 'application/json') ? json_decode($body, true) : null;
                return ['status' => $response->getStatusCode(), 'code' => $json['code'] ?? null, 'body' => $body, 'response' => $response];
            case 'assets.iterate':
                return self::collect($client->assets->each($args));
            case 'assets.iterateChildren':
                return self::collect($client->assets->eachChild($args));
            case 'events.pages':
                return self::collect($client->events->eachPage($args));
        }
        return self::invoke($client, $operation, self::phpArgs($operation, $args));
    }

    private static function checkCdn(array $want, array $result, string $label): void
    {
        $response = $result['response'];
        $actual = ['status' => $result['status']];
        foreach (['code', 'body'] as $key) {
            if (array_key_exists($key, $want)) {
                $actual[$key] = $result[$key];
            }
        }
        // Header names are case-insensitive.
        if (isset($want['headers'])) {
            $actual['headers'] = [];
            foreach (array_keys($want['headers']) as $name) {
                $actual['headers'][$name] = $response->hasHeader($name) ? $response->getHeaderLine($name) : null;
            }
        }
        self::assertSame(array_diff_key($want, ['headersPresent' => 0, 'bodyPrefixBase64' => 0]), $actual, $label);
        foreach ($want['headersPresent'] ?? [] as $name) {
            self::assertTrue($response->hasHeader($name), "$label: $name header");
        }
        if (isset($want['bodyPrefixBase64'])) {
            $prefix = base64_decode($want['bodyPrefixBase64'], true);
            self::assertSame(bin2hex($prefix), bin2hex(substr($result['body'], 0, strlen($prefix))), "$label: body prefix");
        }
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
        foreach ($scenario['steps'] as $index => $step) {
            for ($run = 1; $run <= ($step['repeat'] ?? 1); $run++) {
                $label = 'step ' . ($index + 1) . (isset($step['repeat']) ? " run $run" : '') . ' ' . $step['operation'] . ' ' . json_encode($step['args'] ?? []);
                $args = self::resolve($step['args'] ?? [], $saved);
                $expect = $step['expect'] ?? [];
                if (isset($expect['error'])) {
                    try {
                        self::runStep($mock, $step['operation'], $args);
                        self::fail("$label: expected {$expect['error']['code']}");
                    } catch (CalmLensException|PartialResult $error) {
                        $error = $error instanceof PartialResult ? $error->error : $error;
                        self::assertSame(['code' => $expect['error']['code'], 'status' => $expect['error']['status']],
                            ['code' => $error->errorCode, 'status' => $error->status], $label);
                        // `details` lists only the keys to compare.
                        foreach ($expect['error']['details'] ?? [] as $key => $value) {
                            self::assertSameJson(self::resolve($value, $saved), $error->details[$key] ?? null, "$label: details.$key");
                        }
                    }
                    continue;
                }
                // The mock keeps the status of its last response, to check the step's final one.
                (fn () => $this->lastStatus = null)->call($mock);
                $result = self::runStep($mock, $step['operation'], $args);
                if (isset($expect['httpStatus'])) {
                    self::assertSame($expect['httpStatus'], (fn (): ?int => $this->lastStatus)->call($mock), "$label: final response status");
                }
                if (isset($expect['cdn'])) {
                    self::checkCdn(self::resolve($expect['cdn'], $saved), $result, $label);
                }
                if (isset($expect['sameAs'])) {
                    self::assertArrayHasKey($expect['sameAs'], $saved, "$label: nothing saved as {$expect['sameAs']}");
                    self::assertSameJson($saved[$expect['sameAs']], $result, "$label: same as {$expect['sameAs']}");
                }
                foreach ($expect['result'] ?? [] as $path => $raw) {
                    if (is_array($raw) && array_key_exists('$contains', $raw)) {
                        $wanted = self::canon(self::resolve($raw['$contains'], $saved));
                        self::assertContains($wanted, array_map(self::canon(...), (array) self::at($result, $path)), "$label: $path");
                    } else {
                        self::assertSameJson(self::resolve($raw, $saved), self::at($result, $path), "$label: $path");
                    }
                }
                if (isset($step['save'])) {
                    $saved[$step['save']] = $result;
                }
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
        if (($reason = $capability['notApplicable']['php'] ?? null) !== null) {
            self::markTestSkipped("not applicable: $reason");
        }
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

/** An iterator's failure together with what it yielded first. */
final class PartialResult extends \RuntimeException
{
    public function __construct(public readonly array $items, public readonly CalmLensException $error)
    {
        parent::__construct($error->getMessage(), 0, $error);
    }
}
