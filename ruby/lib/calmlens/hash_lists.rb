# frozen_string_literal: true

module CalmLens
  # Hash lists hold perceptual hashes of images. Image uploads are compared with every list in the
  # project: a `flag` list reports matches, a `block` list also blocks close matches. Reach it through
  # {ServerClient#hash_lists}.
  class HashLists < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'hashLists'

    # Lists one page of the project's hash lists, newest first unless `sort` says otherwise.
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `-createdAt` by default
    # @return [Hash] a cursor page: items, nextCursor and hasMore.
    def list(options = {})
      call(options, __method__) do |api, request|
        cursor_page(request('GET', project('hash-lists'), query: api, request_options: request), 'hash list')
      end
    end

    # Iterates every hash list, fetching pages as needed.
    # @param options [Hash] the options of {#list}; `cursor` sets the starting position.
    # @yieldparam hash_list [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      each_item(options, __method__, method(:list), &block)
    end

    # @option options [String] :hash_list_id
    # @return [Hash] the hash list
    def retrieve(options)
      call(options, __method__) { |api, request| request('GET', list_path(api), request_options: request) }
    end

    # @option options [String] :name
    # @option options [String] :action `flag` or `block`
    # @option options [String, nil] :description
    # @return [Hash] the hash list
    def create(options)
      call(options, __method__) { |api, request| request('POST', project('hash-lists'), body: api, request_options: request) }
    end

    # Renames a list or changes what its matches do. The new action applies to later uploads.
    # @option options [String] :hash_list_id
    # @option options [String] :name
    # @option options [String, nil] :description
    # @option options [String] :action `flag` or `block`
    # @return [Hash] the hash list
    def update(options)
      call(options, __method__) do |api, request|
        request('PATCH', list_path(api), body: without(api, 'hashListId'), request_options: request)
      end
    end

    # Deletes the list and every entry in it. Later uploads are no longer compared with it.
    # @option options [String] :hash_list_id
    # @return [nil]
    def delete(options)
      call(options, __method__) do |api, request|
        request('DELETE', list_path(api), request_options: request)
        nil
      end
    end

    # Lists one page of a list's entries, newest first unless `sort` says otherwise.
    # @option options [String] :hash_list_id
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `-createdAt` by default
    # @return [Hash] a cursor page: items, nextCursor and hasMore.
    def list_entries(options)
      call(options, __method__) do |api, request|
        request('GET', "#{list_path(api)}/entries", query: without(api, 'hashListId'), request_options: request)
      end
    end

    # Iterates every entry of a list, fetching pages as needed.
    # @param options [Hash] the options of {#list_entries}; `cursor` sets the starting position.
    # @yieldparam entry [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each_entry(options, &block)
      return enum_for(:each_entry, options) unless block

      each_item(options, __method__, method(:list_entries), &block)
    end

    # Adds a PDQ hash, or an image asset's hash; a hash already in the list returns its entry.
    # @option options [String] :hash_list_id
    # @option options [String] :hash 64 hexadecimal characters; send this or `asset_id`
    # @option options [Integer] :quality
    # @option options [String] :asset_id an image asset whose hash to add
    # @option options [String] :label
    # @return [Hash] the entry
    def add_entry(options)
      call(options, __method__) do |api, request|
        request('POST', "#{list_path(api)}/entries", body: without(api, 'hashListId'), request_options: request)
      end
    end

    # @option options [String] :entry_id
    # @return [nil]
    def remove_entry(options)
      call(options, __method__) do |api, request|
        request('DELETE', "/hash-list-entries/#{Internal.segment(api['entryId'])}", request_options: request)
        nil
      end
    end

    private

    def list_path(api) = "/hash-lists/#{Internal.segment(api['hashListId'])}"
  end
end
