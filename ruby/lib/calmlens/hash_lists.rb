# frozen_string_literal: true

module CalmLens
  # Hash lists hold perceptual hashes of images. Image uploads are compared with every list in the
  # project: a `flag` list reports matches, a `block` list also blocks close matches. Reach it through
  # {ServerClient#hash_lists}.
  class HashLists < Resource
    # Lists one page of the project's hash lists, newest first.
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @return [Hash] a cursor page: items, nextCursor, hasMore, pageSize and ordering.
    def list(options = {})
      call(options) do |api, request|
        response = request('GET', project('hash-lists'), query: api, request_options: request)
        valid = response.is_a?(Hash) && response['items'].is_a?(Array)
        raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Invalid hash list page') unless valid

        response
      end
    end

    # @option options [String] :hash_list_id
    # @return [Hash] the hash list
    def retrieve(options)
      call(options) { |api, request| request('GET', list_path(api), request_options: request) }
    end

    # @option options [String] :name
    # @option options [String] :action `flag` or `block`
    # @option options [String, nil] :description
    # @return [Hash] the hash list
    def create(options)
      call(options) { |api, request| request('POST', project('hash-lists'), body: api, request_options: request) }
    end

    # Renames a list or changes what its matches do. The new action applies to later uploads.
    # @option options [String] :hash_list_id
    # @option options [String] :name
    # @option options [String, nil] :description
    # @option options [String] :action `flag` or `block`
    # @return [Hash] the hash list
    def update(options)
      call(options) do |api, request|
        request('PATCH', list_path(api), body: without(api, 'hashListId'), request_options: request)
      end
    end

    # Deletes the list and every entry in it. Later uploads are no longer compared with it.
    # @option options [String] :hash_list_id
    # @return [nil]
    def delete(options)
      call(options) do |api, request|
        request('DELETE', list_path(api), request_options: request)
        nil
      end
    end

    # Lists one page of a list's entries, newest first.
    # @option options [String] :hash_list_id
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @return [Hash] a cursor page: items, nextCursor, hasMore, pageSize and ordering.
    def list_entries(options)
      call(options) do |api, request|
        request('GET', "#{list_path(api)}/entries", query: without(api, 'hashListId'), request_options: request)
      end
    end

    # Adds a PDQ hash, or an image asset's hash; a hash already in the list returns its entry.
    # @option options [String] :hash_list_id
    # @option options [String] :hash 64 hexadecimal characters; send this or `asset_id`
    # @option options [Integer] :quality
    # @option options [String] :asset_id an image asset whose hash to add
    # @option options [String] :label
    # @return [Hash] the entry
    def add_entry(options)
      call(options) do |api, request|
        request('POST', "#{list_path(api)}/entries", body: without(api, 'hashListId'), request_options: request)
      end
    end

    # @option options [String] :entry_id
    # @return [nil]
    def remove_entry(options)
      call(options) do |api, request|
        request('DELETE', "/hash-list-entries/#{Internal.segment(api['entryId'])}", request_options: request)
        nil
      end
    end

    private

    def list_path(api) = "/hash-lists/#{Internal.segment(api['hashListId'])}"
  end
end
