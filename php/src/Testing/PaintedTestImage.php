<?php

declare(strict_types=1);

namespace CalmLens\Testing;

/**
 * A painted test image from {@see TestInputs::paintTestImage()}: `width` by `height` pixels of
 * 8-bit RGBA in `rgba`, row by row, and the same image as PNG bytes to upload in `png`.
 */
final readonly class PaintedTestImage
{
    public function __construct(public int $width, public int $height, public string $rgba, public string $png)
    {
    }
}
