<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * A signed asset URL and its expiry, in Unix milliseconds.
 *
 * @property-read string $url
 * @property-read int $expiresAt
 */
final class SignedAssetUrl extends CalmLensObject
{
}
