<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * A moderation policy: the action for each category, with its allowances and restrictions.
 *
 * @property-read string $id
 * @property-read string $name
 * @property-read string $description
 * @property-read PolicySettings $settings
 * @property-read int $revision
 * @property-read null|PolicyPreset $preset
 * @property-read list<string> $projectIds
 * @property-read int $createdAt
 * @property-read null|int $updatedAt
 */
final class Policy extends CalmLensObject
{
    protected const FIELDS = [
        'settings' => PolicySettings::class,
        'preset' => PolicyPreset::class,
    ];
}
