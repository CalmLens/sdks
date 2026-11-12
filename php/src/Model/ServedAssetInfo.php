<?php

declare(strict_types=1);

namespace CalmLens\Model;

/** Pixel dimensions of the representation served by the CDN. */
final readonly class ServedAssetInfo
{
    public function __construct(public int $width, public int $height) {}
}
