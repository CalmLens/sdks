<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read list<ContextItem> $items
 */
final class AssetContext extends CalmLensObject
{
    protected const FIELDS = [
        'items' => [ContextItem::class],
    ];
}
