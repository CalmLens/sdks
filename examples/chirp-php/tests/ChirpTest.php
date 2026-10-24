<?php

declare(strict_types=1);

use CalmLens\Testing\MockServerClient;
use CalmLens\Webhooks as CalmLensWebhooks;
use Chirp\App;
use Chirp\Content;
use Chirp\Moderation;
use Chirp\Request;
use Chirp\Response;
use Chirp\Store;
use Chirp\View;
use Chirp\Webhooks;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ChirpTest extends TestCase
{
    private const CDN = 'https://cdn.calmlens.invalid/v1';
    private const SECRET = 'webhook-secret';

    private string $dir;
    private int $time = 1_760_000_000_000;
    private MockServerClient $mock;
    private App $app;
    private array $cookies = [];

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/chirp-test-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
        $this->mock = new MockServerClient(projectId: 'project-1', analyzedOutcome: function (array $asset) {
            // The mock still holds the text while it asks for the outcome.
            $text = $this->mock->content[$asset['id']]['bytes'] ?? '';
            return match (true) {
                str_contains($text, 'rude') => self::scored('blocked', 'harassment'),
                str_contains($text, 'spicy') => self::scored('age-restricted', 'sexual'),
                str_contains($text, 'later') => 'pending',
                default => self::scored('allowed', null),
            };
        }, now: fn () => $this->time);
        $this->app = $this->build($this->mock);
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
    }

    private function build(MockServerClient $mock): App
    {
        $store = new Store($this->dir . '/chirp.json');
        $now = fn () => $this->time;
        $content = new Content($store, new Moderation($mock->client(), self::CDN), $now);
        return new App($store, $content, new Webhooks($store, $content, 'project-1', self::SECRET), new View($content, false), 'app-secret');
    }

    private static function scored(string $status, ?string $category): array
    {
        $categories = [];
        foreach (['sexual', 'violence', 'harassment'] as $name) {
            $categories[$name] = ['status' => 'evaluated', 'score' => $name === $category ? 0.92 : 0.02];
        }
        return ['classification' => ['moderation' => ['status' => $status, 'categories' => $categories]]];
    }

    private function request(string $method, string $path, array $form = [], array $files = [], array $headers = [], string $body = ''): Response
    {
        if ($method === 'POST' && $path !== '/webhooks/calmlens') {
            $form += ['csrf' => $this->csrf()];
        }
        $response = $this->app->handle(new Request($method, $path, [], $form, $files, $this->cookies, $headers, $body));
        foreach ((array) ($response->headers['Set-Cookie'] ?? []) as $cookie) {
            [$pair] = explode(';', $cookie, 2);
            [$name, $value] = explode('=', $pair, 2);
            $this->cookies[$name] = rawurldecode($value);
        }
        return $response;
    }

    private function csrf(): string
    {
        $page = $this->app->handle(new Request('GET', '/', cookies: $this->cookies))->body;
        preg_match('/name="csrf" value="([a-f0-9]+)"/', $page, $match);
        return $match[1];
    }

    private function signIn(string $username): void
    {
        $this->cookies = [];
        self::assertSame(303, $this->request('POST', '/signin', ['username' => $username])->status);
    }

    private function image(): array
    {
        $path = $this->dir . '/upload.png';
        $png = imagecreatetruecolor(4, 3);
        imagepng($png, $path);
        return ['image' => ['path' => $path, 'size' => filesize($path), 'error' => UPLOAD_ERR_OK]];
    }

    private function posts(): array
    {
        return (new Store($this->dir . '/chirp.json'))->read()['posts'];
    }

    private function onlyPost(): array
    {
        $posts = $this->posts();
        self::assertCount(1, $posts);
        return reset($posts);
    }

    /** @return list<string> the post IDs this page shows */
    private static function shown(Response $page): array
    {
        preg_match_all('/data-post-id="([a-f0-9]+)"/', $page->body, $matches);
        return $matches[1];
    }

    private static function imageSources(Response $page): array
    {
        preg_match_all('/<img[^>]* src="([^"]+)"/', $page->body, $matches);
        return array_map(fn ($src) => html_entity_decode($src), $matches[1]);
    }

    private function deliver(array $event): Response
    {
        $body = json_encode($event + ['createdAt' => $this->time, 'projectId' => 'project-1']);
        $timestamp = (string) time();
        return $this->request('POST', '/webhooks/calmlens', headers: [
            'x-calmlens-signature' => CalmLensWebhooks::signatureHeader($body, $timestamp, self::SECRET), 'x-calmlens-timestamp' => $timestamp,
        ], body: $body);
    }

    /** Posts an image as alice and decides it as CalmLens would, then delivers the status event. */
    private function postDecidedImage(string $outcome): array
    {
        $this->signIn('alice');
        $this->request('POST', '/posts', ['text' => 'Look at this'], $this->image());
        $post = $this->onlyPost();
        $this->mock->decide($post['image']['assetId'], $outcome);
        $type = $outcome === 'failed' ? 'asset.failed' : "asset.$outcome";
        self::assertSame(204, $this->deliver(['id' => "delivery-$outcome", 'type' => $type, 'data' => ['assetId' => $post['image']['assetId'], 'facts' => []]])->status);
        return $this->onlyPost();
    }

    public function testAllowedTextPostIsSavedAndShownToEveryone(): void
    {
        $this->signIn('alice');
        self::assertSame(303, $this->request('POST', '/posts', ['text' => 'Hello, Chirp'])->status);
        $post = $this->onlyPost();
        self::assertSame('Hello, Chirp', $this->mock->requests()[array_key_last($this->mock->requests())]->getBody()->__toString());
        $this->cookies = [];
        self::assertSame([$post['id']], self::shown($this->request('GET', '/')));
        self::assertSame(200, $this->request('GET', '/post/' . $post['id'])->status);
    }

    public static function refusedText(): iterable
    {
        yield 'blocked' => ['so rude', 'harassment'];
        yield 'age-restricted' => ['spicy', 'sexual'];
        yield 'pending' => ['decide later', ''];
    }

    #[DataProvider('refusedText')]
    public function testTextThatIsNotAllowedIsRefusedWithItsReason(string $text, string $categories): void
    {
        $this->signIn('alice');
        $response = $this->request('POST', '/posts', ['text' => $text]);
        self::assertSame(422, $response->status);
        self::assertMatchesRegularExpression('/role="alert" data-categories="' . $categories . '"/', $response->body);
        self::assertSame([], $this->posts());
    }

    public function testRefusedTextSkipsTheImageUpload(): void
    {
        $this->signIn('alice');
        self::assertSame(422, $this->request('POST', '/posts', ['text' => 'so rude'], $this->image())->status);
        self::assertSame(['text/plain'], array_values(array_map(fn ($asset) => $asset['content']['format'], $this->mock->assets)));
    }

    public function testModerationOutageRefusesThePost(): void
    {
        $this->mock->enqueueJson(['code' => 'server/unavailable', 'message' => 'Try again'], 503);
        $this->signIn('alice');
        $response = $this->request('POST', '/posts', ['text' => 'Hello']);
        self::assertSame(422, $response->status);
        self::assertStringContainsString('role="alert" data-categories=""', $response->body);
        self::assertSame([], $this->posts());
    }

    public function testRepliesAndBiosAreModerated(): void
    {
        $this->signIn('alice');
        $this->request('POST', '/posts', ['text' => 'Hello']);
        $post = $this->onlyPost();
        $this->signIn('bob');
        self::assertSame(422, $this->request('POST', '/posts', ['text' => 'so rude', 'parentId' => $post['id']])->status);
        self::assertSame(303, $this->request('POST', '/posts', ['text' => 'Hi back', 'parentId' => $post['id']])->status);
        $reply = array_values(array_filter($this->posts(), fn ($item) => $item['parentId'] === $post['id']));
        self::assertCount(1, $reply);
        self::assertContains($reply[0]['id'], self::shown($this->request('GET', '/post/' . $post['id'])));
        self::assertNotContains($reply[0]['id'], self::shown($this->request('GET', '/')));

        self::assertSame(422, $this->request('POST', '/profile/bio', ['bio' => 'rude bio'])->status);
        self::assertSame(303, $this->request('POST', '/profile/bio', ['bio' => 'I like birds'])->status);
        $users = (new Store($this->dir . '/chirp.json'))->read()['users'];
        self::assertSame('I like birds', $users['bob']['bio']);
        self::assertSame(['text/plain'], array_values(array_unique(array_map(fn ($asset) => $asset['content']['format'], $this->mock->assets))));
    }

    public function testPendingImageIsVisibleOnlyToItsAuthorWithoutAnImageUrl(): void
    {
        $this->signIn('alice');
        self::assertSame(303, $this->request('POST', '/posts', ['text' => 'Look'], $this->image())->status);
        $post = $this->onlyPost();
        self::assertSame('pending', $post['image']['status']);
        $asset = $this->mock->assets[$post['image']['assetId']];
        self::assertSame(['public', 'post-' . $post['id'], 'image/png'], [$asset['visibility'], $asset['externalId'], $asset['content']['format']]);
        $own = $this->request('GET', '/');
        self::assertSame([$post['id']], self::shown($own));
        self::assertSame([], self::imageSources($own));
        $this->signIn('bob');
        self::assertSame([], self::shown($this->request('GET', '/')));
        self::assertSame(404, $this->request('GET', '/post/' . $post['id'])->status);
    }

    public function testAllowedImageIsShownFromTheCdn(): void
    {
        $post = $this->postDecidedImage('allowed');
        self::assertSame('allowed', $post['image']['status']);
        $this->signIn('bob');
        $page = $this->request('GET', '/');
        self::assertSame([$post['id']], self::shown($page));
        self::assertSame([self::CDN . '/assets/project-1/' . $post['image']['assetId'] . '/content/@chirp-feed'], self::imageSources($page));
    }

    public function testAgeRestrictedImageShowsThePlaceholderUntilTheViewerOptsIn(): void
    {
        $post = $this->postDecidedImage('age-restricted');
        $assetId = $post['image']['assetId'];
        $placeholder = [self::CDN . "/assets/project-1/$assetId/placeholder"];
        $this->cookies = [];
        self::assertSame($placeholder, self::imageSources($this->request('GET', '/')));
        $this->signIn('bob');
        self::assertSame($placeholder, self::imageSources($this->request('GET', '/')));
        self::assertSame(422, $this->request('POST', '/profile/sensitive', ['show' => '1'])->status);
        self::assertSame($placeholder, self::imageSources($this->request('GET', '/')));
        self::assertSame(303, $this->request('POST', '/profile/sensitive', ['show' => '1', 'confirmAdult' => '1'])->status);
        $url = self::CDN . "/assets/project-1/$assetId/content/@chirp-feed?ageRestricted=true";
        self::assertSame([$url], self::imageSources($this->request('GET', '/')));
        self::assertSame(303, $this->request('POST', '/profile/sensitive', ['show' => '0'])->status);
        self::assertSame($placeholder, self::imageSources($this->request('GET', '/')));
    }

    public static function removed(): iterable
    {
        yield ['blocked'];
        yield ['purged'];
        yield ['failed'];
    }

    #[DataProvider('removed')]
    public function testBlockedPurgedOrFailedImagesLeaveTheTimelineAndTheAuthorSeesWhy(string $outcome): void
    {
        $this->mock->assets = [];
        $post = $this->postDecidedImage($outcome);
        self::assertSame($outcome === 'failed' ? 'error' : $outcome, $post['image']['status']);
        $own = $this->request('GET', '/');
        self::assertSame([$post['id']], self::shown($own));
        self::assertSame([], self::imageSources($own));
        self::assertMatchesRegularExpression('/class="notice" role="status"/', $own->body);
        $this->signIn('bob');
        self::assertSame([], self::shown($this->request('GET', '/')));
        self::assertSame([], self::shown($this->request('GET', '/u/alice')));
    }

    public function testRemovalNoticeNamesTheFlaggedCategories(): void
    {
        $this->signIn('alice');
        $this->request('POST', '/posts', ['text' => 'Look'], $this->image());
        $post = $this->onlyPost();
        $assetId = $post['image']['assetId'];
        $this->mock->assets[$assetId]['classification']['moderation']['categories'] = ['violence' => ['status' => 'evaluated', 'score' => 0.97], 'sexual' => ['status' => 'not-evaluated']];
        $this->mock->decide($assetId, 'blocked');
        $this->deliver(['id' => 'd-1', 'type' => 'asset.blocked', 'data' => ['assetId' => $assetId, 'facts' => []]]);
        self::assertStringContainsString('class="notice" role="status" data-categories="violence"', $this->request('GET', '/')->body);
    }

    public function testPollingAppliesADecisionWhenNoWebhookArrives(): void
    {
        $this->signIn('alice');
        $this->request('POST', '/posts', ['text' => 'Look'], $this->image());
        $post = $this->onlyPost();
        $this->mock->decide($post['image']['assetId'], 'allowed');
        $this->request('GET', '/');
        self::assertSame('pending', $this->onlyPost()['image']['status'], 'rechecked too soon');
        $this->time += 5000;
        $this->request('GET', '/');
        self::assertSame('allowed', $this->onlyPost()['image']['status']);
    }

    public function testWebhooksAreVerifiedDeduplicatedAndScopedToTheirPost(): void
    {
        $this->signIn('alice');
        $this->request('POST', '/posts', ['text' => 'Look'], $this->image());
        $post = $this->onlyPost();
        $assetId = $post['image']['assetId'];
        $event = ['id' => 'delivery-1', 'type' => 'asset.allowed', 'createdAt' => $this->time, 'projectId' => 'project-1', 'data' => ['assetId' => $assetId, 'facts' => []]];
        $body = json_encode($event);
        $timestamp = (string) time();
        $signature = CalmLensWebhooks::signatureHeader($body, $timestamp, self::SECRET);
        $this->mock->decide($assetId, 'allowed');
        $tampered = $this->request('POST', '/webhooks/calmlens', headers: ['x-calmlens-signature' => $signature, 'x-calmlens-timestamp' => $timestamp], body: $body . ' ');
        self::assertSame(401, $tampered->status);
        self::assertSame('pending', $this->onlyPost()['image']['status']);

        // A test send changes nothing.
        $this->deliver(['id' => 'test', 'type' => 'asset.allowed', 'data' => ['assetId' => $assetId, 'facts' => [['key' => 'test', 'value' => true]]]]);
        self::assertSame('pending', $this->onlyPost()['image']['status']);

        // Another project's delivery is refused.
        $other = json_encode(['projectId' => 'project-2'] + $event);
        self::assertSame(403, $this->request('POST', '/webhooks/calmlens', headers: ['x-calmlens-signature' => CalmLensWebhooks::signatureHeader($other, $timestamp, self::SECRET), 'x-calmlens-timestamp' => $timestamp], body: $other)->status);

        self::assertSame(204, $this->request('POST', '/webhooks/calmlens', headers: ['x-calmlens-signature' => $signature, 'x-calmlens-timestamp' => $timestamp], body: $body)->status);
        self::assertSame('allowed', $this->onlyPost()['image']['status']);

        // A repeated delivery is acknowledged without fetching the asset again.
        $retrievals = fn () => count(array_filter($this->mock->requests(),
            fn ($request) => $request->getMethod() === 'GET' && str_ends_with($request->getUri()->getPath(), '/assets/' . $assetId)));
        $before = $retrievals();
        self::assertSame(204, $this->request('POST', '/webhooks/calmlens', headers: ['x-calmlens-signature' => $signature, 'x-calmlens-timestamp' => $timestamp], body: $body)->status);
        self::assertSame($before, $retrievals());
    }

    public function testRepeatedDeliveryDoesNotReapplyAndForeignAssetsAreIgnored(): void
    {
        $this->signIn('alice');
        $this->request('POST', '/posts', ['text' => 'Look'], $this->image());
        $assetId = $this->onlyPost()['image']['assetId'];
        $this->mock->decide($assetId, 'allowed');
        $this->deliver(['id' => 'delivery-1', 'type' => 'asset.allowed', 'data' => ['assetId' => $assetId, 'facts' => []]]);
        $this->mock->decide($assetId, 'blocked');
        $this->deliver(['id' => 'delivery-1', 'type' => 'asset.allowed', 'data' => ['assetId' => $assetId, 'facts' => []]]);
        self::assertSame('allowed', $this->onlyPost()['image']['status']);

        // An asset whose externalId names another post never changes this one.
        $this->mock->assets[$assetId]['externalId'] = 'post-0000000000000000';
        $this->deliver(['id' => 'delivery-2', 'type' => 'asset.blocked', 'data' => ['assetId' => $assetId, 'facts' => []]]);
        self::assertSame('allowed', $this->onlyPost()['image']['status']);
    }

    public function testWebhookOutageIsRetriedLater(): void
    {
        $this->signIn('alice');
        $this->request('POST', '/posts', ['text' => 'Look'], $this->image());
        $assetId = $this->onlyPost()['image']['assetId'];
        $this->mock->decide($assetId, 'blocked');
        $this->mock->enqueueJson(['code' => 'server/unavailable', 'message' => 'Try again'], 503);
        $event = ['id' => 'delivery-1', 'type' => 'asset.blocked', 'data' => ['assetId' => $assetId, 'facts' => []]];
        self::assertSame(503, $this->deliver($event)->status);
        self::assertSame(204, $this->deliver($event)->status);
        self::assertSame('blocked', $this->onlyPost()['image']['status']);
    }

    public function testDeletingAPostDeletesItsImageOnCalmLens(): void
    {
        $post = $this->postDecidedImage('allowed');
        self::assertSame(303, $this->request('POST', '/posts/' . $post['id'] . '/delete')->status);
        self::assertSame([], $this->posts());
        self::assertArrayNotHasKey($post['image']['assetId'], $this->mock->assets);
    }

    public function testFormsNeedTheCsrfToken(): void
    {
        $this->signIn('alice');
        $response = $this->app->handle(new Request('POST', '/posts', form: ['text' => 'Hello', 'csrf' => 'forged'], cookies: $this->cookies));
        self::assertSame(403, $response->status);
        self::assertSame([], $this->posts());
    }

    public function testLiveModeNeedsCredentials(): void
    {
        $this->expectException(RuntimeException::class);
        App::fromEnvironment(['CHIRP_DATA_DIR' => $this->dir], 'http://127.0.0.1:6407');
    }

    public function testDemoModeDeliversTheChosenOutcomeAndItsCdnFollowsTheDeliveryRules(): void
    {
        $this->app = App::fromEnvironment(['CHIRP_DEMO' => '1', 'CHIRP_DATA_DIR' => $this->dir], 'http://127.0.0.1:6407', fn () => $this->time);
        $this->signIn('alice');
        self::assertSame(422, $this->request('POST', '/posts', ['text' => 'kys'])->status);
        $this->request('POST', '/posts', ['text' => 'Look', 'demoOutcome' => 'age-restricted'], $this->image());
        $post = $this->onlyPost();
        $assetId = $post['image']['assetId'];
        $this->time += 3000;
        $page = $this->request('GET', '/');
        self::assertSame('age-restricted', $this->onlyPost()['image']['status']);
        $base = 'http://127.0.0.1:6407/demo-cdn/v1/assets/chirp-demo/' . $assetId;
        self::assertSame(["$base/placeholder"], self::imageSources($page));
        self::assertSame(403, $this->request('GET', "/demo-cdn/v1/assets/chirp-demo/$assetId/content/@chirp-feed")->status);
        $optedIn = $this->app->handle(new Request('GET', "/demo-cdn/v1/assets/chirp-demo/$assetId/content/@chirp-feed", ['ageRestricted' => 'true']));
        self::assertSame([200, 'image/png'], [$optedIn->status, $optedIn->headers['Content-Type']]);
        $placeholder = $this->request('GET', "/demo-cdn/v1/assets/chirp-demo/$assetId/placeholder");
        self::assertSame([200, 'image/png'], [$placeholder->status, $placeholder->headers['Content-Type']]);
    }
}
