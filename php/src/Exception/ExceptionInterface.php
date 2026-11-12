<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** Every exception the SDK raises implements this, like `CalmLens\CalmLensException` itself. */
interface ExceptionInterface extends \Throwable
{
}
