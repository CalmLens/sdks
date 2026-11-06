# frozen_string_literal: true

module CalmLens
  # Folders organise a project's assets. Reach it through {ServerClient#folders}.
  class Folders < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'folders'

    # Lists one page of child folders, sorted by name unless `sort` says otherwise.
    # @option options [String] :parent_id list this folder's children; omit for the project root
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `name` (the default) or `createdAt`, descending when prefixed with `-`
    # @option options [String] :search only children whose name contains it
    # @return [Hash] a cursor page (items, nextCursor, hasMore) with ancestors.
    def list(options = {})
      call(options, __method__) do |api, request|
        cursor_page(request('GET', project('folders'), query: api, request_options: request), 'folder')
      end
    end

    # Iterates every child folder of `parent_id` (or the project root), fetching pages as needed.
    # @param options [Hash] the options of {#list}; `cursor` sets the starting position.
    # @yieldparam folder [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      each_item(options, __method__, method(:list), &block)
    end

    # @option options [String] :name
    # @option options [String, nil] :parent_id
    # @return [Hash] the folder
    def create(options)
      call(options, __method__) { |api, request| request('POST', project('folders'), body: api, request_options: request) }
    end

    # @option options [String] :folder_id
    # @return [Hash] the folder
    def retrieve(options)
      call(options, __method__) do |api, request|
        request('GET', "/folders/#{Internal.segment(api['folderId'])}", request_options: request)
      end
    end

    # @option options [String] :folder_id
    # @option options [String] :name
    # @return [Hash] the folder
    def update(options)
      call(options, __method__) do |api, request|
        request('PATCH', "/folders/#{Internal.segment(api['folderId'])}", body: without(api, 'folderId'),
                                                                          request_options: request)
      end
    end

    # Moves a folder under another, or to the root with `parent_id: nil`.
    # @option options [String] :folder_id
    # @option options [String, nil] :parent_id
    # @return [Hash] the folder
    def move(options)
      call(options, __method__) do |api, request|
        request('POST', "/folders/#{Internal.segment(api['folderId'])}/move",
                body: { 'parentId' => Internal.required(api, 'parentId') }, request_options: request)
      end
    end

    # Deletes an empty folder.
    # @option options [String] :folder_id
    # @return [nil]
    def delete(options)
      call(options, __method__) do |api, request|
        request('DELETE', "/folders/#{Internal.segment(api['folderId'])}", request_options: request)
        nil
      end
    end
  end
end
