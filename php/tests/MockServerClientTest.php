<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\ErrorCodes;
use CalmLens\Exception;
use CalmLens\Testing\MockServerClient;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MockServerClientTest extends TestCase
{
    private static function downloadKey(): string
    {
        return MockServerClient::createApiKey([['actions' => ['assets:download'], 'folderId' => null, 'includeSubfolders' => true]]);
    }

    private static function image(MockServerClient $mock, string $visibility = 'public'): array
    {
        return $mock->client()->assets->create([
            'name' => 'photo.png', 'visibility' => $visibility, 'externalId' => 'post-1',
            'content' => ['data' => 'png-bytes', 'type' => 'image/png'],
            'processingOptions' => ['keepContentAfterProcessing' => true],
        ]);
    }

    public static function outcomes(): iterable
    {
        yield ['allowed', 'completed', 'allowed', 'stored'];
        yield ['age-restricted', 'completed', 'age-restricted', 'stored'];
        yield ['blocked', 'completed', 'blocked', 'stored'];
        yield ['purged', 'completed', 'purged', 'removed'];
        yield ['failed', 'failed', 'pending', 'stored'];
        yield ['pending', 'processing', 'pending', 'stored'];
    }

    #[DataProvider('outcomes')]
    public function testQueuedOutcomeSetsStatusesAndPurgedRemovesContent(string $outcome, string $classification, string $moderation, string $content): void
    {
        $mock = new MockServerClient(queuedOutcome: $outcome);
        $asset = self::image($mock);
        $stored = $mock->client()->assets->retrieve(['assetId' => $asset['id']]);
        self::assertSame($classification, $stored['classification']['status']);
        self::assertSame($moderation, $stored['classification']['moderation']['status']);
        self::assertSame($content, $stored['content']['status']);
        self::assertSame($content === 'removed', !isset($mock->content[$asset['id']]));
        if ($outcome === 'purged') {
            self::assertSame('policy', $stored['content']['removalReason']);
        }
    }

    public function testClassifyUsesAnalyzedOutcomeAndRemovesTemporaryContent(): void
    {
        $mock = new MockServerClient(analyzedOutcome: fn (array $asset) => str_contains($asset['name'], 'rude') ? 'blocked' : 'allowed');
        $client = $mock->client();
        $kind = $client->text->classify(['name' => 'kind', 'text' => 'hello']);
        $rude = $client->text->classify(['name' => 'rude', 'text' => 'go away']);
        self::assertSame('allowed', $kind['classification']['moderation']['status']);
        self::assertSame('blocked', $rude['classification']['moderation']['status']);
        self::assertSame(['removed', 'retention'], [$kind['content']['status'], $kind['content']['removalReason']]);
        self::assertSame([], $mock->content);
        $fields = new MockServerClient(analyzedOutcome: ['classification' => ['moderation' => ['status' => 'age-restricted', 'categories' => ['sexual' => ['status' => 'evaluated', 'score' => 0.9]]]]]);
        $asset = $fields->client()->text->classify(['text' => 'x']);
        self::assertSame('age-restricted', $asset['classification']['moderation']['status']);
        self::assertSame('completed', $asset['classification']['status']);
        self::assertSame(0.9, $asset['classification']['moderation']['categories']['sexual']['score']);
    }

    public function testUnknownOutcomeIsRejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new MockServerClient(queuedOutcome: 'approved');
    }

    public function testWaitForDecisionReturnsAfterDecideAndDecideAddsTheStatusEvent(): void
    {
        $mock = new MockServerClient();
        $client = $mock->client();
        $asset = self::image($mock);
        $cursor = $client->events->list()['cursor'];
        try {
            $client->assets->waitForDecision(['assetId' => $asset['id'], 'timeout' => 0]);
            self::fail('Expected a timeout');
        } catch (CalmLensException $error) {
            self::assertSame('sdk/timeout', $error->errorCode);
        }
        $mock->decide($asset['id'], 'age-restricted');
        self::assertSame('age-restricted', $client->assets->waitForDecision(['assetId' => $asset['id']])['classification']['moderation']['status']);
        $events = $client->events->list(['after' => $cursor])['events'];
        self::assertSame(['asset.age-restricted'], array_column($events, 'type'));
        self::assertSame($asset['id'], $events[0]['assetId']);
        self::assertSame('age-restricted', $events[0]['asset']['classification']['moderation']['status']);
        self::assertSame([['key' => 'decided-by', 'value' => 'reviewer']], $events[0]['facts']);
    }

    public function testCdnRefusesBlockedAssets(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'blocked');
        $asset = self::image($mock);
        $response = $mock->client()->cdn->serve(['assetIdentifier' => $asset['id']]);
        self::assertSame(403, $response->getStatusCode());
        self::assertSame('asset/not-available', json_decode((string) $response->getBody(), true)['code']);
    }

    public function testCdnServesPublicAgeRestrictedAssetsOnlyWithTheOptInOrDownloadPermission(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'age-restricted');
        $asset = self::image($mock);
        $cdn = $mock->client()->cdn;
        $refused = $cdn->serve(['assetIdentifier' => $asset['id']]);
        self::assertSame(403, $refused->getStatusCode());
        self::assertSame('asset/api-key-missing-permission', json_decode((string) $refused->getBody(), true)['code']);
        $optedIn = $cdn->serve(['assetIdentifier' => $asset['id'], 'allowAgeRestricted' => true]);
        self::assertSame(200, $optedIn->getStatusCode());
        self::assertSame('png-bytes', (string) $optedIn->getBody());
        self::assertSame('private, no-store', $optedIn->getHeaderLine('Cache-Control'));
        $granted = new MockServerClient(queuedOutcome: 'age-restricted', apiKey: self::downloadKey());
        $grantedAsset = self::image($granted);
        self::assertSame(200, $granted->client()->cdn->serve(['assetIdentifier' => $grantedAsset['id']])->getStatusCode());
    }

    public function testCdnServesPrivateAssetsOnlyWithDownloadPermission(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'allowed');
        $asset = self::image($mock, 'private');
        self::assertSame(403, $mock->client()->cdn->serve(['assetIdentifier' => $asset['id'], 'allowAgeRestricted' => true])->getStatusCode());
        $public = new MockServerClient(queuedOutcome: 'allowed');
        $allowed = self::image($public);
        $response = $public->client()->cdn->serve(['assetIdentifier' => 'post-1']);
        self::assertSame(200, $response->getStatusCode());
        self::assertSame('public, max-age=31536000', $response->getHeaderLine('Cache-Control'));
        self::assertSame($allowed['id'], $public->client()->assets->list()['items'][0]['id']);
    }

    public function testListFiltersByModerationStatusAndPages(): void
    {
        $time = 1000;
        $mock = new MockServerClient(analyzedOutcome: fn (array $asset) => $asset['name'], now: function () use (&$time) { return $time++; });
        $client = $mock->client();
        foreach (['allowed', 'blocked', 'allowed'] as $status) {
            $client->text->classify(['name' => $status, 'text' => 'x']);
        }
        $blocked = $client->assets->list(['filter' => 'classification.moderation.status==blocked'])['items'];
        self::assertSame(['blocked'], array_column($blocked, 'name'));
        self::assertCount(3, iterator_to_array($client->assets->each(['pageSize' => 1]), false));
    }

    public function testEnqueuedResponsesComeFirstAndMissingAssetsAreNotFound(): void
    {
        $mock = new MockServerClient();
        $mock->enqueueJson(['code' => 'server/unavailable'], 503);
        $client = $mock->client();
        try {
            $client->assets->retrieve(['assetId' => 'missing']);
            self::fail('Expected the queued error');
        } catch (CalmLensException $error) {
            self::assertSame(['server/unavailable', 503], [$error->errorCode, $error->status]);
        }
        self::assertSame(0, $mock->pending());
        try {
            $client->assets->retrieve(['assetId' => 'missing']);
            self::fail('Expected not found');
        } catch (CalmLensException $error) {
            self::assertSame(['asset/not-found', 404], [$error->errorCode, $error->status]);
        }
        self::assertCount(2, $mock->requests());
    }

    public function testDeleteRemovesTheAsset(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'allowed');
        $asset = self::image($mock);
        $mock->client()->assets->delete(['assetId' => $asset['id']]);
        self::assertArrayNotHasKey($asset['id'], $mock->assets);
        self::assertSame(404, $mock->client()->cdn->serve(['assetIdentifier' => $asset['id']])->getStatusCode());
    }

    private static function code(callable $call): string
    {
        try {
            $call();
        } catch (CalmLensException $error) {
            return $error->errorCode;
        }
        self::fail('Expected an error');
    }

    public function testFoldersAreCreatedListedWithAncestorsMovedAndDeletedLikeTheApi(): void
    {
        $mock = new MockServerClient();
        $folders = $mock->client()->folders;
        $root = $folders->create(['name' => 'Root']);
        $child = $folders->create(['name' => 'Child', 'parentId' => $root['id']]);
        $grandchild = $folders->create(['name' => 'Grandchild', 'parentId' => $child['id']]);
        self::assertSame(ErrorCodes::DUPLICATE_FOLDER_NAME, self::code(fn () => $folders->create(['name' => 'Child', 'parentId' => $root['id']])));
        $page = $folders->list(['parentId' => $child['id']]);
        self::assertSame([$grandchild['id']], array_column($page['folders'], 'id'));
        self::assertEqualsCanonicalizing([$root['id'], $child['id']], array_column($page['ancestors'], 'id'));
        self::assertSame([$root['id']], array_column($folders->list()['folders'], 'id'));
        self::assertSame('Renamed', $folders->update(['folderId' => $child['id'], 'name' => 'Renamed'])['name']);
        self::assertSame(ErrorCodes::FOLDER_PARENT_CYCLE, self::code(fn () => $folders->move(['folderId' => $root['id'], 'parentId' => $grandchild['id']])));
        self::assertNull($folders->move(['folderId' => $grandchild['id'], 'parentId' => null])['parentId']);
        $asset = $mock->client()->text->classify(['text' => 'hello', 'folderId' => $child['id']]);
        self::assertSame([$asset['id']], array_column($mock->client()->assets->list(['folderId' => $child['id']])['items'], 'id'));
        self::assertSame(ErrorCodes::FOLDER_NOT_EMPTY, self::code(fn () => $folders->delete(['folderId' => $child['id']])));
        $mock->client()->assets->move(['assetId' => $asset['id'], 'folderId' => null]);
        $folders->delete(['folderId' => $child['id']]);
        self::assertArrayNotHasKey($child['id'], $mock->folders);
        $missing = null;
        try {
            $folders->retrieve(['folderId' => $child['id']]);
        } catch (Exception\NotFoundException $missing) {
        }
        self::assertSame(ErrorCodes::FOLDER_NOT_FOUND, $missing?->errorCode);
        self::assertSame(ErrorCodes::FOLDER_NOT_FOUND, self::code(fn () => $mock->client()->assets->move(['assetId' => $asset['id'], 'folderId' => 'gone'])));
    }

    public function testSearchMatchesKeywordsAndChildrenListOnlyChildren(): void
    {
        $mock = new MockServerClient();
        $client = $mock->client();
        $cat = $client->text->classify(['name' => 'Black cat', 'text' => 'meow']);
        $client->text->classify(['name' => 'Dog', 'text' => 'woof']);
        $result = $client->assets->search(['query' => 'CAT']);
        self::assertSame([$cat['id']], array_map(fn ($item) => $item['asset']['id'], $result['items']));
        self::assertSame(['name'], $result['items'][0]['matchedFields']);
        $mock->assets['child'] = ['id' => 'child', 'parentId' => $cat['id'], 'createdAt' => 1] + $cat;
        self::assertSame(['child'], array_column($client->assets->listChildren(['assetId' => $cat['id']])['items'], 'id'));
        self::assertNotContains('child', array_column($client->assets->list()['items'], 'id'));
    }

    public function testFiltersSupportOrWildcardsAndValueLists(): void
    {
        $time = 1;
        $mock = new MockServerClient(analyzedOutcome: fn (array $asset) => $asset['description'], now: function () use (&$time) { return $time++; });
        $client = $mock->client();
        foreach (['allowed' => 'note-a.txt', 'blocked' => 'photo.png', 'purged' => 'note-b.txt'] as $status => $name) {
            $client->text->classify(['name' => $name, 'description' => $status, 'text' => 'x']);
        }
        $names = fn (string $filter) => array_column($client->assets->list(['filter' => $filter])['items'], 'name');
        self::assertSame(['note-b.txt', 'note-a.txt'], $names('name==note-*'));
        self::assertSame(['photo.png', 'note-a.txt'], $names('classification.moderation.status==blocked,name==note-a.txt'));
        self::assertSame(['note-b.txt'], $names('name==note-*;classification.moderation.status=out=(allowed,blocked)'));
        self::assertSame(['photo.png'], $names('classification.moderation.status=in=("blocked")'));
        $this->expectException(\LogicException::class);
        $names('(name==a,name==b);type==file');
    }

    public function testMultipartUploadsAppendPartsAndUseTheSavedQueueMode(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'blocked');
        $assets = $mock->client()->assets;
        $first = str_repeat('a', 5 * 1024 * 1024);
        $started = $assets->create(['name' => 'big.txt', 'processingOptions' => ['keepContentAfterProcessing' => true],
            'part' => ['data' => $first, 'type' => 'text/plain']]);
        self::assertSame(['uploading', 'pending'], [$started['upload']['status'], $started['classification']['status']]);
        self::assertSame(403, $mock->client()->cdn->serve(['assetIdentifier' => $started['id']])->getStatusCode());
        self::assertSame(ErrorCodes::INVALID_UPLOAD_PART_NUMBER, self::code(fn () => $assets->uploadPart(['assetId' => $started['id'], 'part' => ['data' => 'z', 'partNumber' => 3, 'isFinal' => true]])));
        $done = $assets->uploadPart(['assetId' => $started['id'], 'part' => ['data' => 'end', 'partNumber' => 2, 'isFinal' => true]]);
        self::assertSame(['completed', 2, 'blocked'], [$done['upload']['status'], $done['upload']['partsReceived'], $done['classification']['moderation']['status']]);
        self::assertSame($first . 'end', $mock->content[$started['id']]['bytes']);
        self::assertSame(ErrorCodes::UPLOAD_NOT_OPEN, self::code(fn () => $assets->uploadPart(['assetId' => $started['id'], 'part' => ['data' => 'z', 'partNumber' => 3, 'isFinal' => true]])));
        $analyzed = $assets->create(['name' => 'b.txt', 'part' => ['data' => $first, 'type' => 'text/plain']]);
        $override = $assets->uploadPart(['assetId' => $analyzed['id'], 'queue' => false, 'part' => ['data' => 'x', 'partNumber' => 2, 'isFinal' => true]]);
        self::assertSame('allowed', $override['classification']['moderation']['status']);
        $sized = $assets->create(['name' => 'c.txt', 'totalSizeInBytes' => strlen($first) + 2, 'part' => ['data' => $first, 'type' => 'text/plain']]);
        self::assertSame(ErrorCodes::UPLOAD_SIZE_MISMATCH, self::code(fn () => $assets->uploadPart(['assetId' => $sized['id'], 'part' => ['data' => 'x', 'partNumber' => 2, 'isFinal' => true]])));
    }

    public function testIdempotencyKeysReplayTheSavedResponseAndRejectADifferentRequest(): void
    {
        $mock = new MockServerClient();
        $assets = $mock->client()->assets;
        $options = ['name' => 'a.txt', 'content' => ['plainText' => 'one', 'type' => 'text/plain'], 'requestOptions' => ['idempotencyKey' => 'key-1']];
        $first = $assets->create($options);
        self::assertSame($first, $assets->create($options));
        self::assertCount(1, $mock->assets);
        $options['content']['plainText'] = 'two';
        self::assertSame(ErrorCodes::IDEMPOTENCY_KEY_REUSED, self::code(fn () => $assets->create($options)));
    }

    public function testFailNextRequestSimulatesConnectionFailuresAndApiErrors(): void
    {
        $mock = new MockServerClient();
        $client = $mock->client();
        $mock->failNextRequest()->failNextRequest('timeout')
            ->failNextRequest(new CalmLensException(ErrorCodes::UPLOAD_LIMIT_EXCEEDED, 'Slow down', 429, ['limit' => 5], ['Retry-After' => '7']));
        try {
            $client->assets->list();
            self::fail('Expected a transport error');
        } catch (Exception\ConnectionException $error) {
            self::assertSame('sdk/transport-error', $error->errorCode);
            self::assertInstanceOf(\GuzzleHttp\Exception\ConnectException::class, $error->getPrevious());
        }
        $this->assertTimeout(fn () => $client->assets->list());
        try {
            $client->assets->list();
            self::fail('Expected an API error');
        } catch (Exception\RateLimitException $error) {
            self::assertSame([ErrorCodes::UPLOAD_LIMIT_EXCEEDED, 429, 7.0, 5], [$error->errorCode, $error->status, $error->retryAfter(), $error->details['limit']]);
            self::assertStringStartsWith('mock-', (string) $error->requestId);
            self::assertTrue($error->isRetryable());
        }
        self::assertCount(0, $mock->assets);
        // Retries run without real waiting: the backoff advances the mock's clock.
        $retrying = new MockServerClient(maxRetries: 2);
        $retrying->failNextRequest(new CalmLensException('server/unavailable', 'Busy', 503, [], ['Retry-After' => '30']))->failNextRequest('timeout');
        $started = microtime(true);
        self::assertSame([], $retrying->client()->assets->list()['items']);
        self::assertLessThan(5, microtime(true) - $started);
        self::assertCount(3, $retrying->requests());
    }

    private function assertTimeout(callable $call): void
    {
        try {
            $call();
            self::fail('Expected a timeout');
        } catch (Exception\TimeoutException $error) {
            self::assertSame('sdk/timeout', $error->errorCode);
        }
    }

    public function testWaitForDecisionTimesOutOnTheVirtualClock(): void
    {
        $mock = new MockServerClient();
        $asset = $mock->client()->text->classify(['text' => 'x']);
        $mock->assets[$asset['id']]['classification']['moderation']['status'] = 'pending';
        $started = microtime(true);
        $this->assertTimeout(fn () => $mock->client()->assets->waitForDecision(['assetId' => $asset['id'], 'timeout' => 60]));
        self::assertLessThan(5, microtime(true) - $started);
        self::assertGreaterThan(5, count($mock->requests()));
    }

    public function testMockApiKeyGrantsDecideCdnDownloadsByFolder(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'allowed');
        $parent = $mock->client()->folders->create(['name' => 'Granted']);
        $nested = $mock->client()->folders->create(['name' => 'Nested', 'parentId' => $parent['id']]);
        $grants = static fn (bool $subfolders) => MockServerClient::createApiKey([['actions' => ['assets:download'], 'folderId' => $parent['id'], 'includeSubfolders' => $subfolders]]);
        foreach ([[$grants(true), [200, 200, 403]], [$grants(false), [200, 403, 403]], [MockServerClient::createApiKey(), [403, 403, 403]]] as [$key, $expected]) {
            $keyed = new MockServerClient(queuedOutcome: 'allowed', apiKey: $key);
            $keyed->folders = $mock->folders;
            $statuses = [];
            foreach ([$parent['id'], $nested['id'], null] as $folderId) {
                $asset = $keyed->client()->assets->create(['name' => 'p.txt', 'folderId' => $folderId,
                    'processingOptions' => ['keepContentAfterProcessing' => true], 'content' => ['plainText' => 'private', 'type' => 'text/plain']]);
                $statuses[] = $keyed->client()->cdn->serve(['assetIdentifier' => $asset['id']])->getStatusCode();
            }
            self::assertSame($expected, $statuses);
        }
    }

    public function testRetryNeedsAFailedAssetWithContentAndLensesNeedAHigherVersionToChange(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'failed');
        $client = $mock->client();
        $asset = self::image($mock);
        self::assertSame('processing', $client->assets->retry(['assetId' => $asset['id']])['classification']['status']);
        self::assertSame(ErrorCodes::ASSET_NOT_RETRYABLE, self::code(fn () => $client->assets->retry(['assetId' => $asset['id']])));
        $mock->decide($asset['id'], 'failed');
        $client->assets->deleteContent(['assetId' => $asset['id']]);
        self::assertSame(ErrorCodes::ASSET_CONTENT_UNAVAILABLE, self::code(fn () => $client->assets->retry(['assetId' => $asset['id']])));
        $lens = ['identifier' => 'thumb', 'name' => 'Thumb', 'type' => 'image', 'version' => 1];
        $saved = $client->ensureLens($lens);
        self::assertSame($saved['id'], $mock->lenses['thumb']['id']);
        self::assertSame(ErrorCodes::LENS_VERSION_CONFLICT, self::code(fn () => $client->ensureLens(['name' => 'Changed'] + $lens)));
        $changed = $client->ensureLens(['name' => 'Changed', 'version' => 2] + $lens);
        self::assertSame([$saved['id'], 2, 'Changed'], [$changed['id'], $changed['version'], $mock->lenses['thumb']['name']]);
    }
}
