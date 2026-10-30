# frozen_string_literal: true

module CalmLens
  # Folders organise a project's assets. Reach it through {ServerClient#folders}.
  class Folders < Resource
    # Lists one page of child folders, sorted by name unless `ordering` says otherwise.
    # @option options [String] :parent_id list this folder's children; omit for the project root
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 100
    # @option options [Array<Hash>] :ordering one `{field: 'name' | 'createdAt', direction: 'ASC' | 'DESC'}`
    # @option options [String] :search
    # @option options [Boolean] :search_all search every branch, not only `parent_id`'s children
    # @option options [Array<String>] :ids folders whose paths to return in `ancestors`
    # @option options [Boolean] :resolve_only return only the `ancestors` of `ids`
    # @return [Hash] a cursor page (items, nextCursor, hasMore, pageSize, ordering) with ancestors.
    def list(options = {})
      call(options) do |api, request|
        response = request('GET', project('folders'), query: api, request_options: request)
        valid = response.is_a?(Hash) && response['items'].is_a?(Array) && response['ancestors'].is_a?(Array) &&
                [true, false].include?(response['hasMore'])
        raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Invalid folder page') unless valid

        response
      end
    end

    # @option options [String] :name
    # @option options [String, nil] :parent_id
    # @return [Hash] the folder
    def create(options)
      call(options) { |api, request| request('POST', project('folders'), body: api, request_options: request) }
    end

    # @option options [String] :folder_id
    # @return [Hash] the folder
    def retrieve(options)
      call(options) do |api, request|
        request('GET', "/folders/#{Internal.segment(api['folderId'])}", request_options: request)
      end
    end

    # @option options [String] :folder_id
    # @option options [String] :name
    # @return [Hash] the folder
    def update(options)
      call(options) do |api, request|
        request('PATCH', "/folders/#{Internal.segment(api['folderId'])}", body: without(api, 'folderId'),
                                                                          request_options: request)
      end
    end

    # Moves a folder under another, or to the root with `parent_id: nil`.
    # @option options [String] :folder_id
    # @option options [String, nil] :parent_id
    # @return [Hash] the folder
    def move(options)
      call(options) do |api, request|
        request('POST', "/folders/#{Internal.segment(api['folderId'])}/move",
                body: { 'parentId' => Internal.required(api, 'parentId') }, request_options: request)
      end
    end

    # Deletes an empty folder.
    # @option options [String] :folder_id
    # @return [nil]
    def delete(options)
      call(options) do |api, request|
        request('DELETE', "/folders/#{Internal.segment(api['folderId'])}", request_options: request)
        nil
      end
    end
  end
end
