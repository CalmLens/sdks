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
    # @option options [String] :cursor the previous page's `next_cursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `-createdAt` by default
    # @return [LensPage] {Page#auto_paging_each} fetches the rest.
    def list(**options)
      call(options, __method__) do |api, request|
        page(LensPage, request('GET', project('lenses'), query: api, request_options: request), options) { list(**_1) }
      end
    end

    # Creates a lens; its identifier must be new to the project (`lens/identifier-taken` otherwise).
    # @option options [String] :identifier
    # @option options [String] :name
    # @option options [String] :type `image`
    # @option options [Boolean] :active whether the CDN serves it; true by default
    # @option options [String, nil] :description
    # @option options [Hash, String, nil] :transform
    # @return [Lens]
    def create(**options)
      call(options, __method__) do |api, request|
        lens = build(Lens, request('POST', project('lenses'), body: api, request_options: request))
        @session.forget_lenses { |cached| cached['identifier'] == lens.identifier }
        lens
      end
    end

    # @param lens_id [String]
    # @return [Lens]
    def retrieve(lens_id, **options)
      call(with_ids(options, lens_id: lens_id), __method__) do |api, request|
        build(Lens, request('GET', lens_path(api), request_options: request))
      end
    end

    # Changes a lens's name, description, type, transform or whether the CDN serves it.
    # @param lens_id [String]
    # @return [Lens]
    def update(lens_id, **options)
      call(with_ids(options, lens_id: lens_id), __method__) do |api, request|
        lens = build(Lens, request('PATCH', lens_path(api), body: without(api, 'lensId'), request_options: request))
        @session.forget_lenses { |cached| cached['id'] == lens.id }
        lens
      end
    end

    # Deletes a lens; URLs that select it stop being served.
    # @param lens_id [String]
    # @return [nil]
    def delete(lens_id, **options)
      call(with_ids(options, lens_id: lens_id), __method__) do |api, request|
        request('DELETE', lens_path(api), request_options: request)
        @session.forget_lenses { |cached| cached['id'] == api['lensId'] }
        nil
      end
    end

    private

    # Lens definitions are sent as given, nil fields included. ServerClient#ensure_lenses calls it.
    def ensure_lenses(**options)
      call(options, __method__, keep_nil: true, prefix: nil) do |api, request|
        @session.ensure_lenses(api['lenses'], request).map { |lens| build(Lens, lens) }
      end
    end

    # ServerClient#ensure_lens calls it.
    def ensure_lens(**definition)
      call(definition, __method__, keep_nil: true, prefix: nil) { |api, request| build(Lens, @session.ensure_lenses([api], request).first) }
    end

    def lens_path(api) = "/lenses/#{Internal.segment(api['lensId'])}"
  end
end
