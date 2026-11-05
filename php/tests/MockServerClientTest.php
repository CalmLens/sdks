<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\ErrorCodes;
use CalmLens\Exception;
use CalmLens\SdkErrorCodes;
use CalmLens\Testing\MockDecision;
use CalmLens\Testing\MockModerationInput;
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
    public function testModerateStatusSetsStatusesAndPurgedRemovesContent(string $outcome, string $classification, string $moderation, string $content): void
    {
        $mock = new MockServerClient(moderate: fn () => $outcome);
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

    public function testClassifyDecidesByTextAndRemovesTemporaryContent(): void
    {
        $mock = new MockServerClient(moderate: fn (MockModerationInput $input) => str_contains((string) $input->content->text, 'away') ? 'blocked' : 'allowed');
        $client = $mock->client();
        $kind = $client->text->classify(['name' => 'kind', 'text' => 'hello']);
        $rude = $client->text->classify(['name' => 'rude', 'text' => 'go away']);
        self::assertSame('allowed', $kind['classification']['moderation']['status']);
        self::assertSame('blocked', $rude['classification']['moderation']['status']);
        self::assertSame(['removed', 'retention'], [$kind['content']['status'], $kind['content']['removalReason']]);
        self::assertSame([], $mock->content);
    }

    public function testRetryRecordsItThenSettlesWithTheModerateAnswer(): void
    {
        $mock = new MockServerClient(moderate: fn (MockModerationInput $input) => $input->trigger === 'retry'
            ? MockDecision::of('blocked')->flag('violence', 0.9) : 'failed');
        $client = $mock->client();
        $asset = $client->text->classify(['name' => 'note', 'text' => 'hello']);
        self::assertSame('failed', $asset['classification']['status']);
        $mock->events = [];
        $retried = $client->assets->retry(['assetId' => $asset['id']]);
        self::assertSame(['completed', 'blocked', ['violence']], [$retried['classification']['status'],
            $retried['classification']['moderation']['status'], $retried['classification']['moderation']['flaggedCategories']]);
        self::assertSame(['asset.retried', 'asset.classified', 'asset.blocked'], array_column($mock->events, 'type'));
    }

    public function testModerateAnswersOtherThanADecisionAreRefused(): void
    {
        foreach (['approved', 42] as $answer) {
            $mock = new MockServerClient(moderate: fn () => $answer, maxRetries: 2);
            try {
                $mock->client()->text->classify(['text' => 'x']);
                self::fail('Expected the answer to be refused');
            } catch (Exception\InvalidArgumentException $error) {
                // Thrown to the test, not answered as an API error.
                self::assertSame([SdkErrorCodes::INVALID_ARGUMENT, null], [$error->errorCode, $error->status]);
            }
            // A mistake in the test is not a failed request to retry.
            self::assertCount(1, $mock->requests());
        }
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

    public function testChildrenListOnlyChildrenAndTheAssetListIncludesThem(): void
    {
        $mock = new MockServerClient();
        $client = $mock->client();
        $cat = $client->text->classify(['name' => 'Black cat', 'text' => 'meow']);
        $mock->assets['child'] = ['id' => 'child', 'parentId' => $cat['id'], 'createdAt' => 1] + $cat;
        self::assertSame(['child'], array_column($client->assets->listChildren(['assetId' => $cat['id']])['items'], 'id'));
        self::assertSame([$cat['id'], 'child'], array_column($client->assets->list()['items'], 'id'));
    }

    public function testTimelineChecksPageSizeThenRefusesASafetyHeldAsset(): void
    {
        $mock = new MockServerClient();
        $client = $mock->client();
        $clip = $client->assets->classify(['name' => 'clip.mp4', 'content' => ['data' => 'mp4-bytes', 'type' => 'video/mp4'],
            'processingOptions' => ['keepContentAfterProcessing' => true]]);
        self::assertSame([null, null], [$clip['classification']['progress'], $clip['classification']['moderation']['timeline']]);
        $mock->assets[$clip['id']]['content']['safetyHold'] = ['placedAt' => 1, 'reason' => 'suspected-illegal-content', 'disposedAt' => null];
        self::assertSame('validation/too-big', self::code(fn () => $client->assets->listTimeline(['assetId' => $clip['id'], 'pageSize' => 101])));
        self::assertSame('validation/too-small', self::code(fn () => $client->assets->listTimeline(['assetId' => $clip['id'], 'pageSize' => 0])));
        self::assertSame(ErrorCodes::ASSET_SAFETY_HELD, self::code(fn () => $client->assets->listTimeline(['assetId' => $clip['id'], 'cursor' => 'x'])));
        $mock->failNextRequest('misc/internal-error', 'assets.listTimeline');
        self::assertSame('misc/internal-error', self::code(fn () => $client->assets->listTimeline(['assetId' => $clip['id']])));
    }

    public function testASafetyHoldWithholdsTheRenderingAndRefusesEveryCdnResource(): void
    {
        $mock = new MockServerClient();
        $client = $mock->client();
        $photo = $client->assets->classify(['name' => 'photo.png', 'visibility' => 'public',
            'content' => ['data' => 'png-bytes', 'type' => 'image/png'], 'processingOptions' => ['keepContentAfterProcessing' => true]]);
        $queued = self::image($mock);
        self::assertSame(['image', MockServerClient::THUMBHASH], [$photo['content']['rendered']['kind'], $photo['content']['preview']['thumbhash']]);
        foreach (['original', 'rendered', 'preview', 'placeholder'] as $resource) {
            self::assertSame(200, $client->cdn->serve(['assetIdentifier' => $photo['id'], 'resource' => $resource])->getStatusCode(), $resource);
        }
        $mock->assets[$photo['id']]['content']['safetyHold'] = ['placedAt' => 1, 'reason' => 'suspected-illegal-content', 'disposedAt' => null];
        foreach (['original', 'rendered', 'preview', 'placeholder'] as $resource) {
            $response = $client->cdn->serve(['assetIdentifier' => $photo['id'], 'resource' => $resource]);
            self::assertSame([403, 'asset/not-available'], [$response->getStatusCode(), json_decode((string) $response->getBody(), true)['code']], $resource);
        }
        // A decision while a hold is on reports neither a rendered file nor a preview.
        self::assertSame('image', $queued['content']['rendered']['kind']);
        $mock->assets[$queued['id']]['content']['safetyHold'] = ['placedAt' => 1, 'reason' => 'suspected-illegal-content', 'disposedAt' => null];
        $held = $mock->completeProcessing($queued['id'], 'allowed');
        self::assertSame([null, null], [$held['content']['rendered'], $held['content']['preview']]);
    }

    public function testFiltersSupportOrWildcardsAndValueLists(): void
    {
        $time = 1;
        $mock = new MockServerClient(moderate: fn (MockModerationInput $input) => $input->asset['description'], now: function () use (&$time) { return $time++; });
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
        self::assertSame([503, null, 200], array_map(fn ($request) => $request->status, $retrying->requests()));
    }

    public function testFailNextRequestRefusesWhatItCannotSimulate(): void
    {
        $mock = new MockServerClient();
        // The shared scenarios cover unknown operations and transport errors with details or retryAfter.
        self::assertSame(SdkErrorCodes::INVALID_ARGUMENT, self::code(fn () => $mock->failNextRequest('disconnect')));
        self::assertSame(SdkErrorCodes::INVALID_ARGUMENT, self::code(fn () => $mock->failNextRequest(new \RuntimeException('down'), details: ['reason' => 'x'])));
        self::assertSame(SdkErrorCodes::INVALID_ARGUMENT, self::code(fn () => $mock->failNextRequest('upload/limit-exceeded', retryAfter: -1)));
        self::assertSame(0, $mock->pending());
    }

    public function testAcceptsTheClientsUploadTimeoutAndResponseSizeLimit(): void
    {
        try {
            new MockServerClient(uploadTimeout: 0);
            self::fail('Expected an invalid upload timeout to be refused');
        } catch (CalmLensException $error) {
            self::assertSame('sdk/invalid-config', $error->errorCode);
        }
        // The limit applies to the mock's answers as to the API's.
        $mock = new MockServerClient(maxResponseBytes: 64, uploadTimeout: 90);
        try {
            self::image($mock);
            self::fail('Expected the response size limit to apply');
        } catch (CalmLensException $error) {
            self::assertSame('sdk/response-too-large', $error->errorCode);
        }
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
        $mock = new MockServerClient();
        $client = $mock->client();
        $status = function () use ($mock): ?int {
            $requests = $mock->requests();
            return end($requests)->status;
        };
        $list = $client->hashLists->create(['name' => 'Removed images', 'action' => 'block']);
        $unhashed = self::image($mock);
        try {
            $client->hashLists->addEntry(['hashListId' => $list['id'], 'assetId' => $unhashed['id']]);
            self::fail('Expected hash-list/asset-not-hashed');
        } catch (Exception\ConflictException $error) {
            self::assertSame(ErrorCodes::HASH_LIST_ASSET_NOT_HASHED, $error->errorCode);
        }
        $hash = str_repeat('ab', 32);
        $mock->assets[$unhashed['id']]['content'] = ['perceptualHash' => $hash, 'perceptualHashQuality' => 87] + $mock->assets[$unhashed['id']]['content'];
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
        // Uploads are blocked; a rerun stays processing until completeProcessing.
        $mock = new MockServerClient(moderate: fn (MockModerationInput $input) => $input->trigger === 'upload' ? 'blocked' : 'pending');
        $client = $mock->client();
        $asset = self::image($mock);
        $mock->assets[$asset['id']]['classification']['moderation']['explanationComplete'] = false;
        $explained = $client->assets->explain(['assetId' => $asset['id']]);
        self::assertSame([true, 'blocked'], [$explained['classification']['moderation']['explanationComplete'],
            $explained['classification']['moderation']['status']]);
        $mock->assets[$asset['id']]['classification']['moderation']['manualReviews'] = [['decision' => 'blocked']];
        self::assertSame(ErrorCodes::ASSET_REVIEWED, self::code(fn () => $client->assets->explain(['assetId' => $asset['id'], 'rerun' => true])));
        $mock->assets[$asset['id']]['classification']['moderation']['manualReviews'] = [];
        $rerun = $client->assets->explain(['assetId' => $asset['id'], 'rerun' => true]);
        self::assertSame(['processing', 'pending'], [$rerun['classification']['status'], $rerun['classification']['moderation']['status']]);
        self::assertSame(ErrorCodes::ASSET_NOT_DECIDED, self::code(fn () => $client->assets->explain(['assetId' => $asset['id']])));
    }

    /** The SDK refuses these types itself, so each is sent past it, straight to the mock, as another client could. */
    public function testTheMockRefusesUploadsOfTypesTheApiRefuses(): void
    {
        $mock = new MockServerClient();
        $session = (fn () => $this->session)->call($mock->client());
        $http = (fn () => $this->http)->call($session);
        $fixture = json_decode(file_get_contents(__DIR__ . '/../../ruby/testdata/upload-mime-types.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixture['refused'] as $type) {
            $response = $http->request('POST', 'https://api.calmlens.invalid/v1/projects/project-1/assets?name=x&sizeInBytes=5&contentType=' . rawurlencode($type),
                ['headers' => ['Content-Type' => $type, 'X-CalmLens-Upload' => 'content'], 'body' => 'hello', 'http_errors' => false]);
            $body = json_decode((string) $response->getBody(), true);
            self::assertSame([400, ErrorCodes::INVALID_UPLOAD_MIME_TYPE, ['mimeType' => $type]],
                [$response->getStatusCode(), $body['code'] ?? null, $body['details'] ?? null], $type);
        }
        self::assertSame([], $mock->assets);
    }
}
