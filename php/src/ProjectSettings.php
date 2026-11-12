<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * The project's settings, with defaults filled in. `update` replaces them: settings left out
 * return to their defaults. Send the `revision` you read to refuse a change made since
 * (`project-settings/revision-conflict`). The settings share their revision with the metadata fields.
 *
 * @phpstan-import-type ProjectSettingsResource from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class ProjectSettings extends Resource
{
    protected const OPERATIONS = 'projectSettings';

    /**
     * The project's `revision` and `settings`.
     *
     * @param array{requestOptions?: RequestOptions} $options
     * @return ProjectSettingsResource
     */
    public function get(array $options = []): array
    {
        [, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->session->project('settings'), options: $request);
    }

    /**
     * Replaces the project's `settings`, optionally at a `revision`. Switching on AI media search
     * takes the `searchIndexingBudgetUnits` you agree to spend indexing existing assets.
     *
     * @param array{
     *     revision?: int,
     *     settings: array{
     *         retainContent?: bool, optOutJurisdictions?: list<'EU'>, blockUnmoderatedAssets?: bool,
     *         storeSensitiveMetadata?: bool, linkCheckingEnabled?: bool, streamingEnabled?: bool,
     *         aiMediaSearchEnabled?: bool,
     *         remoteUrlRule?: array{mode: 'allow'|'deny', domains: list<string>}|null,
     *         websiteSubmissionsPerMinute?: ?int,
     *         humanReview?: array{
     *             allowedSamplePercent?: int|float, restrictedSamplePercent?: int|float,
     *             uncertaintyMarginPercent?: int|float, reviewMissingEvidence?: bool,
     *         },
     *     },
     *     searchIndexingBudgetUnits?: int|float, requestOptions?: RequestOptions,
     * } $options
     * @return ProjectSettingsResource
     */
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        if (is_array($api['settings'] ?? null)) {
            $api['settings'] = (object) $api['settings'];
        }
        return $this->session->request('PUT', $this->session->project('settings'), body: (object) $api, options: $request);
    }
}
