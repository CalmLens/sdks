<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * The content fields of an asset URL's display info.
 *
 * @property-read null|string $format
 * @property-read null|int $width
 * @property-read null|int $height
 * @property-read null|int|float $durationSeconds
 * @property-read null|int $pageCount
 * @property-read null|RenderedFile $rendered
 * @property-read null|Preview $preview
 * @property-read null|HlsStream $hls
 */
final class AssetInfoContent extends CalmLensObject
{
    protected const FIELDS = [
        'rendered' => RenderedFile::class,
        'preview' => Preview::class,
        'hls' => HlsStream::class,
    ];
}
