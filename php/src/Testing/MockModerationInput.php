<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\Model\Asset;

/** What `MockServerClient`'s `moderate` callable receives for each asset the mock moderates. */
final class MockModerationInput
{
    /** An upload completed: `assets->create`, `assets->classify`, `text->classify` or a final part. */
    public const UPLOAD = 'upload';
    /** `assets->retry` queued a failed asset again. */
    public const RETRY = 'retry';
    /** `completeProcessing($assetId)` finished processing without a decision of its own. */
    public const COMPLETE = 'complete';

    /**
     * @param Asset $asset the asset as stored, still processing, as the client's own responses
     *   return one: read fields as properties (`$asset->name`) or array keys (`$asset['name']`).
     * @param MockModerationContent $content the stored content: its bytes and, for a
     *   `plaintext-document`, its text, both null without stored content, such as a website.
     * @param string $trigger why the asset is moderated: `upload`, `retry` or `complete`.
     * @param bool $queued true when the API would queue the work rather than answer with the
     *   decision: queued uploads, retries and `completeProcessing`.
     */
    public function __construct(
        public readonly Asset $asset,
        public readonly MockModerationContent $content,
        public readonly string $trigger,
        public readonly bool $queued,
    ) {
    }
}
