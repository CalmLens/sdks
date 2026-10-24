<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** HTTP 401: the API key is missing, invalid, revoked or expired. */
class AuthenticationException extends ApiException
{
}
