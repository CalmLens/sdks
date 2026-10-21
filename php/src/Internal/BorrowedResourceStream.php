<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use GuzzleHttp\Psr7\Stream;

/** Guzzle owns this wrapper, while the caller retains ownership of the PHP resource. @internal */
final class BorrowedResourceStream extends Stream
{
    public function close(): void
    {
        $this->detach();
    }
}
