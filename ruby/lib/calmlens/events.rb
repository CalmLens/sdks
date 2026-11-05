# frozen_string_literal: true

module CalmLens
  # The project's events feed. Reach it through {ServerClient#events}.
  class Events < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'events'

    # Lists events after a cursor, oldest first. Without `cursor`, returns no events and a
    # `nextCursor` for the current time: save it, then pass each response's `nextCursor` as `cursor`.
    # `types` and `asset_id` narrow the feed to some event types or one asset's events. A cursor
    # belongs to the filters it was issued with, so pass the same ones with each `cursor`.
    # @option options [String] :cursor the `nextCursor` of a previous response
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [Array<String>] :types event types to list, such as `asset.blocked`
    # @option options [String] :asset_id list only this asset's events
    # @return [Hash] `{'items', 'nextCursor', 'hasMore'}`; `nextCursor` is never nil
    def list(options = {})
      call(options, __method__) do |api, request|
        request('GET', project('events'), query: feed_query(api), request_options: request)
      end
    end

    # Iterates pages from `cursor` until `hasMore` is false. Persist each page's `nextCursor` once its
    # events are handled, and resume from it later. Raises `sdk/invalid-response` (with
    # `details['cursor']`) instead of looping when a page with more to follow repeats a cursor.
    # @yieldparam page [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each_page(options = {})
      return enum_for(:each_page, options) unless block_given?

      api, request = call(options, __method__) { |*split| split }
      sent = api.key?('cursor') ? [api['cursor']] : []
      loop do
        page = list(api.merge('request_options' => request))
        unless page.is_a?(Hash) && page['items'].is_a?(Array) && page['nextCursor'].is_a?(String)
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Events page has no items or next cursor')
        end

        new_cursor!(sent, page['nextCursor']) if page['hasMore'] == true
        yield page
        break unless page['hasMore'] == true

        api = api.merge('cursor' => page['nextCursor'])
      end
      nil
    end

    # Iterates the events after `cursor`, across pages. See {#each_page} to track the cursor.
    # @yieldparam event [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      each_page(options) { |page| page['items'].each(&block) }
    end

    private

    # The API takes the types as one comma-separated value; an empty list filters nothing.
    def feed_query(api)
      types = api['types']
      return api unless api.key?('types')
      raise Internal.invalid('types must be an Array of event type Strings') unless types.is_a?(Array) && types.all?(String)

      api.merge('types' => types.empty? ? nil : types.join(','))
    end
  end
end
