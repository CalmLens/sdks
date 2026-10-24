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

    public function testPaginationPreservesOpaqueCursorsAndFiltersForChildrenAndEvents(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['items' => [['id' => 'child-1']], 'hasMore' => true, 'nextCursor' => 'opaque+/=']);
        $mock->enqueueJson(['items' => [['id' => 'child-2']], 'hasMore' => false, 'nextCursor' => null]);
        $client = $mock->client();
        self::assertSame([['id' => 'child-1'], ['id' => 'child-2']], iterator_to_array($client->assets->eachChild(['assetId' => 'parent', 'filter' => 'name=in=(one,two)']), false));
        self::assertSame('/v1/assets/parent/children', $mock->requests()[1]->getUri()->getPath());
        self::assertSame('filter=name%3Din%3D%28one%2Ctwo%29&cursor=opaque%2B%2F%3D', $mock->requests()[1]->getUri()->getQuery());
        $mock->enqueueJson(['events' => [['id' => 'event-1']], 'hasMore' => true, 'cursor' => 'next+/=']);
        $mock->enqueueJson(['events' => [['id' => 'event-2']], 'hasMore' => false, 'cursor' => 'end']);
        self::assertSame([['id' => 'event-1'], ['id' => 'event-2']], iterator_to_array($client->events->each(['after' => 'start']), false));
        self::assertSame('after=next%2B%2F%3D', $mock->requests()[3]->getUri()->getQuery());
    }

    public static function invalidUploads(): iterable
    {
        yield [['name' => 'x', 'content' => ['type' => 'text/plain', 'data' => 'a', 'base64' => 'YQ==']], 'upload/invalid-payload'];
        yield [['name' => 'x', 'content' => ['type' => 'application/octet-stream', 'data' => 'a']], 'upload/invalid-mime-type'];
        yield [['name' => 'x', 'content' => ['type' => 'text/plain', 'data' => 'a', 'sizeInBytes' => 2]], 'upload/invalid-payload'];
        yield [['name' => 'x', 'content' => ['type' => 'text/plain', 'base64' => '!!!']], 'upload/invalid-payload'];
        yield [['name' => 'x', 'part' => ['type' => 'text/plain', 'data' => 'a']], 'upload/invalid-payload'];
        yield [['name' => 'x', 'part' => ['type' => 'image/png', 'data' => 'a', 'isFinal' => true]], 'upload/multipart-image-too-small'];
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
        self::assertSame('test-key', $mock->requests()[0]->getHeaderLine('X-Api-Key'));
        self::assertSame('bytes=1-3', $mock->requests()[0]->getHeaderLine('Range'));
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
        self::assertSame('DELETE', $mock->requests()[0]->getMethod());
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
        self::assertSame('original', (string) $mock->requests()[0]->getBody());
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
        self::assertInstanceOf(Exception\InvalidArgumentException::class, $this->error('upload/invalid-payload', fn () => $client->text->classify(['text' => ' '])));
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
        $mock = new MockServerClient(now: fn () => 1760000000000, createId: fn () => 'id-1');
        $event = $mock->enqueueEvent(['type' => 'asset.allowed', 'facts' => [['key' => 'test', 'value' => true]]]);
        $body = json_encode(Webhooks::toPayload($event));
        $headers = Webhooks::createHeaders($body, 'delivery-1', 'secret', 1760000000);
        self::assertSame(['delivery-1', '1760000000'], [$headers[Webhooks::DELIVERY_HEADER], $headers[Webhooks::TIMESTAMP_HEADER]]);
        $parsed = Webhooks::parseEvent($body, null, null, 'secret', now: 1760000000, headers: $headers);
        self::assertSame(['id-1', 'asset.allowed', 'project-1', 'low', 'asset.allowed', null, true],
            [$parsed['id'], $parsed['type'], $parsed['projectId'], $parsed['data']['severity'], $parsed['data']['title'], $parsed['data']['assetId'], Webhooks::isTest($parsed)]);
        $server = ['HTTP_X_CALMLENS_SIGNATURE' => $headers[Webhooks::SIGNATURE_HEADER], 'HTTP_X_CALMLENS_TIMESTAMP' => '1760000000'];
        self::assertTrue(Webhooks::verify($body, null, null, 'secret', now: 1760000000, headers: $server));
        $psr = ['X-CalmLens-Signature' => [$headers[Webhooks::SIGNATURE_HEADER]], 'X-CalmLens-Timestamp' => ['1760000000']];
        self::assertTrue(Webhooks::verify($body, null, null, 'secret', now: 1760000000, headers: $psr));
        self::assertFalse(Webhooks::verify($body, null, null, 'secret', now: 1760000000 + Webhooks::SIGNATURE_TOLERANCE_SECONDS + 1, headers: $psr));
        $rejected = $this->error('sdk/invalid-webhook-signature', fn () => Webhooks::parseEvent($body . ' ', null, null, 'secret', now: 1760000000, headers: $headers));
        self::assertInstanceOf(Exception\WebhookVerificationException::class, $rejected);
    }
}
