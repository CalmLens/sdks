<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * @property-read array<Category::*, PolicyCategorySetting> $categorySettings
 */
final class PolicySettings extends CalmLensObject
{
    protected const FIELDS = [
        'categorySettings' => ['*' => PolicyCategorySetting::class],
    ];
}
