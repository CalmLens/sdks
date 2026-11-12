<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * An upload token for a browser or app to upload with, and its expiry in Unix milliseconds.
 *
 * @property-read string $token
 * @property-read int $expiresAt
 */
final class UploadToken extends CalmLensObject
{
}
