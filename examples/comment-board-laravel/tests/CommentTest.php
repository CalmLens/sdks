<?php

use CalmLens\ServerClient;
use CalmLens\Testing\MockTransport;
use CalmLens\Webhooks;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Cache;
use PHPUnit\Framework\Attributes\DataProvider;

final class CommentTest extends TestCase
{
    public function createApplication()
    {
        $app = require __DIR__ . '/../bootstrap/app.php';
        $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['session.driver' => 'array', 'cache.default' => 'array', 'cache.stores.array' => ['driver' => 'array'],
            'calmlens.project_id' => 'project-1', 'calmlens.webhook_secret' => 'test-secret']);
    }

    public function testApprovedCommentIsStoredAndSentToModeration(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['id' => 'asset-1', 'classification' => ['moderation' => ['decision' => 'approved', 'action' => null]]]);
        $this->app->instance(ServerClient::class, $mock->client());
        $this->post('/comments', ['comment' => 'Hello'])->assertRedirect('/')->assertSessionHas('comments', [['text' => 'Hello', 'assetId' => 'asset-1']]);
        self::assertSame('Hello', (string) $mock->requests()[0]->getBody());
        self::assertSame('text/plain', $mock->requests()[0]->getHeaderLine('Content-Type'));
    }

    public static function withheld(): iterable
    {
        yield ['rejected', 'hide'];
        yield ['pending', null];
        yield ['future-status', null];
        yield ['approved', 'alert'];
    }

    #[DataProvider('withheld')]
    public function testUnapprovedOrFlaggedCommentsAreNotStored(string $decision, ?string $action): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['id' => 'asset-1', 'classification' => ['moderation' => compact('decision', 'action')]]);
        $this->app->instance(ServerClient::class, $mock->client());
        $this->post('/comments', ['comment' => 'example'])->assertSessionHasErrors('comment')->assertSessionMissing('comments');
    }

    public function testApiFailureDoesNotPublish(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['code' => 'sdk/http-error'], 503);
        $this->app->instance(ServerClient::class, $mock->client());
        $this->post('/comments', ['comment' => 'example'])->assertSessionHasErrors('comment')->assertSessionMissing('comments');
    }

    public function testValidationDoesNotCallApi(): void
    {
        $mock = new MockTransport();
        $this->app->instance(ServerClient::class, $mock->client());
        $this->post('/comments', ['comment' => ''])->assertSessionHasErrors('comment');
        self::assertSame([], $mock->requests());
    }

    public function testWebhookVerifiesRawBodyAndDeduplicates(): void
    {
        $event = ['id' => 'event-1', 'type' => 'asset.approved', 'createdAt' => 1000, 'projectId' => 'project-1', 'data' => ['facts' => [['key' => 'asset-id', 'value' => 'asset-1']]]];
        $body = json_encode($event);
        $headers = ['HTTP_X_CALMLENS_SIGNATURE' => Webhooks::signatureHeader($body, time(), 'test-secret'), 'HTTP_X_CALMLENS_TIMESTAMP' => (string) time(), 'CONTENT_TYPE' => 'application/json'];
        $this->call('POST', '/api/webhooks/calmlens', [], [], [], $headers, $body)->assertNoContent();
        self::assertSame(['id' => 'event-1', 'type' => 'asset.approved', 'facts' => $event['data']['facts']], Cache::get('calmlens-last-event'));
        Cache::forget('calmlens-last-event');
        $this->call('POST', '/api/webhooks/calmlens', [], [], [], $headers, $body)->assertNoContent();
        self::assertNull(Cache::get('calmlens-last-event'));
        $this->call('POST', '/api/webhooks/calmlens', [], [], [], $headers, $body . ' ')->assertStatus(401)->assertJsonPath('code', 'sdk/invalid-webhook-signature');
    }

    public function testTestDeliveryDoesNotRecordAnEvent(): void
    {
        $body = json_encode(['id' => 'test', 'type' => 'asset.approved', 'createdAt' => 1000, 'projectId' => 'project-1', 'data' => ['facts' => [['key' => 'test', 'value' => true]]]]);
        $headers = ['HTTP_X_CALMLENS_SIGNATURE' => Webhooks::signatureHeader($body, time(), 'test-secret'), 'HTTP_X_CALMLENS_TIMESTAMP' => (string) time(), 'CONTENT_TYPE' => 'application/json'];
        $this->call('POST', '/api/webhooks/calmlens', [], [], [], $headers, $body)->assertNoContent();
        self::assertNull(Cache::get('calmlens-last-event'));
    }
}
