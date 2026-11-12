<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** The call was cancelled (`sdk/cancelled`). The PHP client is synchronous and never raises it. */
class CancelledException extends \CalmLens\CalmLensException
{
}
