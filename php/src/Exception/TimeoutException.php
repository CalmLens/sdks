<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** A request exceeded its timeout, or `waitForDecision` had no decision in time (`sdk/timeout`). */
class TimeoutException extends ConnectionException
{
}
