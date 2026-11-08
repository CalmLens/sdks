<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;

/**
 * The project's metadata field definitions. They share the project settings' `revision`: send the
 * one you read to refuse a change made since (`project-settings/revision-conflict`).
 */
final class MetadataFields extends Resource
{
    protected const OPERATIONS = 'metadataFields';

    /** The project's `revision` and metadata `fields`. */
    public function list(array $options = []): array
    {
        [, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('GET', $this->session->project('metadata-fields'), options: $request);
    }

    /**
     * Creates each field in `fields`, or replaces it, by `id`, keeping the project's other fields.
     * Returns the project's `revision` and all its `fields`.
     */
    public function ensure(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        return $this->session->request('PUT', $this->session->project('metadata-fields'), body: (object) $api, options: $request);
    }

    /** Deletes a field definition (`fieldId`), optionally at a `revision`; assets keep their values. */
    public function delete(array $options): void
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $path = $this->session->project('metadata-fields/' . Values::segment($api['fieldId'] ?? null));
        unset($api['fieldId']);
        $this->session->request('DELETE', $path, query: $api, options: $request);
    }
}
