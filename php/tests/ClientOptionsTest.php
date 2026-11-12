<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\Exception;
use CalmLens\Model\Folder;
use CalmLens\ServerClient;
use CalmLens\Testing\MockHttpClient;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;
use Psr\Log\AbstractLogger;

/**
 * Client setup and the cross-cutting request features: environment defaults, `appInfo`, request
 * options, the raw `request()`, `getLastResponse()`, attempt events, logging and error bodies.
 */
final class ClientOptionsTest extends TestCase
{
    private const FOLDER = ['id' => 'folder-1', 'projectId' => 'project-1', 'name' => 'A', 'createdAt' => 1];

    /** @var list<RequestInterface> */
    private array $sent = [];

    protected function tearDown(): void
    {
        foreach (['CALMLENS_API_KEY', 'CALMLENS_PROJECT_ID', 'CALMLENS_BASE_URL'] as $name) {
            putenv($name);
        }
    }

    /** A client whose requests are answered in turn by `$responses` and recorded in `$this->sent`. */
    private function client(array $responses, array $options = []): ServerClient
    {
        $http = new MockHttpClient(function (RequestInterface $request) use (&$responses): Response {
            $this->sent[] = $request;
            return array_shift($responses) ?? self::fail('Unexpected request');
        });
        $client = new ServerClient(...($options + ['apiKey' => 'key', 'projectId' => 'project-1', 'httpClient' => $http]));
        (fn () => $this->session->sleep = static function (float $seconds): void {})->call($client);
        return $client;
    }

    private static function json(array $body, int $status = 200, array $headers = []): Response
    {
        return new Response($status, $headers + ['Content-Type' => 'application/json'], json_encode($body));
    }

    private static function code(callable $call): string
    {
        try {
            $call();
        } catch (CalmLensException $error) {
            return $error->errorCode;
        }
        self::fail('Expected an exception');
    }

    public function testTheEnvironmentSuppliesTheKeyProjectAndBaseUrl(): void
    {
        putenv('CALMLENS_API_KEY=env-key');
        putenv('CALMLENS_PROJECT_ID=env-project');
        putenv('CALMLENS_BASE_URL=https://api.example.test/v1');
        $client = $this->client([self::json(['items' => [], 'nextCursor' => null, 'hasMore' => false, 'ancestors' => []])],
            ['apiKey' => null, 'projectId' => null]);
        $client->folders->list();
        self::assertSame('env-project', $client->projectId);
        self::assertSame('https://api.example.test/v1/projects/env-project/folders', (string) $this->sent[0]->getUri());
        self::assertSame('env-key', $this->sent[0]->getHeaderLine('X-Api-Key'));
    }

    public function testAMissingKeyOrProjectIsAConfigurationError(): void
    {
        $error = null;
        try {
            new ServerClient(projectId: 'project-1', httpClient: new MockHttpClient(fn () => self::fail('sent')));
        } catch (Exception\ConfigurationException $error) {
        }
        self::assertSame('sdk/invalid-config', $error?->errorCode);
    }

    public function testAppInfoIsAppendedToTheUserAgent(): void
    {
        $client = $this->client([self::json(self::FOLDER)], ['appInfo' => ['name' => 'board', 'version' => '2.1', 'url' => 'https://board.example']]);
        $client->folders->retrieve(['folderId' => 'folder-1']);
        self::assertStringEndsWith(' board/2.1 (https://board.example)', $this->sent[0]->getHeaderLine('User-Agent'));
        self::assertStringStartsWith('calmlens-php/', $this->sent[0]->getHeaderLine('User-Agent'));
        self::assertSame('sdk/invalid-config', self::code(fn () => $this->client([], ['appInfo' => ['name' => 'two words']])));
    }

    public function testRequestOptionsAddHeadersQueryAndBodyFieldsButNotTheSdksOwnHeaders(): void
    {
        $client = $this->client([self::json(self::FOLDER)]);
        $client->folders->create(['name' => 'A'], ['headers' => ['X-Trace' => 't-1'], 'extraQuery' => ['preview' => 'true'],
            'extraBody' => ['beta' => true]]);
        self::assertSame('t-1', $this->sent[0]->getHeaderLine('X-Trace'));
        self::assertSame('preview=true', $this->sent[0]->getUri()->getQuery());
        self::assertSame(['beta' => true, 'name' => 'A'], json_decode((string) $this->sent[0]->getBody(), true));
        foreach ([['headers' => ['X-Api-Key' => 'other']], ['headers' => ['user-agent' => 'x']], ['max_retries' => 0],
            ['headers' => ['X-Bad' => "a\r\nb"]]] as $options) {
            self::assertSame('sdk/invalid-argument', self::code(fn () => $client->folders->create(['name' => 'A'], $options)), json_encode($options));
        }
        self::assertCount(1, $this->sent);
    }

    public function testMaxRetriesPerCallOverridesTheClient(): void
    {
        $client = $this->client([self::json(['code' => 'server/internal', 'message' => 'x'], 500), self::json(self::FOLDER)], ['maxRetries' => 0]);
        self::assertSame('folder-1', $client->folders->retrieve(['folderId' => 'folder-1'], ['maxRetries' => 1])->id);
        self::assertCount(2, $this->sent);
    }

    public function testTheRawRequestReusesAuthRetriesAndErrorMapping(): void
    {
        $client = $this->client([self::json(['code' => 'server/internal', 'message' => 'x'], 503),
            self::json(['ok' => true], 200, ['X-Request-Id' => 'req-2']), self::json(['code' => 'asset/not-found', 'message' => 'No'], 404)]);
        $response = $client->request('get', '/projects/project-1/usage', ['period' => 'day']);
        self::assertSame([200, 'req-2', ['ok' => true]], [$response->status, $response->requestId, $response->json]);
        self::assertSame('https://api.calmlens.com/v1/projects/project-1/usage?period=day', (string) $this->sent[1]->getUri());
        self::assertSame('key', $this->sent[1]->getHeaderLine('X-Api-Key'));
        self::assertInstanceOf(Exception\NotFoundException::class, (function () use ($client) {
            try {
                $client->request('DELETE', '/assets/a');
            } catch (CalmLensException $error) {
                return $error;
            }
        })());
        self::assertSame('sdk/invalid-argument', self::code(fn () => $client->request('GET', 'https://elsewhere.test/x')));
        self::assertSame('sdk/invalid-argument', self::code(fn () => $client->request('GET', '//elsewhere.test/x')));
        self::assertCount(3, $this->sent);
    }

    public function testResultsKeepTheirResponseAndNestedObjectsDoNot(): void
    {
        $client = $this->client([self::json(self::FOLDER, 201, ['X-Request-Id' => 'req-1']),
            self::json(['items' => [self::FOLDER], 'nextCursor' => null, 'hasMore' => false, 'ancestors' => []], 200, ['X-Request-Id' => 'req-2'])]);
        $folder = $client->folders->create(['name' => 'A']);
        self::assertSame([201, 'req-1'], [$folder->getLastResponse()?->status, $folder->getLastResponse()?->requestId]);
        $page = $client->folders->list();
        self::assertSame('req-2', $page->getLastResponse()?->requestId);
        self::assertInstanceOf(Folder::class, $page->items[0]);
        self::assertNull($page->items[0]->getLastResponse());
    }

    public function testEachAttemptIsReportedWithoutQueriesOrSignedUrlSegments(): void
    {
        $events = [];
        $client = $this->client([self::json(['code' => 'server/internal', 'message' => 'x'], 500, ['Retry-After' => '0']),
            self::json(self::FOLDER, 200, ['X-Request-Id' => 'req-9']), new Response(200, [], 'bytes')],
            ['onAttempt' => function (array $event) use (&$events) { $events[] = $event; }]);
        $client->folders->retrieve(['folderId' => 'folder-1']);
        $client->cdn->serve(['assetId' => 'sig_secretgrant', 'resource' => 'original', 'viewerClaims' => ['region' => 'DE']]);
        self::assertSame([
            ['folders.retrieve', 'GET', '/folders/folder-1', 1, 0, 500, null],
            ['folders.retrieve', 'GET', '/folders/folder-1', 2, null, 200, 'req-9'],
            ['cdn.serve', 'GET', '/assets/project-1/[redacted]/original', 1, null, 200, null],
        ], array_map(fn (array $e) => [$e['operation'], $e['method'], $e['path'], $e['attempt'], $e['delay'], $e['status'], $e['requestId']], $events));
        foreach ($events as $event) {
            self::assertIsFloat($event['duration']);
        }
    }

    public function testTheLoggerGetsOutcomesAndRetriesButNoSecrets(): void
    {
        $logger = new class extends AbstractLogger {
            public array $lines = [];
            public function log($level, string|\Stringable $message, array $context = []): void
            {
                $this->lines[] = [$level, $message . ' ' . json_encode($context)];
            }
        };
        $client = $this->client([self::json(['code' => 'server/internal', 'message' => 'x'], 500, ['Retry-After' => '0']),
            self::json(self::FOLDER), self::json(self::FOLDER)], ['logger' => $logger, 'apiKey' => 'clsk_secret_key']);
        $client->folders->retrieve(['folderId' => 'folder-1']);
        $client->folders->create(['name' => 'Private name'], ['extraQuery' => ['token' => 'clut_secret']]);
        self::assertSame(['debug', 'info', 'info'], array_column($logger->lines, 0));
        $all = implode("\n", array_column($logger->lines, 1));
        foreach (['clsk_secret_key', 'clut_secret', 'Private name'] as $secret) {
            self::assertStringNotContainsString($secret, $all);
        }
        self::assertStringContainsString('/folders/folder-1', $all);
    }

    public function testAnErrorKeepsTheResponseBodyUpToItsLimit(): void
    {
        $html = '<html>' . str_repeat('x', CalmLensException::BODY_LIMIT) . '</html>';
        $client = $this->client([new Response(502, ['Content-Type' => 'text/html'], $html)], ['maxRetries' => 0]);
        try {
            $client->folders->retrieve(['folderId' => 'folder-1']);
            self::fail('Expected an exception');
        } catch (Exception\ServerException $error) {
            self::assertSame('sdk/http-error', $error->errorCode);
            self::assertSame(substr($html, 0, CalmLensException::BODY_LIMIT), $error->body);
            self::assertInstanceOf(Exception\ExceptionInterface::class, $error);
        }
    }

    public function testTheLensCacheKeepsAtMostItsLimit(): void
    {
        $http = new MockHttpClient(function (RequestInterface $request): Response {
            return self::json(json_decode((string) $request->getBody(), true));
        });
        $client = new ServerClient('key', 'project-1', httpClient: $http);
        $lenses = array_map(fn ($i) => ['identifier' => "lens-$i", 'name' => 'Lens', 'type' => 'image'], range(1, \CalmLens\Internal\Session::MAX_ENSURED_LENSES + 5));
        $client->ensureLenses(['lenses' => $lenses]);
        $cache = (fn () => $this->session->ensuredLenses)->call($client);
        self::assertCount(\CalmLens\Internal\Session::MAX_ENSURED_LENSES, $cache);
        self::assertSame('lens-' . (\CalmLens\Internal\Session::MAX_ENSURED_LENSES + 5), end($cache)['identifier']);
    }
}
