<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\ServerClient;
use CalmLens\Webhooks;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ContractTest extends TestCase
{
    private static function fixtures(string $name): array
    {
        // Reuse the generated native contract in place: no PHP copy that can drift.
        return json_decode(file_get_contents(__DIR__ . '/../../ruby/testdata/' . $name . '.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    private static function invoke(ServerClient $client, string $operation, array $options): mixed
    {
        $parts = explode('.', $operation);
        return count($parts) === 1 ? $client->{$parts[0]}($options) : $client->{$parts[0]}->{$parts[1]}($options);
    }

    public static function requests(): iterable
    {
        foreach (self::fixtures('requests') as $i => $fixture) {
            yield $i . ': ' . $fixture['operation'] => [$fixture];
        }
    }

    #[DataProvider('requests')]
    public function testSharedRequestContract(array $fixture): void
    {
        $calls = 0;
        $handler = function ($request) use ($fixture, &$calls) {
            $calls++;
            $query = [];
            foreach (explode('&', $request->getUri()->getQuery()) as $pair) {
                if ($pair !== '') {
                    [$key, $value] = explode('=', $pair, 2);
                    $query[rawurldecode($key)] = rawurldecode($value);
                }
            }
            $body = $request->getBody()->getContents();
            $body = $request->getHeaderLine('Content-Type') === 'application/json' ? json_decode($body, true) : ($body === '' ? null : $body);
            self::assertSame('key', $request->getHeaderLine('X-Api-Key'));
            self::assertEquals($fixture['request'], ['method' => $request->getMethod(), 'path' => $request->getUri()->getPath(), 'query' => $query, 'body' => $body]);
            return Create::promiseFor(new Response(200, [], json_encode($fixture['response'])));
        };
        $client = new ServerClient('key', 'project-1', httpClient: new Client(['handler' => $handler]));
        $result = self::invoke($client, $fixture['operation'], $fixture['options']);
        $expected = str_ends_with($fixture['operation'], '.delete') ? null : $fixture['response'];
        if ($fixture['operation'] === 'ensureLenses') {
            $expected = $expected['lenses'];
        }
        self::assertSame($expected, $result);
        self::assertSame(1, $calls);
    }

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
        $client = new ServerClient('key', 'project-1', httpClient: new Client(['handler' => function () { self::fail('Unexpected network request'); }]));
        try {
            $value = self::invoke($client, $fixture['operation'], $fixture['options']);
            self::assertSame($fixture['url'], $value);
        } catch (CalmLensException $error) {
            self::assertSame($fixture['error'] ?? null, $error->errorCode);
        }
    }

    public function testSharedWebhookSignaturesAndVerification(): void
    {
        $fixtures = self::fixtures('webhooks');
        foreach ($fixtures['signatures'] as $entry) {
            self::assertSame($entry['signature'], Webhooks::signatureHeader($entry['body'], $entry['timestamp'], $entry['secret']));
        }
        foreach ($fixtures['verification'] as $entry) {
            self::assertSame($entry['valid'], Webhooks::verify($entry['body'], $entry['signature'], $entry['timestamp'], $entry['secret'], $entry['toleranceSeconds'] ?? 300, $entry['now']), $entry['name']);
        }
        foreach ($fixtures['parsing'] as $entry) {
            $event = Webhooks::parseEvent($entry['body'], $entry['signature'], $entry['timestamp'], $entry['secret'], now: $entry['now']);
            self::assertSame(json_decode($entry['body'], true), $event);
            self::assertSame($entry['expectedType'], $event['type']);
            self::assertSame($entry['expectedFactKey'], $event['data']['facts'][0]['key']);
        }
        foreach ($fixtures['payloads'] as $entry) {
            $body = json_encode($entry['payload']);
            $event = Webhooks::parseEvent($body, Webhooks::signatureHeader($body, 1760000000, 'secret'), '1760000000', 'secret', now: 1760000000);
            self::assertSame($entry['payload'], $event);
            self::assertSame($entry['event']['facts'], $event['data']['facts']);
        }
    }

    public function testSharedApiErrorsPreserveCodesAndStatuses(): void
    {
        foreach (self::fixtures('errors') as $entry) {
            $mock = new CalmLens\Testing\MockTransport();
            $mock->enqueueJson(['code' => $entry['code'], 'details' => ['reason' => 'test'], 'traceId' => 'trace-1'], $entry['status']);
            try {
                $mock->client()->assets->retrieve(['assetId' => 'asset']);
                self::fail('Expected API error');
            } catch (CalmLensException $error) {
                self::assertSame($entry['code'], $error->errorCode);
                self::assertSame($entry['status'], $error->status);
                self::assertSame(['reason' => 'test', 'network' => true, 'traceId' => 'trace-1'], $error->details);
            }
        }
    }

    /** Every transform option serializes to the step the CDN writes for it. */
    public function testTransformOptions(): void
    {
        foreach (self::fixtures('transform-options')['cases'] as $case) {
            $step = ['type' => 'imageTransform', 'options' => $case['options']];
            self::assertSame($case['selector'], \CalmLens\Internal\Transforms::selector($step), json_encode($case['options']));
        }
    }
}
