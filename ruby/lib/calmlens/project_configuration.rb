# frozen_string_literal: true

module CalmLens
  # The project's upload presets: the rules for uploads made from browsers and apps. {#ensure}
  # creates or replaces presets by `key`, for applications that declare theirs in code or
  # configuration. Reach it through {ServerClient#upload_presets}.
  class UploadPresets < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'uploadPresets'

    # Lists one page of the project's upload presets, oldest first unless `sort` says otherwise.
    # @option options [String] :cursor the previous page's `next_cursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `createdAt` by default
    # @return [UploadPresetPage] {Page#auto_paging_each} fetches the rest.
    def list(**options)
      call(options, __method__) do |api, request|
        page(UploadPresetPage, request('GET', project('upload-presets'), query: api, request_options: request), options) { list(**_1) }
      end
    end

    # Creates each preset, or replaces it with the definition sent, by `key`. Fields left out take
    # their defaults; an unchanged preset keeps its revision. Every preset is checked before any is
    # saved. Send each preset's `revision` (0 for one that must not exist yet) to refuse a change
    # made since with `upload-preset/revision-conflict`.
    # @option options [Array<Hash>] :upload_presets `[{key:, name:, revision:, access:, enabled:, ...}]`,
    #   at most 50
    # @return [UploadPresetsEnsured] `upload_presets`: the stored presets, in the order sent.
    def ensure(**options)
      call(options, __method__) do |api, request|
        build(UploadPresetsEnsured, request('PUT', project('upload-presets'), body: api, request_options: request))
      end
    end

    # Deletes an upload preset. Browsers can no longer upload through it; assets already uploaded stay.
    # @param upload_preset_id [String]
    # @return [nil]
    def delete(upload_preset_id, **options)
      call(with_ids(options, upload_preset_id: upload_preset_id), __method__) do |api, request|
        request('DELETE', "/upload-presets/#{Internal.segment(api['uploadPresetId'])}", request_options: request)
        nil
      end
    end
  end

  # The project's settings, with defaults filled in. {#update} replaces them: settings left out
  # return to their defaults. Send the `revision` you read to refuse a change made since with
  # `project-settings/revision-conflict`. Reach it through {ServerClient#project_settings}.
  class ProjectSettings < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'projectSettings'

    # @return [ProjectSettingsResource] `project_id`, `revision` and `settings`.
    def get(**options)
      call(options, __method__) do |_api, request|
        build(ProjectSettingsResource, request('GET', project('settings'), request_options: request))
      end
    end

    # Replaces the project's settings; unchanged settings keep their revision. The project's policy
    # and metadata fields have their own methods.
    # @option options [Integer] :revision the revision you read
    # @option options [Hash] :settings the complete settings
    # @option options [Numeric] :search_indexing_budget_units needed when turning on
    #   `aiMediaSearchEnabled`: the most indexing units you accept for existing media
    # @return [ProjectSettingsResource] `project_id`, `revision` and `settings`.
    def update(**options)
      call(options, __method__) do |api, request|
        build(ProjectSettingsResource, request('PUT', project('settings'), body: api, request_options: request))
      end
    end
  end

  # The project's metadata fields, in display order. They share the project settings' `revision`;
  # {#ensure} creates or replaces fields by ID and keeps the others. Reach it through
  # {ServerClient#metadata_fields}.
  class MetadataFields < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'metadataFields'

    # @return [MetadataFieldsResource] `project_id`, `revision` and `fields`.
    def list(**options)
      call(options, __method__) do |_api, request|
        build(MetadataFieldsResource, request('GET', project('metadata-fields'), request_options: request))
      end
    end

    # Creates each field, or replaces it by ID. Other fields are kept; new ones are added at the end.
    # @option options [Integer] :revision the revision you read
    # @option options [Array<Hash>] :fields `[{id:, title:, type:, icon:, color:, description:}]`
    # @return [MetadataFieldsResource] `project_id`, `revision` and `fields`.
    def ensure(**options)
      call(options, __method__) do |api, request|
        build(MetadataFieldsResource, request('PUT', project('metadata-fields'), body: api, request_options: request))
      end
    end

    # Deletes a field definition; assets keep the metadata values they hold.
    # @param field_id [String]
    # @option options [Integer] :revision the revision you read
    # @return [nil]
    def delete(field_id, **options)
      call(with_ids(options, field_id: field_id), __method__) do |api, request|
        request('DELETE', project("metadata-fields/#{Internal.segment(api['fieldId'])}"),
                query: without(api, 'fieldId'), request_options: request)
        nil
      end
    end
  end
end
