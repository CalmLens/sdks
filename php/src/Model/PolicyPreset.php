<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::ID_* $id
 * @property-read int $version
 * @property-read int $latestVersion
 * @property-read self::MODE_* $mode
 */
final class PolicyPreset extends CalmLensObject
{
    public const ID_GENERAL_COMMUNITY = 'general-community';
    public const ID_CHILDREN_PLATFORM = 'children-platform';
    public const ID_EDUCATION_SUPPORT = 'education-support';
    public const ID_WHOLESOME_COMMUNITY = 'wholesome-community';

    public const MODE_LIVE = 'live';
    public const MODE_PINNED = 'pinned';
    public const MODE_COPY = 'copy';
}
