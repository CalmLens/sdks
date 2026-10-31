<?php

declare(strict_types=1);

namespace CalmLens;

final class Version
{
    public const VERSION = '1.0.0';

    /** The `User-Agent` the SDK sends, e.g. `calmlens-php/0.1.0 (php/8.4.1)`. */
    public static function userAgent(): string
    {
        return 'calmlens-php/' . self::VERSION . ' (php/' . preg_replace('/[^0-9A-Za-z.+-]/', '', PHP_VERSION) . ')';
    }
}
