<?php

declare(strict_types=1);

namespace CalmLens\Model;

use CalmLens\CalmLensObject;

/**
 * A project's settings, with its `revision`.
 *
 * @property-read string $projectId
 * @property-read int $revision
 * @property-read ProjectSettingsValues $settings
 */
final class ProjectSettingsResource extends CalmLensObject
{
    protected const FIELDS = [
        'settings' => ProjectSettingsValues::class,
    ];
}
