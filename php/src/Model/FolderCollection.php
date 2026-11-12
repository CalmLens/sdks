<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\Collection;

/**
 * One page of folders, with the `ancestors` of the folder listed.
 *
 * @extends Collection<Folder>
 *
 * @property-read list<Folder> $items
 * @property-read null|string $nextCursor
 * @property-read bool $hasMore
 * @property-read list<Folder> $ancestors
 */
final class FolderCollection extends Collection
{
    protected const FIELDS = [
        'items' => [Folder::class],
        'ancestors' => [Folder::class],
    ];
}
