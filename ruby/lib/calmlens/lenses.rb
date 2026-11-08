# frozen_string_literal: true

module CalmLens
  # The project's lenses: named image transforms the CDN applies at `/@<identifier>`. The CDN serves
  # files made with each lens's current definition. Reach it through {ServerClient#lenses};
  # {ServerClient#ensure_lenses} creates or changes lenses by identifier, for applications that
  # declare theirs in code.
  class Lenses < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'lenses'

    # Lists one page of the project's lenses, newest first unless `sort` says otherwise.
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `-createdAt` by default
    # @return [Hash] a cursor page: items, nextCursor and hasMore.
    def list(options = {})
      call(options, __method__) do |api, request|
        cursor_page(request('GET', project('lenses'), query: api, request_options: request), 'lens')
      end
    end

    # Iterates every lens of the project, fetching pages as needed.
    # @param options [Hash] the options of {#list}; `cursor` sets the starting position.
    # @yieldparam lens [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      each_item(options, __method__, method(:list), &block)
    end

    # Creates a lens; its identifier must be new to the project (`lens/identifier-taken` otherwise).
    # @option options [String] :identifier
    # @option options [String] :name
    # @option options [String] :type `image`
    # @option options [Boolean] :active whether the CDN serves it; true by default
    # @option options [String, nil] :description
    # @option options [Hash, String, nil] :transform
    # @return [Hash] the lens
    def create(options)
      call(options, __method__) do |api, request|
        lens = request('POST', project('lenses'), body: api, request_options: request)
        @session.forget_lenses { |cached| cached['identifier'] == lens['identifier'] } if lens.is_a?(Hash)
        lens
      end
    end

    # @option options [String] :lens_id
    # @return [Hash] the lens
    def retrieve(options)
      call(options, __method__) { |api, request| request('GET', lens_path(api), request_options: request) }
    end

    # Changes a lens's name, description, type, transform or whether the CDN serves it.
    # @option options [String] :lens_id
    # @return [Hash] the lens
    def update(options)
      call(options, __method__) do |api, request|
        lens = request('PATCH', lens_path(api), body: without(api, 'lensId'), request_options: request)
        @session.forget_lenses { |cached| cached['id'] == lens['id'] } if lens.is_a?(Hash)
        lens
      end
    end

    # Deletes a lens; URLs that select it stop being served.
    # @option options [String] :lens_id
    # @return [nil]
    def delete(options)
      call(options, __method__) do |api, request|
        request('DELETE', lens_path(api), request_options: request)
        @session.forget_lenses { |cached| cached['id'] == api['lensId'] }
        nil
      end
    end

    # Lens definitions are sent as given, nil fields included.
    # @api private
    def ensure_lenses(options)
      call(options, __method__, keep_nil: true, prefix: nil) { |api, request| @session.ensure_lenses(api['lenses'], request) }
    end

    # @api private
    def ensure_lens(options)
      call(options, __method__, keep_nil: true, prefix: nil) { |api, request| @session.ensure_lenses([api], request).first }
    end

    private

    def lens_path(api) = "/lenses/#{Internal.segment(api['lensId'])}"
  end
end
