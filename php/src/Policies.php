<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

/**
 * Moderation policies belong to the project's organisation and its projects share them. Every
 * change sends the policy's `revision`, so a policy changed since is refused with
 * `policy/revision-conflict`. Through a project's key you can change only policies no other
 * project uses or owns.
 */
final class Policies extends Resource
{
    protected const OPERATIONS = 'policies';

    /** The organisation's policies (`policies`) and the ID of the one the project uses (`projectPolicyId`). */
    public function list(array $options = []): array
    {
        [, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->session->project('policies'), options: $request);
    }

    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->policyPath($api), options: $request);
    }

    /**
     * Creates a policy from `settings` and a `name`, or a copy of a built-in preset with `presetId`,
     * with an optional `description`. It moderates nothing until it is assigned to a project or
     * named on an upload preset.
     */
    public function create(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('POST', $this->session->project('policies'), body: (object) $api, options: $request);
    }

    /**
     * Changes the `name`, `description` or `settings` of the policy at its current `revision`; later
     * moderation uses them. Saving a policy that follows automatic updates pins it as a copy.
     */
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->policyPath($api);
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }

    /**
     * With `operation` `reset`, restores a preset copy's pinned version (`presetVersion` is its
     * `preset.version`); with `update`, moves an unchanged copy to the latest release (its
     * `preset.latestVersion`).
     */
    public function applyPreset(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->policyPath($api);
        return $this->session->request('POST', $path . '/preset', body: (object) $api, options: $request);
    }

    /**
     * Switches automatic updates on (`enabled` true, replacing a saved copy with the latest preset)
     * or off (pinning the current version as a copy) for the organisation's own preset policy.
     */
    public function setAutomaticUpdates(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->policyPath($api);
        return $this->session->request('PUT', $path . '/automatic-updates', body: (object) $api, options: $request);
    }

    /** Deletes a policy that no project or upload preset uses. */
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $this->session->request('DELETE', $this->policyPath($api), options: $request);
    }

    /** Chooses the policy (`policyId`) the project moderates with. */
    public function assign(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('PUT', $this->session->project('policy'), body: (object) $api, options: $request);
    }

    private function policyPath(array &$options): string
    {
        $id = Values::segment($options['policyId'] ?? null);
        unset($options['policyId']);
        return $this->session->project('policies/' . $id);
    }
}
