<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * The project's metadata fields, with their `revision`.
 *
 * @property-read string $projectId
 * @property-read int $revision
 * @property-read list<MetadataField> $fields
 */
final class MetadataFieldsResource extends CalmLensObject
{
    protected const FIELDS = [
        'fields' => [MetadataField::class],
    ];
}
