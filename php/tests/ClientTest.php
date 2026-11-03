<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\Exception;
use CalmLens\Testing\MockServerClient;
use CalmLens\ServerClient;
use CalmLens\Testing\MockTransport;
use CalmLens\Webhooks;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\NoSeekStream;
use GuzzleHttp\Psr7\PumpStream;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Utils;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ClientTest extends TestCase
{
    /** An upload's response: an asset with its statuses. */
    private const ASSET = ['id' => 'a', 'upload' => ['status' => 'completed'], 'classification' => ['status' => 'processing', 'moderation' => ['status' => 'pending']]];

    private function error(string $code, callable $call): CalmLensException
    {
        try {
            $call();
            self::fail('Expected error ' . $code);
        } catch (CalmLensException $error) {
            self::assertSame($code, $error->errorCode);
            return $error;
        }
    }

    public function testOversizedOneRequestUploadsAreRefusedBeforeSending(): void
    {
        $mock = new MockTransport();
        $client = $mock->client();
        $mib = 1024 * 1024;
        foreach (['image/png' => 10 * $mib + 1, 'video/mp4' => 50 * $mib + 1, 'application/pdf' => 5000 * $mib + 1] as $type => $size) {
            // A one-shot stream goes in one request; an image the client can read again goes in parts.
            $stream = new \GuzzleHttp\Psr7\NoSeekStream(Utils::streamFor(fopen('php://memory', 'r')));
            $this->error('upload/file-too-large', fn () => $client->assets->create(['name' => 'big', 'content' => ['type' => $type, 'data' => $stream, 'sizeInBytes' => $size]]));
        }
        self::assertSame([], $mock->requests());
        $mock->enqueueJson(self::ASSET);
        $client->assets->create(['name' => 'x.png', 'content' => ['type' => 'image/png', 'sizeInBytes' => 10 * $mib,
            'data' => new \GuzzleHttp\Psr7\NoSeekStream(Utils::streamFor(str_repeat('x', 10 * $mib)))]]);
        self::assertCount(1, $mock->requests());
    }

    public function testUnknownOptionsAreRefusedBeforeSending(): void
    {
        $mock = new MockTransport();
        $client = $mock->client();
        $calls = [
            'text.classify' => fn () => $client->text->classify(['text' => 'hi', 'extrenalId' => 'post-1']),
            'assets.create' => fn () => $client->assets->create(['name' => 'a.txt', 'content' => ['plainText' => 'a', 'type' => 'text/plain'], 'visiblity' => 'private']),
            'assets.retrieve' => fn () => $client->assets->retrieve(['assetId' => 'a', 'assetID' => 'b']),
            'assets.waitForDecision' => fn () => $client->assets->waitForDecision(['assetId' => 'a', 'timeoutSeconds' => 5]),
            'assets.listChildren' => fn () => iterator_to_array($client->assets->eachChild(['assetId' => 'a', 'filter' => 'name==a'])),
            'cdn.getAssetUrl' => fn () => $client->cdn->getAssetUrl(['assetIdentifier' => 'a', 'lenz' => 'thumbnail']),
            'uploadTokens.sign' => fn () => $client->uploadTokens->sign(['uploadPresetId' => 'preset_1', 'external' => 'x']),
            'ensureLenses' => fn () => $client->ensureLenses(['lens' => [['identifier' => 'thumbnail']]]),
        ];
        foreach ($calls as $operation => $call) {
            $error = $this->error('sdk/invalid-argument', $call);
            self::assertStringContainsString($operation, $error->getMessage());
        }
        self::assertSame([], $mock->requests());
    }

    public function testPaginationPreservesOpaqueCursorsAndOptionsForChildrenAndEvents(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['items' => [['id' => 'child-1']], 'hasMore' => true, 'nextCursor' => 'opaque+/=']);
        $mock->enqueueJson(['items' => [['id' => 'child-2']], 'hasMore' => false, 'nextCursor' => null]);
        $client = $mock->client();
        self::assertSame([['id' => 'child-1'], ['id' => 'child-2']], iterator_to_array($client->assets->eachChild(['assetId' => 'parent', 'pageSize' => 2]), false));
        self::assertSame('/assets/parent/children', $mock->requests()[1]->path);
        self::assertSame('pageSize=2&cursor=opaque%2B%2F%3D', $mock->requests()[1]->request->getUri()->getQuery());
        $mock->enqueueJson(['items' => [['id' => 'event-1']], 'hasMore' => true, 'nextCursor' => 'next+/=']);
        $mock->enqueueJson(['items' => [['id' => 'event-2']], 'hasMore' => false, 'nextCursor' => 'end']);
        self::assertSame([['id' => 'event-1'], ['id' => 'event-2']], iterator_to_array($client->events->each(['cursor' => 'start']), false));
        self::assertSame('cursor=next%2B%2F%3D', $mock->requests()[3]->request->getUri()->getQuery());
    }

    public static function invalidUploads(): iterable
    {
        yield [['name' => 'x', 'content' => ['type' => 'text/plain', 'data' => 'a', 'base64' => 'YQ==']], 'upload/invalid-payload'];
        yield [['name' => 'x', 'content' => ['type' => 'application/octet-stream', 'data' => 'a']], 'upload/invalid-mime-type'];
        yield [['name' => 'x', 'content' => ['type' => 'text/plain', 'data' => 'a', 'sizeInBytes' => 2]], 'upload/invalid-payload'];
        yield [['name' => 'x', 'content' => ['type' => 'text/plain', 'base64' => '!!!']], 'upload/invalid-payload'];
        yield [['name' => 'x', 'part' => ['type' => 'text/plain', 'data' => 'a']], 'upload/invalid-payload'];
        yield [['name' => 'x', 'part' => ['type' => 'image/png', 'data' => 'a', 'isFinal' => true], 'totalSizeInBytes' => 21 * 1024 * 1024], 'upload/multipart-image-too-large'];
        yield [['name' => 'x', 'part' => ['type' => 'text/plain', 'data' => 'a', 'partNumber' => 2, 'isFinal' => true]], 'upload/use-upload-part'];
    }

    #[DataProvider('invalidUploads')]
    public function testInvalidUploadsFailBeforeSending(array $options, string $code): void
    {
        $mock = new MockTransport();
        $this->error($code, fn () => $mock->client()->assets->create($options));
        self::assertSame([], $mock->requests());
    }

    public function testStreamingFromCurrentOffsetReplaysSameBytesAndIdempotencyKey(): void
    {
        $calls = [];
        $client = new ServerClient('key', 'p', httpClient: new Client(['handler' => function ($request, $options) use (&$calls) {
            $calls[] = [$request->getBody()->getContents(), $request->getHeaderLine('Idempotency-Key')];
            self::assertSame('7', $request->getHeaderLine('Content-Length'));
            self::assertFalse($options['allow_redirects']);
            return Create::promiseFor(count($calls) === 1 ? new Response(503, ['Retry-After' => '0'], '{"code":"server/unavailable"}') : new Response(200, [], json_encode(self::ASSET)));
        }]));
        $stream = Utils::streamFor('prefixpayload');
        $stream->seek(6);
        self::assertSame(self::ASSET, $client->assets->create(['name' => 'x', 'content' => ['type' => 'text/plain', 'data' => $stream]]));
        self::assertCount(2, $calls);
        self::assertSame('payload', $calls[0][0]);
        self::assertSame($calls[0], $calls[1]);
        self::assertMatchesRegularExpression('/^[a-f0-9-]{36}$/', $calls[0][1]);
    }

    public function testUnsizedStreamDetectsShortAndLongBodies(): void
    {
        foreach ([2, 4] as $size) {
            $client = new ServerClient('key', 'p', httpClient: new Client(['handler' => function ($request) {
                $request->getBody()->getContents();
                self::fail('Expected byte count mismatch');
            }]));
            $stream = new NoSeekStream(Utils::streamFor('abc'));
            $this->error('upload/invalid-payload', fn () => $client->assets->create(['name' => 'x', 'content' => ['type' => 'text/plain', 'data' => $stream, 'sizeInBytes' => $size]]));
        }
    }

    public function testLensCacheBatchesAndInvalidatesOldVersions(): void
    {
        $calls = [];
        $client = new ServerClient('key', 'p', httpClient: new Client(['handler' => function ($request) use (&$calls) {
            $body = json_decode((string) $request->getBody(), true);
            $calls[] = $body['lenses'];
            return Create::promiseFor(new Response(200, [], json_encode($body)));
        }]));
        $lenses = array_map(fn ($i) => ['identifier' => 'lens-' . $i, 'version' => 1, 'type' => 'image'], range(1, 101));
        self::assertSame($lenses, $client->ensureLenses(['lenses' => $lenses]));
        self::assertSame([100, 1], array_map('count', $calls));
        self::assertSame($lenses, $client->ensureLenses(['lenses' => $lenses]));
        self::assertCount(2, $calls);
        $client->ensureLens(['identifier' => 'lens-1', 'version' => 2, 'type' => 'image']);
        $client->ensureLens($lenses[0]);
        self::assertCount(4, $calls);
        self::assertSame(2, $calls[2][0]['version']);
        self::assertSame(1, $calls[3][0]['version']);
    }

    public function testCdnStreamsBytesAndProtectsAuthenticationHeader(): void
    {
        $mock = new MockTransport();
        $mock->enqueue(new Response(206, ['Content-Range' => 'bytes 1-3/4'], 'abc'));
        $response = $mock->client()->cdn->serve(['assetIdentifier' => 'a', 'init' => ['headers' => ['x-api-key' => 'attacker', 'Range' => 'bytes=1-3']]]);
        self::assertSame(206, $response->getStatusCode());
        self::assertSame('abc', $response->getBody()->getContents());
        self::assertSame('test-key', $mock->requests()[0]->request->getHeaderLine('X-Api-Key'));
        self::assertSame('bytes=1-3', $mock->requests()[0]->request->getHeaderLine('Range'));
    }

    public function testConfigurationAndDebugOutput(): void
    {
        $this->error('sdk/invalid-config', fn () => new ServerClient("key\n", 'p'));
        $this->error('sdk/invalid-config', fn () => new ServerClient('key', 'p', baseUrl: 'https://user:password@example.com'));
        $this->error('sdk/invalid-config', fn () => new ServerClient('key', 'p', maxRetries: -1));
        $client = new ServerClient('unique-secret-api-key', 'p');
        ob_start();
        var_dump($client, $client->assets, $client->uploadTokens, $client->text);
        $debug = ob_get_clean();
        self::assertStringNotContainsString('unique-secret-api-key', $debug);
    }
    public function testMalformedResponsesAndHeadersUseStableErrorCodes(): void
    {
        foreach (['not-json', 'null', '42', '"string"', ''] as $body) {
            $mock = new MockTransport();
            $mock->enqueue(new Response(200, [], $body));
            $this->error('sdk/invalid-response', fn () => $mock->client()->assets->retrieve(['assetId' => 'a']));
        }
        $mock = new MockTransport();
        $this->error('sdk/invalid-argument', fn () => $mock->client()->cdn->serve([
            'assetIdentifier' => 'a', 'init' => ['headers' => ['Range' => "bad\r\nheader"]],
        ]));
        self::assertSame([], $mock->requests());
        $mock->enqueue(new Response(204));
        self::assertNull($mock->client()->assets->delete(['assetId' => 'a']));
        $deleted = $mock->requests()[0];
        self::assertSame(['DELETE', '/assets/a', 204], [$deleted->method, $deleted->path, $deleted->status]);
    }

    public function testMockSnapshotsFreezeUploadBytesAndExhaustionFails(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(self::ASSET);
        $client = $mock->client();
        $stream = Utils::streamFor('original');
        $client->assets->create(['name' => 'x', 'content' => ['type' => 'text/plain', 'data' => $stream]]);
        $stream->rewind();
        $stream->write('replaced');
        self::assertSame('original', (string) $mock->requests()[0]->request->getBody());
        self::assertSame(0, $mock->pending());
        $this->expectException(\OutOfBoundsException::class);
        $client->assets->retrieve(['assetId' => 'a']);
    }

    public function testErrorsUseTypedClassesWithRequestIdRetryAfterAndHelpers(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['code' => 'asset/not-found', 'message' => 'Asset not found'], 404, ['X-Request-Id' => 'req-1'])
            ->enqueueJson(['code' => 'upload/limit-exceeded'], 429, ['Retry-After' => 'Wed, 21 Oct 2015 07:28:00 GMT'])
            ->enqueue(new Response(502, [], 'Bad gateway'));
        $client = $mock->client();
        $missing = $this->error('asset/not-found', fn () => $client->assets->retrieve(['assetId' => 'a']));
        self::assertInstanceOf(Exception\NotFoundException::class, $missing);
        self::assertSame(['req-1', true, null], [$missing->requestId, $missing->isNotFound(), $missing->retryAfter()]);
        $limited = $this->error('upload/limit-exceeded', fn () => $client->assets->retrieve(['assetId' => 'a']));
        self::assertInstanceOf(Exception\RateLimitException::class, $limited);
        self::assertSame(0.0, $limited->retryAfter());
        $gateway = $this->error('sdk/http-error', fn () => $client->assets->retrieve(['assetId' => 'a']));
        self::assertInstanceOf(Exception\ServerException::class, $gateway);
        self::assertInstanceOf(Exception\InvalidArgumentException::class, $this->error('sdk/invalid-argument', fn () => $client->assets->retrieve(['assetId' => ''])));
        self::assertInstanceOf(Exception\InvalidArgumentException::class, $this->error('sdk/invalid-argument', fn () => $client->text->classify(['text' => ' '])));
        self::assertInstanceOf(Exception\ConfigurationException::class, $this->error('sdk/invalid-config', fn () => new ServerClient('key', 'p', timeout: 0)));
    }

    public function testOversizedResponsesUseResponseTooLarge(): void
    {
        $mock = new MockTransport();
        $mock->enqueue(new Response(200, [], str_repeat(' ', 32 * 1024 * 1024 + 1)));
        $error = $this->error('sdk/response-too-large', fn () => $mock->client()->assets->retrieve(['assetId' => 'a']));
        self::assertInstanceOf(Exception\InvalidResponseException::class, $error);
    }

    public function testWebhookHelpersSignDeliveriesForStoredEventsAndReadHeaders(): void
    {
        $mock = new MockServerClient(now: fn () => 1760000000000, createId: fn (string $prefix) => $prefix . '_00000000000000000001');
        $event = $mock->enqueueEvent(['type' => 'asset.allowed', 'facts' => [['key' => 'test', 'value' => true]]]);
        $body = json_encode(Webhooks::toPayload($event));
        $headers = Webhooks::createHeaders($body, 'delivery-1', 'secret', 1760000000);
        self::assertSame(['delivery-1', '1760000000'], [$headers[Webhooks::DELIVERY_HEADER], $headers[Webhooks::TIMESTAMP_HEADER]]);
        $parsed = Webhooks::parseEvent($body, null, null, 'secret', now: 1760000000, headers: $headers);
        self::assertSame(['evt_00000000000000000001', 'asset.allowed', 'project-1', 'low', 'asset.allowed', null, true],
            [$parsed['id'], $parsed['type'], $parsed['projectId'], $parsed['severity'], $parsed['title'], $parsed['assetId'], Webhooks::isTest($parsed)]);
        $server = ['HTTP_X_CALMLENS_SIGNATURE' => $headers[Webhooks::SIGNATURE_HEADER], 'HTTP_X_CALMLENS_TIMESTAMP' => '1760000000'];
        self::assertTrue(Webhooks::verify($body, null, null, 'secret', now: 1760000000, headers: $server));
        $psr = ['X-CalmLens-Signature' => [$headers[Webhooks::SIGNATURE_HEADER]], 'X-CalmLens-Timestamp' => ['1760000000']];
        self::assertTrue(Webhooks::verify($body, null, null, 'secret', now: 1760000000, headers: $psr));
        self::assertFalse(Webhooks::verify($body, null, null, 'secret', now: 1760000000 + Webhooks::SIGNATURE_TOLERANCE_SECONDS + 1, headers: $psr));
        $rejected = $this->error('sdk/invalid-webhook-signature', fn () => Webhooks::parseEvent($body . ' ', null, null, 'secret', now: 1760000000, headers: $headers));
        self::assertInstanceOf(Exception\WebhookVerificationException::class, $rejected);
    }
}
