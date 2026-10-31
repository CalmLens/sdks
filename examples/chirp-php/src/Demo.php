<?php

declare(strict_types=1);

namespace Chirp;

use CalmLens\Testing\MockServerClient;
use CalmLens\Webhooks as CalmLensWebhooks;

/**
 * Demo mode: the SDK's offline MockServerClient stands in for CalmLens, so you can click around
 * without an account. The live code path never loads this class. It is NOT a moderation model:
 *   • text is checked against a handful of obvious phrases, so typing one shows a refusal
 *   • images get the outcome chosen in the compose form, delivered about two seconds later as a
 *     signed webhook through the same handler live mode uses
 * The mock's state is saved between requests, since PHP starts fresh for each one.
 */
final class Demo
{
    public const PROJECT_ID = 'chirp-demo';
    public const WEBHOOK_SECRET = 'chirp-demo-webhook-secret';
    public const IMAGE_OUTCOMES = ['allowed', 'limited', 'age-restricted', 'blocked', 'purged', 'failed'];
    private const DECISION_DELAY_MS = 2000;

    // [pattern, category, score]. Scores of 0.8 or more stand in for a policy match: sexual
    // content is age-restricted, as the General community policy does, and the rest is blocked.
    private const TEXT_RULES = [
        ['/\b(i(\'| wi)ll|gonna) (kill|hurt) you\b/i', 'violence', 0.93],
        ['/\bkys\b|\bkill yourself\b/i', 'harassment', 0.96],
        ['/\b(idiot|loser|moron)\b/i', 'harassment', 0.66],
        ['/\b(buy|selling) (drugs|meth|cocaine)\b/i', 'criminal-activity', 0.88],
        ['/\bnsfw\b/i', 'sexual', 0.9],
    ];

    public readonly MockServerClient $mock;
    /** @var array<string, array{outcome: string, dueAt: int}> image decisions still to deliver */
    private array $scheduled = [];

    public function __construct(private string $statePath, string $cdnBaseUrl, private \Closure $now)
    {
        $this->mock = new MockServerClient(projectId: self::PROJECT_ID, analyzedOutcome: $this->classifyText(...),
            now: $now, cdnBaseUrl: $cdnBaseUrl);
        if (is_file($statePath)) {
            $state = unserialize((string) file_get_contents($statePath), ['allowed_classes' => false]);
            if (is_array($state)) {
                [$this->mock->assets, $this->mock->content, $this->mock->events, $this->mock->lenses, $this->scheduled] = $state;
            }
        }
    }

    public function save(): void
    {
        $state = [$this->mock->assets, $this->mock->content, $this->mock->events, $this->mock->lenses, $this->scheduled];
        file_put_contents($this->statePath, serialize($state), LOCK_EX);
    }

    /**
     * The mock's stand-in for classification: category scores from the phrase rules. The mock
     * still holds the uploaded text when it asks for the outcome.
     */
    private function classifyText(array $asset): array
    {
        return ['classification' => ['moderation' => self::scores($this->mock->content[$asset['id']]['bytes'] ?? '')]];
    }

    private static function scores(string $text): array
    {
        $hit = null;
        foreach (self::TEXT_RULES as [$pattern, $category, $score]) {
            if (preg_match($pattern, $text)) {
                $hit = [$category, $score];
                break;
            }
        }
        $categories = [];
        foreach (array_keys(Labels::CATEGORIES) as $category) {
            $categories[$category] = ['status' => 'evaluated', 'score' => $hit !== null && $hit[0] === $category ? $hit[1] : 0.01];
        }
        $status = $hit === null || $hit[1] < 0.8 ? 'allowed' : ($hit[0] === 'sexual' ? 'age-restricted' : 'blocked');
        return ['status' => $status, 'categories' => $categories];
    }

    /** Decides an uploaded image a little later, as CalmLens would after processing it. */
    public function schedule(string $assetId, string $outcome): void
    {
        $this->scheduled[$assetId] = ['outcome' => in_array($outcome, self::IMAGE_OUTCOMES, true) ? $outcome : 'allowed',
            'dueAt' => ($this->now)() + self::DECISION_DELAY_MS];
    }

    /** Delivers due decisions as signed webhooks through Chirp's real webhook handler. */
    public function deliverDue(Webhooks $webhooks): void
    {
        foreach ($this->scheduled as $assetId => $decision) {
            if ($decision['dueAt'] > ($this->now)()) {
                continue;
            }
            unset($this->scheduled[$assetId]);
            if (!isset($this->mock->assets[$assetId])) {
                continue;
            }
            // The category a real classification would have scored, so the author sees a reason.
            $category = ['age-restricted' => 'sexual', 'blocked' => 'violence', 'purged' => 'violence'][$decision['outcome']] ?? null;
            if ($category !== null) {
                $this->mock->assets[$assetId]['classification']['moderation']['categories'] = [$category => ['status' => 'evaluated', 'score' => 0.95]];
            }
            $this->mock->decide($assetId, $decision['outcome']);
            $event = end($this->mock->events);
            $body = json_encode(CalmLensWebhooks::toPayload($event), JSON_THROW_ON_ERROR);
            $timestamp = (string) intdiv(($this->now)(), 1000);
            $webhooks->handle($body, CalmLensWebhooks::signatureHeader($body, $timestamp, self::WEBHOOK_SECRET), $timestamp);
        }
    }

    /**
     * Serves `/demo-cdn/v1/assets/<project>/<asset>/<resource>…` as the CDN would serve a browser
     * (no API key): the mock refuses blocked assets and age-restricted ones without the opt-in.
     *
     * @return array{int, array<string, string>, string}
     */
    public function serveCdn(string $path, array $query): array
    {
        $parts = array_map('rawurldecode', explode('/', trim($path, '/')));
        [$assets, $project, $assetId, $resource] = $parts + ['', '', '', ''];
        if ($assets !== 'assets' || $project !== self::PROJECT_ID) {
            return [404, ['Content-Type' => 'text/plain'], 'Not found'];
        }
        if ($resource === 'placeholder') {
            return $this->placeholder($assetId);
        }
        $this->mock->downloadPermission = false;
        $response = $this->mock->client()->cdn->serve(['assetIdentifier' => $assetId, 'resource' => $resource === 'original' ? 'original' : 'rendered',
            'viewerClaims' => json_decode($query['viewerClaims'] ?? '{}', true, 512, JSON_THROW_ON_ERROR)]);
        return [$response->getStatusCode(), ['Content-Type' => $response->getHeaderLine('Content-Type'),
            'Cache-Control' => $response->getHeaderLine('Cache-Control') ?: 'no-store'], (string) $response->getBody()];
    }

    /** Stands in for CalmLens's ThumbHash placeholder: the image shrunk to a few pixels. */
    private function placeholder(string $assetId): array
    {
        $asset = $this->mock->assets[$assetId] ?? null;
        $bytes = $this->mock->content[$assetId]['bytes'] ?? null;
        if ($asset === null || $asset['visibility'] !== 'public' || $asset['classification']['moderation']['status'] === 'purged' || $bytes === null) {
            return [403, ['Content-Type' => 'text/plain'], 'Asset is not available'];
        }
        $image = function_exists('imagecreatefromstring') ? @imagecreatefromstring($bytes) : false;
        if ($image === false) {
            $image = imagecreatetruecolor(1, 1);
            imagefill($image, 0, 0, imagecolorallocate($image, 160, 160, 160));
        }
        $small = imagescale($image, 6, max(1, (int) round(6 * imagesy($image) / max(1, imagesx($image)))));
        ob_start();
        imagepng($small);
        return [200, ['Content-Type' => 'image/png', 'Cache-Control' => 'public, max-age=3600'], (string) ob_get_clean()];
    }
}
