# frozen_string_literal: true

module CalmLens
  # Hash lists hold perceptual hashes of images. Image uploads are compared with every list in the
  # project: a `flag` list reports matches, a `block` list also blocks close matches. Reach it through
  # {ServerClient#hash_lists}.
  class HashLists < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'hashLists'

    # Lists one page of the project's hash lists, newest first unless `sort` says otherwise.
    # @option options [String] :cursor the previous page's `next_cursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `-createdAt` by default
    # @return [HashListPage] {Page#auto_paging_each} fetches the rest.
    def list(**options)
      call(options, __method__) do |api, request|
        page(HashListPage, request('GET', project('hash-lists'), query: api, request_options: request), options) { list(**_1) }
      end
    end

    # @param hash_list_id [String]
    # @return [HashList]
    def retrieve(hash_list_id, **options)
      call(with_ids(options, hash_list_id: hash_list_id), __method__) do |api, request|
        build(HashList, request('GET', list_path(api), request_options: request))
      end
    end

    # @option options [String] :name
    # @option options [String] :action `flag` or `block`
    # @option options [String, nil] :description
    # @return [HashList]
    def create(**options)
      call(options, __method__) do |api, request|
        build(HashList, request('POST', project('hash-lists'), body: api, request_options: request))
      end
    end

    # Renames a list or changes what its matches do. The new action applies to later uploads.
    # @param hash_list_id [String]
    # @option options [String] :name
    # @option options [String, nil] :description
    # @option options [String] :action `flag` or `block`
    # @return [HashList]
    def update(hash_list_id, **options)
      call(with_ids(options, hash_list_id: hash_list_id), __method__) do |api, request|
        build(HashList, request('PATCH', list_path(api), body: without(api, 'hashListId'), request_options: request))
      end
    end

    # Deletes the list and every entry in it. Later uploads are no longer compared with it.
    # @param hash_list_id [String]
    # @return [nil]
    def delete(hash_list_id, **options)
      call(with_ids(options, hash_list_id: hash_list_id), __method__) do |api, request|
        request('DELETE', list_path(api), request_options: request)
        nil
      end
    end

    # Lists one page of a list's entries, newest first unless `sort` says otherwise.
    # @param hash_list_id [String]
    # @option options [String] :cursor the previous page's `next_cursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `-createdAt` by default
    # @return [HashListEntryPage] {Page#auto_paging_each} fetches the rest.
    def list_entries(hash_list_id, **options)
      call(with_ids(options, hash_list_id: hash_list_id), __method__) do |api, request|
        response = request('GET', "#{list_path(api)}/entries", query: without(api, 'hashListId'), request_options: request)
        page(HashListEntryPage, response, options) { list_entries(hash_list_id, **_1) }
      end
    end

    # Adds a PDQ hash, or an image asset's hash; a hash already in the list returns its entry.
    # @param hash_list_id [String]
    # @option options [String] :hash 64 hexadecimal characters; send this or `asset_id`
    # @option options [Integer] :quality
    # @option options [String] :asset_id an image asset whose hash to add
    # @option options [String] :label
    # @return [HashListEntry] read its hash with `entry[:hash]`, since `hash` is Ruby's own method.
    def add_entry(hash_list_id, **options)
      call(with_ids(options, hash_list_id: hash_list_id), __method__) do |api, request|
        build(HashListEntry, request('POST', "#{list_path(api)}/entries", body: without(api, 'hashListId'), request_options: request))
      end
    end

    # @param entry_id [String]
    # @return [nil]
    def remove_entry(entry_id, **options)
      call(with_ids(options, entry_id: entry_id), __method__) do |api, request|
        request('DELETE', "/hash-list-entries/#{Internal.segment(api['entryId'])}", request_options: request)
        nil
      end
    end

    private

    def list_path(api) = "/hash-lists/#{Internal.segment(api['hashListId'])}"
  end
end
