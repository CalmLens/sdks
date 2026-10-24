<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\ServerClient;
use CalmLens\Testing\MockServerClient;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Replays surface.json and rejections.json (packages/sdk-contract/surface.ts): every capability a
 * server SDK must offer exists under its PHP name, and every request the API would reject is
 * refused before anything is sent.
 */
final class SurfaceTest extends TestCase
{
    private static function fixtures(string $name): array
    {
        return json_decode(file_get_contents(__DIR__ . '/../../ruby/testdata/' . $name . '.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    private static function client(?callable $handler = null): ServerClient
    {
        $handler ??= function () { self::fail('Unexpected network request'); };
        return new ServerClient('key', 'project-1', maxRetries: 0, httpClient: new Client(['handler' => $handler]));
    }

    private static function call(ServerClient $client, string $operation, array $options): mixed
    {
        [$resource, $method] = explode('.', $operation);
        return $client->{$resource}->{$method}($options);
    }

    private static function raisedError(array $spec): CalmLensException
    {
        $client = self::client(fn () => Create::promiseFor(new Response($spec['status'], $spec['headers'], json_encode($spec['body']))));
        try {
            self::call($client, $spec['operation'], $spec['options']);
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

    private static function present(array $capability, array $surface): bool
    {
        $name = $capability['names']['php'];
        switch ($capability['kind']) {
            case 'method':
                $parts = explode('->', $name);
                $method = array_pop($parts);
                $target = self::client();
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
                $spec = $surface['errorResponse'];
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
                $url = self::client()->cdn->getAssetUrl(['assetIdentifier' => 'asset-1', 'resource' => $name]);
                return str_ends_with($url, '/asset-1/' . $capability['value']);
            case 'cdn-option':
                $url = self::client()->cdn->getAssetUrl(['assetIdentifier' => 'asset-1', $name => true]);
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

    public function testOffersEveryCapability(): void
    {
        $surface = self::fixtures('surface');
        $missing = [];
        foreach ($surface['capabilities'] as $capability) {
            if (!self::present($capability, $surface)) {
                $missing[] = $capability['id'] . ' (' . $capability['names']['php'] . ')';
            }
        }
        self::assertSame([], $missing);
    }

    public static function rejections(): iterable
    {
        foreach (self::fixtures('rejections') as $fixture) {
            yield $fixture['name'] => [$fixture];
        }
    }

    #[DataProvider('rejections')]
    public function testRefusesRejectedRequestsBeforeSending(array $fixture): void
    {
        try {
            self::call(self::client(), $fixture['operation'], $fixture['options']);
            self::fail('Expected ' . $fixture['error']);
        } catch (CalmLensException $error) {
            self::assertSame($fixture['error'], $error->errorCode);
        }
    }
}
