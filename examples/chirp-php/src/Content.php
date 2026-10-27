<?php

declare(strict_types=1);

namespace Chirp;

use CalmLens\CalmLensException;

/** All of Chirp's moderation rules: what is saved, who sees it, and which image URL they get. */
final class Content
{
    public const MAX_POST = 280;
    public const MAX_BIO = 160;
    public const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    public const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    // Polling fallback for missed webhooks: pending images are re-checked at most this often.
    private const RECHECK_AFTER_MS = 2000;

    public function __construct(private Store $store, private Moderation $moderation, private \Closure $now) {}

    public static function newId(): string { return bin2hex(random_bytes(8)); }

    /** The externalId an image asset is created with; a decision applies only to the post it names. */
    public static function imageExternalId(string $postId): string { return "post-$postId"; }

    /**
     * Checks the text first (it is quick, and a refusal skips the upload), then queues the image.
     * The post is saved only when its text is allowed; its image stays pending, visible only to its
     * author, until CalmLens decides.
     *
     * @param array{path: string, type: string}|null $image
     */
    public function createPost(string $author, string $text, ?array $image, ?string $parentId): array
    {
        $id = self::newId();
        $what = $parentId === null ? 'post' : 'reply';
        $text = trim($text);
        if ($text !== '') {
            $this->checkText($text, $what, "$what-text-$id", $author);
        }
        $outcome = null;
        if ($image !== null) {
            try {
                $outcome = $this->moderation->submitImage($image['path'], $image['type'], self::imageExternalId($id), $author);
            } catch (CalmLensException $error) {
                error_log('[chirp] image upload failed: ' . $error->errorCode);
                throw new Refused($what, [], unavailable: true);
            }
        }
        $now = ($this->now)();
        $post = ['id' => $id, 'author' => $author, 'text' => $text, 'parentId' => $parentId, 'createdAt' => $now,
            'image' => $outcome === null ? null : ['assetId' => $outcome['assetId'], 'status' => $outcome['status'],
                'findings' => $outcome['findings'], 'checkedAt' => $now]];
        $this->store->update(function (array &$data) use ($post) { $data['posts'][$post['id']] = $post; });
        return $post;
    }

    public function updateBio(string $username, string $bio): void
    {
        $bio = trim($bio);
        if ($bio !== '') {
            $this->checkText($bio, 'bio', "bio-$username-" . self::newId(), $username);
        }
        $this->store->update(function (array &$data) use ($username, $bio) { $data['users'][$username]['bio'] = $bio; });
    }

    /**
     * Text has no sensitive view: anything that isn't `allowed` or `limited` is refused and never
     * saved. Limited text is shown like allowed text; Chirp's feed has no recommendations to keep it out of.
     */
    private function checkText(string $text, string $what, string $externalId, string $username): void
    {
        try {
            $outcome = $this->moderation->moderateText($text, $what, $externalId, $username);
        } catch (CalmLensException $error) {
            // Fail closed: never save text CalmLens hasn't allowed.
            error_log('[chirp] text moderation failed: ' . $error->errorCode);
            throw new Refused($what, [], unavailable: true);
        }
        if (!in_array($outcome['status'], ['allowed', 'limited'], true)) {
            throw new Refused($what, Moderation::flaggedCategories($outcome['findings']));
        }
    }

    /**
     * Applies an asset's current outcome to the post it was created for. Called from the webhook
     * handler and the polling fallback. Returns the updated post, or null when nothing matched.
     */
    public function syncAsset(string $assetId, ?array $outcome = null): ?array
    {
        $postId = $this->postIdForAsset($assetId);
        if ($postId === null) {
            return null;
        }
        $outcome ??= $this->moderation->checkAsset($assetId);
        return $this->store->update(function (array &$data) use ($postId, $outcome) {
            $post = $data['posts'][$postId] ?? null;
            // Only the asset this post created, checked by ID and by the externalId we gave it.
            if ($post === null || $post['image']['assetId'] !== $outcome['assetId']
                || ($outcome['externalId'] !== null && $outcome['externalId'] !== self::imageExternalId($postId))) {
                error_log("[chirp] ignoring a decision for another record: post $postId");
                return null;
            }
            $post['image'] = ['status' => $outcome['status'], 'findings' => $outcome['findings'], 'checkedAt' => ($this->now)()] + $post['image'];
            return $data['posts'][$postId] = $post;
        });
    }

    /** Re-checks this author's pending images that haven't been checked for a while. */
    public function refreshPending(?string $viewer): void
    {
        if ($viewer === null) {
            return;
        }
        $now = ($this->now)();
        foreach ($this->store->read()['posts'] as $post) {
            if ($post['author'] === $viewer && ($post['image']['status'] ?? null) === 'pending' && $now - $post['image']['checkedAt'] > self::RECHECK_AFTER_MS) {
                try {
                    $this->syncAsset($post['image']['assetId']);
                } catch (CalmLensException $error) {
                    error_log('[chirp] polling failed: ' . $error->errorCode);
                }
            }
        }
    }

    /** Deletes the author's post, its replies and their images on CalmLens (users expect them gone). */
    public function deletePost(string $author, string $postId): bool
    {
        $doomed = $this->store->update(function (array &$data) use ($author, $postId) {
            if (($data['posts'][$postId]['author'] ?? null) !== $author) {
                return null;
            }
            $doomed = array_filter($data['posts'], fn ($post) => $post['id'] === $postId || $post['parentId'] === $postId);
            $data['posts'] = array_diff_key($data['posts'], $doomed);
            return $doomed;
        });
        foreach ($doomed ?? [] as $post) {
            if ($post['image'] !== null) {
                $this->moderation->deleteAsset($post['image']['assetId']);
            }
        }
        return $doomed !== null;
    }

    private function postIdForAsset(string $assetId): ?string
    {
        foreach ($this->store->read()['posts'] as $post) {
            if (($post['image']['assetId'] ?? null) === $assetId) {
                return $post['id'];
            }
        }
        return null;
    }

    /**
     * Published posts are shown to everyone; limited images are shown like allowed ones, and
     * age-restricted images go behind a placeholder.
     */
    public static function isPublished(array $post): bool
    {
        return $post['image'] === null || in_array($post['image']['status'], ['allowed', 'limited', 'age-restricted'], true);
    }

    /** Everyone sees published posts; authors also see their own pending, blocked or failed ones. */
    public static function isVisibleTo(array $post, ?array $viewer): bool
    {
        return self::isPublished($post) || $post['author'] === ($viewer['username'] ?? null);
    }

    /**
     * What a post's image slot shows. Never builds a content URL for an image that isn't
     * published. Age-restricted images get the `ageConfirmed=true` opt-in only for viewers who
     * turned on "Show sensitive media" (authors included); everyone else gets the placeholder.
     *
     * @return array{url: ?string, placeholderUrl: ?string}
     */
    public function mediaFor(array $post, ?array $viewer): array
    {
        $image = $post['image'];
        return match ($image['status'] ?? null) {
            'allowed', 'limited' => ['url' => $this->moderation->imageUrl($image['assetId']), 'placeholderUrl' => null],
            'age-restricted' => ($viewer['showSensitiveMedia'] ?? false)
                ? ['url' => $this->moderation->imageUrl($image['assetId'], ageConfirmed: true), 'placeholderUrl' => null]
                : ['url' => null, 'placeholderUrl' => $this->moderation->placeholderUrl($image['assetId'])],
            default => ['url' => null, 'placeholderUrl' => null],
        };
    }
}
