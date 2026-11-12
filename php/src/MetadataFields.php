<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Values;
use CalmLens\Model\MetadataFieldsResource;

/**
 * The project's metadata field definitions. They share the project settings' `revision`: send the
 * one you read to refuse a change made since (`project-settings/revision-conflict`).
 *
 * @phpstan-import-type MetadataFieldIcon from Types
 * @phpstan-import-type MetadataFieldType from Types
 * @phpstan-import-type RequestOptions from Types
 */
final class MetadataFields extends Resource
{
    protected const OPERATIONS = 'metadataFields';

    /**
     * The project's `revision` and metadata `fields`.
     *
     * @param array{} $params
     * @param RequestOptions $requestOptions
     * @return MetadataFieldsResource
     */
    public function list(array $params = [], array $requestOptions = []): MetadataFieldsResource
    {
        [, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(MetadataFieldsResource::class, $this->session->request('GET', $this->session->project('metadata-fields'), options: $request));
    }

    /**
     * Creates each field in `fields`, or replaces it, by `id`, keeping the project's other fields.
     * Returns the project's `revision` and all its `fields`.
     *
     * @param array{
     *     revision?: int,
     *     fields: list<array{
     *         id: string, title: string, description?: string, type: MetadataFieldType,
     *         icon: MetadataFieldIcon, color: string,
     *     }>,
     * } $params
     * @param RequestOptions $requestOptions
     * @return MetadataFieldsResource
     */
    public function ensure(array $params, array $requestOptions = []): MetadataFieldsResource
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        return $this->model(MetadataFieldsResource::class, $this->session->request('PUT', $this->session->project('metadata-fields'), body: (object) $api, options: $request));
    }

    /**
     * Deletes a field definition (`fieldId`), optionally at a `revision`; assets keep their values.
     *
     * @param array{fieldId: string, revision?: int} $params
     * @param RequestOptions $requestOptions
     */
    public function delete(array $params, array $requestOptions = []): void
    {
        [$api, $request] = $this->split($params, __FUNCTION__, $requestOptions);
        $path = $this->session->project('metadata-fields/' . Values::segment($api['fieldId'] ?? null));
        unset($api['fieldId']);
        $this->session->request('DELETE', $path, query: $api, options: $request);
    }
}
