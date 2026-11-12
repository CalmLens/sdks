<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read self::ID_* $id
 * @property-read int $version
 */
final class ModerationPolicyPreset extends CalmLensObject
{
    public const ID_GENERAL_COMMUNITY = 'general-community';
    public const ID_CHILDREN_PLATFORM = 'children-platform';
    public const ID_EDUCATION_SUPPORT = 'education-support';
    public const ID_WHOLESOME_COMMUNITY = 'wholesome-community';
}
