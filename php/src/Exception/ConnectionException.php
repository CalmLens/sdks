<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** No complete response arrived (`sdk/transport-error`); the underlying exception is `getPrevious()`. */
class ConnectionException extends \CalmLens\CalmLensException
{
}
