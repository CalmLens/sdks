<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read string $id
 * @property-read int $revision
 * @property-read null|ModerationPolicyPreset $preset
 */
final class ModerationPolicy extends CalmLensObject
{
    protected const FIELDS = [
        'preset' => ModerationPolicyPreset::class,
    ];
}
