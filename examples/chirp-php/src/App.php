<?php

declare(strict_types=1);

namespace Chirp;

use CalmLens\ServerClient;

/** Chirp's routes. Every page is server-rendered; there is no JavaScript. */
final class App
{
    private const SESSION_COOKIE = 'chirp_session';

    public function __construct(
        private Store $store,
        private Content $content,
        private Webhooks $webhooks,
        private View $view,
        #[\SensitiveParameter] private string $secret,
        private ?Demo $demo = null,
    ) {}

    /**
     * Builds the app from environment variables. Credentials are required unless CHIRP_DEMO=1,
     * so a missing key never silently runs the demo.
     *
     * @param string $origin this app's own origin, for demo-mode CDN URLs
     */
    public static function fromEnvironment(array $env, string $origin, ?\Closure $now = null): self
    {
        $now ??= fn (): int => (int) floor(microtime(true) * 1000);
        $dataDir = rtrim($env['CHIRP_DATA_DIR'] ?? '', '/') ?: dirname(__DIR__) . '/var';
        if (!is_dir($dataDir)) {
            mkdir($dataDir, 0700, true);
        }
        $demo = null;
        if (($env['CHIRP_DEMO'] ?? '') === '1') {
            $demo = new Demo("$dataDir/demo-calmlens.ser", "$origin/demo-cdn/v1", $now);
            $client = $demo->mock->client();
            $projectId = Demo::PROJECT_ID;
            $webhookSecret = Demo::WEBHOOK_SECRET;
        } else {
            $apiKey = $env['CALMLENS_API_KEY'] ?? '';
            $projectId = $env['CALMLENS_PROJECT_ID'] ?? '';
            if ($apiKey === '' || $projectId === '') {
                throw new \RuntimeException('Set CALMLENS_API_KEY and CALMLENS_PROJECT_ID, or CHIRP_DEMO=1 for demo mode');
            }
            // A local CalmLens: CALMLENS_API_URL=http://localhost:6110/v1 CALMLENS_CDN_URL=http://localhost:6130/v1
            $cdnBaseUrl = ($env['CALMLENS_CDN_URL'] ?? '') ?: 'https://cdn.calmlens.com/v1';
            $client = new ServerClient($apiKey, $projectId, baseUrl: ($env['CALMLENS_API_URL'] ?? '') ?: 'https://api.calmlens.com/v1',
                cdnBaseUrl: $cdnBaseUrl, timeout: 30);
            $webhookSecret = $env['CALMLENS_WEBHOOK_SECRET'] ?? '';
        }
        $store = new Store("$dataDir/chirp.json");
        $moderation = new Moderation($client);
        $content = new Content($store, $moderation, $now);
        $secretFile = "$dataDir/secret";
        if (!is_file($secretFile)) {
            file_put_contents($secretFile, bin2hex(random_bytes(32)), LOCK_EX);
        }
        return new self($store, $content, new Webhooks($store, $content, $projectId, $webhookSecret),
            new View($content, $demo !== null), trim((string) file_get_contents($secretFile)), $demo);
    }

    public function handle(Request $request): Response
    {
        try {
            $this->demo?->deliverDue($this->webhooks);
            return $this->route($request);
        } finally {
            $this->demo?->save();
        }
    }

    private function route(Request $request): Response
    {
        $path = $request->path;
        if ($request->method === 'POST' && $path === '/webhooks/calmlens') {
            $status = $this->webhooks->handle($request->body, $request->headers[\CalmLens\Webhooks::SIGNATURE_HEADER] ?? null,
                $request->headers[\CalmLens\Webhooks::TIMESTAMP_HEADER] ?? null);
            return new Response($status);
        }
        if ($this->demo !== null && $request->method === 'GET' && str_starts_with($path, '/demo-cdn/v1/')) {
            [$status, $headers, $body] = $this->demo->serveCdn(substr($path, strlen('/demo-cdn/v1')), $request->query);
            return new Response($status, $body, $headers);
        }
        $viewer = $this->viewer($request);
        if ($request->method === 'POST') {
            if (!hash_equals($this->csrfToken($viewer), (string) ($request->form['csrf'] ?? ''))) {
                return Response::html($this->view->message('That form expired. Go back, reload the page and try again.'), 403);
            }
            return $this->post($request, $viewer);
        }
        if ($request->method !== 'GET') {
            return new Response(405);
        }
        $this->content->refreshPending($viewer['username'] ?? null);
        return $this->page($path, $viewer, $this->csrfToken($viewer)) ?? Response::html($this->view->message('Page not found.'), 404);
    }

    private function page(string $path, ?array $viewer, string $csrf, ?Refused $error = null, array $input = []): ?Response
    {
        $data = $this->store->read();
        $status = $error === null ? 200 : 422;
        if ($path === '/') {
            return Response::html($this->view->home($data, $viewer, $csrf, $error, $input), $status);
        }
        if (preg_match('#^/post/([a-f0-9]{16})$#D', $path, $match)) {
            $post = $data['posts'][$match[1]] ?? null;
            if ($post === null || !Content::isVisibleTo($post, $viewer)) {
                return null;
            }
            return Response::html($this->view->thread($data, $post, $viewer, $csrf, $error, $input), $status);
        }
        if (preg_match('#^/u/([a-z0-9_]{3,20})$#D', $path, $match) && isset($data['users'][$match[1]])) {
            return Response::html($this->view->profile($data, $data['users'][$match[1]], $viewer, $csrf, $error, $input), $status);
        }
        return null;
    }

    private function post(Request $request, ?array $viewer): Response
    {
        $form = $request->form;
        if ($request->path === '/signin') {
            $username = strtolower(trim((string) ($form['username'] ?? '')));
            if (!preg_match('/^[a-z0-9_]{3,20}$/D', $username)) {
                return Response::html($this->view->message('Usernames are 3–20 lowercase letters, numbers or underscores.'), 422);
            }
            $this->store->update(function (array &$data) use ($username) {
                $data['users'][$username] ??= ['username' => $username, 'bio' => '', 'showSensitiveMedia' => false];
            });
            return Response::redirect('/')->withCookie(self::SESSION_COOKIE . '=' . rawurlencode($this->sign($username)) . '; Path=/; HttpOnly; SameSite=Lax');
        }
        if ($viewer === null) {
            return Response::redirect('/');
        }
        $me = $viewer['username'];
        if ($request->path === '/signout') {
            return Response::redirect('/')->withCookie(self::SESSION_COOKIE . '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
        }
        if ($request->path === '/posts') {
            $back = (string) ($form['back'] ?? '/');
            $parentId = isset($form['parentId']) && $form['parentId'] !== '' ? (string) $form['parentId'] : null;
            $data = $this->store->read();
            if ($parentId !== null && !(isset($data['posts'][$parentId]) && Content::isPublished($data['posts'][$parentId]))) {
                return Response::html($this->view->message('That post is no longer available.'), 404);
            }
            $text = (string) ($form['text'] ?? '');
            [$image, $problem] = $this->image($request->files['image'] ?? null);
            if ($problem === null && trim($text) === '' && $image === null) {
                $problem = 'Write something or add an image.';
            }
            if ($problem === null && mb_strlen(trim($text)) > Content::MAX_POST) {
                $problem = 'Posts are at most ' . Content::MAX_POST . ' characters.';
            }
            if ($problem !== null) {
                return Response::html($this->view->message($problem), 422);
            }
            try {
                $post = $this->content->createPost($me, $text, $image, $parentId);
            } catch (Refused $refused) {
                return $this->page($parentId === null ? '/' : "/post/$parentId", $viewer, $this->csrfToken($viewer), $refused, ['text' => $text])
                    ?? Response::html($this->view->message($refused->getMessage()), 422);
            }
            if ($this->demo !== null && $post['image'] !== null) {
                $this->demo->schedule($post['image']['assetId'], (string) ($form['demoOutcome'] ?? 'allowed'));
            }
            return Response::redirect($parentId === null ? ($back === "/u/$me" ? $back : '/') : "/post/$parentId");
        }
        if (preg_match('#^/posts/([a-f0-9]{16})/delete$#D', $request->path, $match)) {
            $parentId = $this->store->read()['posts'][$match[1]]['parentId'] ?? null;
            $this->content->deletePost($me, $match[1]);
            return Response::redirect($parentId === null ? '/' : "/post/$parentId");
        }
        if ($request->path === '/profile/bio') {
            $bio = (string) ($form['bio'] ?? '');
            if (mb_strlen(trim($bio)) > Content::MAX_BIO) {
                return Response::html($this->view->message('Bios are at most ' . Content::MAX_BIO . ' characters.'), 422);
            }
            try {
                $this->content->updateBio($me, $bio);
            } catch (Refused $refused) {
                return $this->page("/u/$me", $viewer, $this->csrfToken($viewer), $refused, ['bio' => $bio]);
            }
            return Response::redirect("/u/$me");
        }
        if ($request->path === '/profile/sensitive') {
            $enable = ($form['show'] ?? '') === '1';
            // The over-18 confirmation is this app's stand-in for a real age check.
            if ($enable && ($form['confirmAdult'] ?? '') !== '1') {
                return Response::html($this->view->message('Confirm that you are 18 or older to show sensitive media.'), 422);
            }
            $this->store->update(function (array &$data) use ($me, $enable) { $data['users'][$me]['showSensitiveMedia'] = $enable; });
            return Response::redirect("/u/$me");
        }
        return Response::html($this->view->message('Page not found.'), 404);
    }

    /** @return array{0: ?array{path: string, type: string}, 1: ?string} the image, or why it was refused */
    private function image(?array $file): array
    {
        if ($file === null) {
            return [null, null];
        }
        if ($file['error'] !== UPLOAD_ERR_OK || $file['path'] === '' || $file['size'] > Content::MAX_IMAGE_BYTES) {
            return [null, 'Images must be at most 10 MB.'];
        }
        // The browser's Content-Type is a claim; check the bytes.
        $type = (new \finfo(FILEINFO_MIME_TYPE))->file($file['path']);
        if (!in_array($type, Content::IMAGE_TYPES, true)) {
            return [null, 'Images must be JPEG, PNG, GIF or WebP.'];
        }
        return [['path' => $file['path'], 'type' => $type], null];
    }

    private function viewer(Request $request): ?array
    {
        $cookie = (string) ($request->cookies[self::SESSION_COOKIE] ?? '');
        $username = strstr($cookie, '.', true);
        if ($username === false || !hash_equals($this->sign($username), $cookie)) {
            return null;
        }
        return $this->store->read()['users'][$username] ?? null;
    }

    private function sign(string $username): string
    {
        return $username . '.' . hash_hmac('sha256', "session|$username", $this->secret);
    }

    private function csrfToken(?array $viewer): string
    {
        return hash_hmac('sha256', 'csrf|' . ($viewer['username'] ?? ''), $this->secret);
    }
}
