<?php

declare(strict_types=1);

namespace Chirp;

use CalmLens\CalmLensException;
use CalmLens\ServerClient;

/**
 * Every CalmLens call Chirp makes. The pattern:
 *   text (posts, replies, bios) → classify synchronously, refuse to save unless allowed
 *   images                      → upload, mark pending, resolve by webhook or polling
 * Demo mode passes the SDK's MockServerClient here; nothing else changes.
 */
final class Moderation
{
    /** Statuses that are decisions. Anything else CalmLens may add later is treated as pending. */
    public const DECIDED = ['allowed', 'limited', 'age-restricted', 'blocked', 'purged'];

    // Lenses are named, versioned CDN transformations. Bump `version` when you change one.
    private const FEED_LENS = [
        'identifier' => 'chirp-feed', 'name' => 'Chirp timeline image', 'description' => null,
        'type' => 'image', 'active' => true, 'version' => 1,
        'transforms' => [['type' => 'imageTransform', 'options' => ['fit' => 'scale-down', 'width' => 1200, 'format' => 'webp']]],
    ];

    public function __construct(public readonly ServerClient $client) {}

    /**
     * Classifies text and waits for the decision, which is fast for short text. CalmLens doesn't
     * keep the text after classifying it by default; Chirp's own storage has it.
     */
    public function moderateText(string $text, string $kind, string $externalId, string $username): array
    {
        $asset = $this->client->text->classify([
            'name' => "$kind-$externalId",
            'externalId' => $externalId,
            'metadata' => [['id' => 'chirp.kind', 'value' => $kind], ['id' => 'chirp.username', 'value' => $username]],
            'text' => $text,
        ]);
        return self::outcome($asset);
    }

    /** Queues an image and returns at once, before a decision. The SDK streams the file. */
    public function submitImage(string $path, string $type, string $externalId, string $username): array
    {
        $this->client->ensureLens(self::FEED_LENS);
        $file = fopen($path, 'rb');
        try {
            $asset = $this->client->assets->create([
                'name' => $externalId . '.' . explode('/', $type)[1],
                'externalId' => $externalId,
                'content' => ['data' => $file, 'type' => $type],
                // Public so allowed images are served straight from the CDN. The CDN serves a
                // public asset while it is pending, so Chirp never shows its URL until it is decided.
                'visibility' => 'public',
                'metadata' => [['id' => 'chirp.kind', 'value' => 'post-image'], ['id' => 'chirp.username', 'value' => $username]],
                'processingOptions' => ['keepContentAfterProcessing' => true, 'features' => ['ocr' => ['enabled' => true]]],
            ]);
        } finally {
            fclose($file);
        }
        return self::outcome($asset);
    }

    public function checkAsset(string $assetId): array
    {
        return self::outcome($this->client->assets->retrieve(['assetId' => $assetId]));
    }

    /**
     * Only for allowed images, or with `$ageConfirmed` for age-restricted images this viewer may
     * see. The CDN refuses an age-restricted asset's plain URL; `viewerClaims.ageConfirmed=true` opts in.
     */
    public function imageUrl(string $assetId, bool $ageConfirmed = false): string
    {
        // The unguessable asset ID, not the externalId: post IDs appear in Chirp's own URLs.
        return $this->client->cdn->getAssetUrl(['assetIdentifier' => $assetId, 'lens' => 'chirp-feed', ...($ageConfirmed ? ['viewerClaims' => ['ageConfirmed' => true]] : [])]);
    }

    /** A small blurred PNG of the image, public whatever the asset's visibility or status (not purged). */
    public function placeholderUrl(string $assetId): string
    {
        return $this->client->cdn->getAssetUrl(['assetIdentifier' => $assetId, 'resource' => 'placeholder']);
    }

    public function deleteAsset(string $assetId): void
    {
        try {
            $this->client->assets->delete(['assetId' => $assetId]);
        } catch (CalmLensException $error) {
            // Already gone, for example deleted in the portal: nothing left to remove.
            if ($error->status !== 404) {
                throw $error;
            }
        }
    }

    /**
     * Chirp's view of an asset: its moderation status (or `error` when processing failed) and the
     * evaluated categories, highest score first.
     */
    public static function outcome(array $asset): array
    {
        $classification = $asset['classification'] ?? [];
        $status = $classification['moderation']['status'] ?? null;
        $findings = [];
        foreach ($classification['moderation']['categories'] ?? [] as $category => $result) {
            // `not-evaluated` means unknown, not safe: never read it as a zero score.
            if (is_array($result) && in_array($result['status'] ?? null, ['evaluated', 'partial'], true) && is_numeric($result['score'] ?? null)) {
                $findings[] = ['category' => (string) $category, 'score' => (float) $result['score']];
            }
        }
        usort($findings, fn ($a, $b) => $b['score'] <=> $a['score']);
        return [
            'assetId' => (string) $asset['id'],
            'externalId' => $asset['externalId'] ?? null,
            'status' => ($classification['status'] ?? null) === 'failed' ? 'error' : (in_array($status, self::DECIDED, true) ? $status : 'pending'),
            'findings' => $findings,
        ];
    }

    /** Category IDs that scored at least 0.5, for telling an author why. */
    public static function flaggedCategories(array $findings): array
    {
        return array_values(array_map(fn ($finding) => $finding['category'],
            array_filter($findings, fn ($finding) => $finding['score'] >= 0.5)));
    }
}
