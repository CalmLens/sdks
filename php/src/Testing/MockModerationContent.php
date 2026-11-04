<?php

declare(strict_types=1);

namespace CalmLens\Testing;

/** The stored content `MockServerClient`'s `moderate` callable receives with an asset. */
final class MockModerationContent
{
    /**
     * @param ?string $bytes the uploaded bytes (parts joined in order), or null without stored
     *   content, such as a website or removed content.
     * @param ?string $text the bytes as UTF-8 text for a `plaintext-document`, otherwise null.
     */
    public function __construct(
        public readonly ?string $bytes,
        public readonly ?string $text,
    ) {
    }
}
