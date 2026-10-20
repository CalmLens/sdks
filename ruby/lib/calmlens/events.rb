# frozen_string_literal: true

module CalmLens
  # The project's events feed. Reach it through {ServerClient#events}.
  class Events < Resource
    # Lists events after a cursor, oldest first. Without `after`, returns no events and a cursor
    # for the current time: save it, then pass each response's `cursor` as `after`.
    # @option options [String] :after a cursor from a previous response
    # @option options [Integer] :limit default 50
    # @return [Hash] `{'events', 'cursor', 'hasMore'}`
    def list(options = {})
      call(options) { |api, request| request('GET', project('events'), query: api, request_options: request) }
    end

    # Iterates pages from `after` until `hasMore` is false. Persist each page's `cursor` once its
    # events are handled, and resume from it later.
    # @yieldparam page [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each_page(options = {})
      return enum_for(:each_page, options) unless block_given?

      api, request = call(options) { |*split| split }
      loop do
        page = list(api.merge('request_options' => request))
        unless page.is_a?(Hash) && page['events'].is_a?(Array) && page['cursor'].is_a?(String)
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Events page has no events or cursor')
        end

        yield page
        break unless page['hasMore'] == true

        api = api.merge('after' => page['cursor'])
      end
      nil
    end

    # Iterates the events after `after`, across pages. See {#each_page} to track the cursor.
    # @yieldparam event [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      each_page(options) { |page| page['events'].each(&block) }
    end
  end
end
