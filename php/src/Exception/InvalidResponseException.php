<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** A successful response could not be read (`sdk/invalid-response`) or was too large (`sdk/response-too-large`). */
class InvalidResponseException extends \CalmLens\CalmLensException
{
}
