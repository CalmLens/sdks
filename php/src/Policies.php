<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * Moderation policies belong to the API key's organisation and its projects share them. Every
 * change sends the policy's `revision`, so a policy changed since is refused with
 * `policy/revision-conflict`. Through a project's key you can change only policies no other
 * project uses. A preset policy's `preset.mode` is `live` (it follows the preset's latest release),
 * `pinned` (the organisation's own preset policy, held at one release) or `copy`.
 */
final class Policies extends Resource
{
    protected const OPERATIONS = 'policies';

    /**
     * One page of the organisation's policies, oldest first unless `sort` (`createdAt` and `id`,
     * descending when prefixed with `-`) says otherwise. Pass the page's `nextCursor` as `cursor`
     * and a `pageSize` (1 to 100, 50 by default). `retrieveAssigned` says which one the project uses.
     */
    public function list(array $options = []): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $page = $this->session->request('GET', '/policies', query: $api, options: $request);
        if (!is_array($page) || !is_array($page['items'] ?? null) || !array_is_list($page['items']) || !is_bool($page['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid policy page');
        }
        return $page;
    }

    /** Yields every policy of the organisation, fetching pages as needed. */
    public function each(array $options = []): \Generator
    {
        yield from $this->items($this->list(...), $options);
    }

    public function retrieve(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->policyPath($api), options: $request);
    }

    /**
     * Creates a policy from `settings` and a `name`, or a copy of a built-in preset with `presetId`,
     * with an optional `description`. `settings.categorySettings` names every category, each with
     * its `action`, `allowances` and `restrictions`. The policy moderates nothing until it is
     * assigned to a project or named on an upload preset.
     */
    public function create(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('POST', '/policies', body: (object) $api, options: $request);
    }

    /**
     * Changes the `name`, `description` or `settings` of the policy at its current `revision`; later
     * moderation uses them. Saving a `live` policy pins it.
     */
    public function update(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->policyPath($api);
        return $this->session->request('PATCH', $path, body: (object) $api, options: $request);
    }

    /**
     * Restores the settings of the preset release a `pinned` or `copy` policy is pinned to,
     * discarding its edits. Send the policy's `revision` and its `preset.version` as `presetVersion`.
     */
    public function reset(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->policyPath($api);
        return $this->session->request('POST', $path . '/reset', body: (object) $api, options: $request);
    }

    /**
     * Moves an unchanged `pinned` or `copy` policy to the latest release of its preset. Send the
     * policy's `revision` and its `preset.latestVersion` as `presetVersion`.
     */
    public function upgrade(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->policyPath($api);
        return $this->session->request('POST', $path . '/upgrade', body: (object) $api, options: $request);
    }

    /**
     * Switches automatic updates on (`enabled` true: a `pinned` policy becomes `live`, replacing its
     * settings with the latest preset) or off (a `live` policy is pinned at its current release) for
     * the organisation's own preset policy.
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

    /**
     * The policy the project moderates with. Uploads through an upload preset that names its own
     * policy use that one instead.
     */
    public function retrieveAssigned(array $options = []): array
    {
        [, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->session->project('policy'), options: $request);
    }

    /** Chooses the policy (`policyId`) the project moderates with. */
    public function assign(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('PUT', $this->session->project('policy'), body: (object) $api, options: $request);
    }

    private function policyPath(array &$options): string
    {
        return $this->path($options, 'policies', 'policyId');
    }
}
