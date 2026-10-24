<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** HTTP 403: the API key may not perform this action. */
class PermissionDeniedException extends ApiException
{
}
