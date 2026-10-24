<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
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
        $mock = new MockServerClient(queuedOutcome: 'age-restricted', downloadPermission: false);
        $asset = self::image($mock);
        $cdn = $mock->client()->cdn;
        $refused = $cdn->serve(['assetIdentifier' => $asset['id']]);
        self::assertSame(403, $refused->getStatusCode());
        self::assertSame('asset/api-key-missing-permission', json_decode((string) $refused->getBody(), true)['code']);
        $optedIn = $cdn->serve(['assetIdentifier' => $asset['id'], 'allowAgeRestricted' => true]);
        self::assertSame(200, $optedIn->getStatusCode());
        self::assertSame('png-bytes', (string) $optedIn->getBody());
        self::assertSame('private, no-store', $optedIn->getHeaderLine('Cache-Control'));
        $mock->downloadPermission = true;
        self::assertSame(200, $cdn->serve(['assetIdentifier' => $asset['id']])->getStatusCode());
    }

    public function testCdnServesPrivateAssetsOnlyWithDownloadPermission(): void
    {
        $mock = new MockServerClient(queuedOutcome: 'allowed', downloadPermission: false);
        $asset = self::image($mock, 'private');
        self::assertSame(403, $mock->client()->cdn->serve(['assetIdentifier' => $asset['id'], 'allowAgeRestricted' => true])->getStatusCode());
        $public = new MockServerClient(queuedOutcome: 'allowed', downloadPermission: false);
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
}
