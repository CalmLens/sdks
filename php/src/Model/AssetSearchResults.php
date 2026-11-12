<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read string $query
 * @property-read list<AssetSearchMatch> $items
 * @property-read self::SEMANTIC_STATUS_* $semanticStatus
 */
final class AssetSearchResults extends CalmLensObject
{
    public const SEMANTIC_STATUS_DISABLED = 'disabled';
    public const SEMANTIC_STATUS_READY = 'ready';
    public const SEMANTIC_STATUS_INDEXING = 'indexing';
    public const SEMANTIC_STATUS_UNAVAILABLE = 'unavailable';

    protected const FIELDS = [
        'items' => [AssetSearchMatch::class],
    ];
}
