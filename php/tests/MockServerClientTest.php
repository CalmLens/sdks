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
        yield ['limited', 'completed', 'limited', 'stored'];
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

    private static function code(callable $call): string
    {
        try {
            $call();
        } catch (CalmLensException $error) {
            return $error->errorCode;
        }
        self::fail('Expected an error');
    }

    public function testChildrenListOnlyChildren(): void
    {
        $mock = new MockServerClient();
        $client = $mock->client();
        $cat = $client->text->classify(['name' => 'Black cat', 'text' => 'meow']);
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

    public function testHashListEntryFromAnAssetTakesItsPerceptualHashAndGoesWithTheList(): void
    {
        $mock = new MockServerClient(analyzedOutcome: 'allowed');
        $client = $mock->client();
        $status = fn (): ?int => (fn (): ?int => $this->lastStatus)->call($mock);
        $list = $client->hashLists->create(['name' => 'Removed images', 'action' => 'block']);
        $unhashed = self::image($mock);
        try {
            $client->hashLists->addEntry(['hashListId' => $list['id'], 'assetId' => $unhashed['id']]);
            self::fail('Expected hash-list/asset-not-hashed');
        } catch (Exception\ConflictException $error) {
            self::assertSame(ErrorCodes::HASH_LIST_ASSET_NOT_HASHED, $error->errorCode);
        }
        $hash = str_repeat('ab', 32);
        $mock->assets[$unhashed['id']]['content']['image'] = ['perceptualHash' => $hash, 'perceptualHashQuality' => 87];
        $entry = $client->hashLists->addEntry(['hashListId' => $list['id'], 'assetId' => $unhashed['id'], 'label' => 'Report 1042']);
        self::assertSame(201, $status());
        self::assertSame([$hash, 87, $unhashed['id'], 'Report 1042'], [$entry['hash'], $entry['quality'], $entry['sourceAssetId'], $entry['label']]);
        $again = $client->hashLists->addEntry(['hashListId' => $list['id'], 'hash' => strtoupper($hash)]);
        self::assertSame(200, $status());
        self::assertSame($entry['id'], $again['id']);
        $client->hashLists->delete(['hashListId' => $list['id']]);
        self::assertSame([], $mock->hashListEntries);
        try {
            $client->hashLists->removeEntry(['entryId' => $entry['id']]);
            self::fail('Expected hash-list/entry-not-found');
        } catch (Exception\NotFoundException $error) {
            self::assertSame(ErrorCodes::HASH_LIST_ENTRY_NOT_FOUND, $error->errorCode);
        }
    }

    public function testExplainCompletesTheEvidenceAndRerunModeratesAgain(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'blocked');
        $client = $mock->client();
        $asset = self::image($mock);
        $mock->assets[$asset['id']]['classification']['moderation']['policy'] = ['score' => 0.9, 'categories' => [], 'evidence' => 'decision'];
        $explained = $client->assets->explain(['assetId' => $asset['id']]);
        self::assertSame(['full', 'blocked'], [$explained['classification']['moderation']['policy']['evidence'],
            $explained['classification']['moderation']['status']]);
        $mock->assets[$asset['id']]['classification']['moderation']['manualReviews'] = [['decision' => 'blocked']];
        self::assertSame(ErrorCodes::ASSET_REVIEWED, self::code(fn () => $client->assets->explain(['assetId' => $asset['id'], 'rerun' => true])));
        $mock->assets[$asset['id']]['classification']['moderation']['manualReviews'] = [];
        $rerun = $client->assets->explain(['assetId' => $asset['id'], 'rerun' => true]);
        self::assertSame(['processing', 'pending'], [$rerun['classification']['status'], $rerun['classification']['moderation']['status']]);
        self::assertSame(ErrorCodes::ASSET_NOT_DECIDED, self::code(fn () => $client->assets->explain(['assetId' => $asset['id']])));
    }

}
