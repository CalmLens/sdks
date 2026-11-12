# frozen_string_literal: true

module CalmLens
  # Folders organise a project's assets. Reach it through {ServerClient#folders}.
  class Folders < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'folders'

    # Lists one page of child folders, sorted by name unless `sort` says otherwise.
    # @option options [String] :parent_id list this folder's children; omit for the project root
    # @option options [String] :cursor the previous page's `next_cursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `name` (the default) or `createdAt`, descending when prefixed with `-`
    # @option options [String] :search only children whose name contains it
    # @return [FolderPage] with the folder's `ancestors`; {Page#auto_paging_each} fetches the rest.
    def list(**options)
      call(options, __method__) do |api, request|
        page(FolderPage, request('GET', project('folders'), query: api, request_options: request), options) { list(**_1) }
      end
    end

    # @option options [String] :name
    # @option options [String, nil] :parent_id
    # @return [Folder]
    def create(**options)
      call(options, __method__) do |api, request|
        build(Folder, request('POST', project('folders'), body: api, request_options: request))
      end
    end

    # @param folder_id [String]
    # @return [Folder]
    def retrieve(folder_id, **options)
      call(with_ids(options, folder_id: folder_id), __method__) do |api, request|
        build(Folder, request('GET', folder_path(api), request_options: request))
      end
    end

    # @param folder_id [String]
    # @option options [String] :name
    # @return [Folder]
    def update(folder_id, **options)
      call(with_ids(options, folder_id: folder_id), __method__) do |api, request|
        build(Folder, request('PATCH', folder_path(api), body: without(api, 'folderId'), request_options: request))
      end
    end

    # Moves a folder under another, or to the root with `parent_id: nil`.
    # @param folder_id [String]
    # @option options [String, nil] :parent_id
    # @return [Folder]
    def move(folder_id, **options)
      call(with_ids(options, folder_id: folder_id), __method__) do |api, request|
        build(Folder, request('POST', "#{folder_path(api)}/move", body: { 'parentId' => Internal.required(api, 'parentId') },
                                                                  request_options: request))
      end
    end

    # Deletes an empty folder.
    # @param folder_id [String]
    # @return [nil]
    def delete(folder_id, **options)
      call(with_ids(options, folder_id: folder_id), __method__) do |api, request|
        request('DELETE', folder_path(api), request_options: request)
        nil
      end
    end

    private

    def folder_path(api) = "/folders/#{Internal.segment(api['folderId'])}"
  end
end
