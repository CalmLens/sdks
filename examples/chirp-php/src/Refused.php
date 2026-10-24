<?php

declare(strict_types=1);

namespace Chirp;

/** A post, reply or bio that wasn't saved. Its categories come from CalmLens; the message is Chirp's own. */
final class Refused extends \RuntimeException
{
    /** @param list<string> $categories category IDs that scored at least 0.5 */
    public function __construct(public readonly string $what, public readonly array $categories, public readonly bool $unavailable = false)
    {
        parent::__construct($unavailable ? "Moderation is unavailable, so your $what wasn't saved. Try again." : "Your $what wasn't saved because it may contain " . Labels::describe($categories) . '.');
    }
}
