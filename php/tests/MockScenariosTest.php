<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\Testing\MockServerClient;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Replays the shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts) against
 * MockServerClient. The format is described in packages/sdk-contract/README.md.
 */
final class MockScenariosTest extends TestCase
{
    public static function scenarios(): iterable
    {
        $file = json_decode(file_get_contents(__DIR__ . '/../../ruby/testdata/mock-scenarios.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($file['scenarios'] as $scenario) {
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
                return ['status' => $response->getStatusCode(), 'code' => $json['code'] ?? null, 'body' => $body];
            case 'assets.waitForDecision':
                $args['timeout'] = $args['timeoutMs'] / 1000;
                unset($args['timeoutMs']);
                return $client->assets->waitForDecision($args);
        }
        if (array_key_exists('idempotencyKey', $args)) {
            $args['requestOptions'] = ['idempotencyKey' => $args['idempotencyKey']];
            unset($args['idempotencyKey']);
        }
        [$resource, $method] = explode('.', $operation);
        return $client->{$resource}->{$method}($args);
    }

    #[DataProvider('scenarios')]
    public function testScenario(array $scenario): void
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
                self::assertSame($expect['cdn'], $actual, $label);
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
}
