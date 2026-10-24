<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** HTTP 429: the request was throttled; see `retryAfter()`. */
class RateLimitException extends ApiException
{
}
