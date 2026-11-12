<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Model\Policy;

/**
 * Moderation policies belong to the API key's organisation and its projects share them. Every
 * change sends the policy's `revision`, so a policy changed since is refused with
 * `policy/revision-conflict`. Through a project's key you can change only policies no other
 * project uses. A preset policy's `preset.mode` is `live` (it follows the preset's latest release),
 * `pinned` (the organisation's own preset policy, held at one release) or `copy`.
 *
 * @phpstan-import-type PolicySettingsParams from Types
 * @phpstan-import-type PresetId from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class Policies extends Resource
{
    protected const OPERATIONS = 'policies';

    /**
     * One page of the organisation's policies, oldest first unless `sort` (`createdAt` and `id`,
     * descending when prefixed with `-`) says otherwise. Pass the page's `nextCursor` as `cursor`
     * and a `pageSize` (1 to 100, 50 by default). `retrieveAssigned` says which one the project uses.
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return Collection<Policy>
     */
    public function list(array $params = [], array $requestOptions = []): Collection
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $page = $this->session->request('GET', '/policies', query: $api, options: $request);
        return $this->collection(Collection::class, Policy::class, $page, fn (array $next) => $this->list($next, $requestOptions), $params);
    }

    /**
     * Yields every policy of the organisation, fetching pages as needed.
     *
     * @param array{cursor?: string, pageSize?: int, sort?: string} $params
     * @param RequestOptions $requestOptions
     * @return \Generator<int, Policy>
     */
    public function each(array $params = [], array $requestOptions = []): \Generator
    {
        yield from $this->list($params, $requestOptions)->autoPagingIterator();
    }

    /**
     * @param array{policyId: string} $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function retrieve(array $params, array $requestOptions = []): Policy
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Policy::class, $this->session->request('GET', $this->policyPath($api), options: $request));
    }

    /**
     * Creates a policy from `settings` and a `name`, or a copy of a built-in preset with `presetId`,
     * with an optional `description`. `settings.categorySettings` names every category, each with
     * its `action`, `allowances` and `restrictions`. The policy moderates nothing until it is
     * assigned to a project or named on an upload preset.
     *
     * @param array{
     *     name?: string, description?: string, settings?: PolicySettingsParams, presetId?: PresetId,
     * } $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function create(array $params, array $requestOptions = []): Policy
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Policy::class, $this->session->request('POST', '/policies', body: (object) $api, options: $request));
    }

    /**
     * Changes the `name`, `description` or `settings` of the policy at its current `revision`; later
     * moderation uses them. Saving a `live` policy pins it.
     *
     * @param array{
     *     policyId: string, revision: int, name?: string, description?: string, settings?: PolicySettingsParams,
     * } $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function update(array $params, array $requestOptions = []): Policy
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->policyPath($api);
        return $this->model(Policy::class, $this->session->request('PATCH', $path, body: (object) $api, options: $request));
    }

    /**
     * Restores the settings of the preset release a `pinned` or `copy` policy is pinned to,
     * discarding its edits. Send the policy's `revision` and its `preset.version` as `presetVersion`.
     *
     * @param array{policyId: string, revision: int, presetVersion: int} $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function reset(array $params, array $requestOptions = []): Policy
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->policyPath($api);
        return $this->model(Policy::class, $this->session->request('POST', $path . '/reset', body: (object) $api, options: $request));
    }

    /**
     * Moves an unchanged `pinned` or `copy` policy to the latest release of its preset. Send the
     * policy's `revision` and its `preset.latestVersion` as `presetVersion`.
     *
     * @param array{policyId: string, revision: int, presetVersion: int} $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function upgrade(array $params, array $requestOptions = []): Policy
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->policyPath($api);
        return $this->model(Policy::class, $this->session->request('POST', $path . '/upgrade', body: (object) $api, options: $request));
    }

    /**
     * Switches automatic updates on (`enabled` true: a `pinned` policy becomes `live`, replacing its
     * settings with the latest preset) or off (a `live` policy is pinned at its current release) for
     * the organisation's own preset policy.
     *
     * @param array{policyId: string, enabled: bool, revision: int, presetVersion: int} $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function setAutomaticUpdates(array $params, array $requestOptions = []): Policy
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->policyPath($api);
        return $this->model(Policy::class, $this->session->request('PUT', $path . '/automatic-updates', body: (object) $api, options: $request));
    }

    /**
     * Deletes a policy that no project or upload preset uses.
     *
     * @param array{policyId: string} $params
     * @param RequestOptions $requestOptions
     */
    public function delete(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $this->session->request('DELETE', $this->policyPath($api), options: $request);
    }

    /**
     * The policy the project moderates with. Uploads through an upload preset that names its own
     * policy use that one instead.
     *
     * @param array{} $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function retrieveAssigned(array $params = [], array $requestOptions = []): Policy
    {
        [, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Policy::class, $this->session->request('GET', $this->session->project('policy'), options: $request));
    }

    /**
     * Chooses the policy (`policyId`) the project moderates with.
     *
     * @param array{policyId: string} $params
     * @param RequestOptions $requestOptions
     * @return Policy
     */
    public function assign(array $params, array $requestOptions = []): Policy
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(Policy::class, $this->session->request('PUT', $this->session->project('policy'), body: (object) $api, options: $request));
    }

    private function policyPath(array &$options): string
    {
        return $this->path($options, 'policies', 'policyId');
    }
}
