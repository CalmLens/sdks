# frozen_string_literal: true

require 'json'
require 'securerandom'
require 'uri'
require_relative '../calmlens'
require_relative 'testing/fake_api'

module CalmLens
  # An offline client for tests. Calls run the real client's validation, encoding, retries and
  # error handling, then reach an in-memory stand-in for the API and CDN instead of the network.
  #
  # By default the stand-in is stateful: uploads create assets you can retrieve, list, filter,
  # search, move and delete, folders behave like the API's, the CDN serves stored bytes, and errors use
  # the API's codes, HTTP statuses and body shape. It does not classify content: assets moderated
  # synchronously get `analyzed_outcome` and queued ones `queued_outcome`. Content is kept only with
  # `keepContentAfterProcessing: true`; otherwise it is removed once classification is `completed`, as in the API.
  # A `purged` outcome removes the content with reason `policy`. The CDN answers like the real one:
  # `asset/not-available` (403) for blocked, purged, failed or removed content, and
  # `asset/api-key-missing-permission` (403) for a private asset, or a public age-restricted one without
  # `allow_age_restricted: true`, unless `api_key` comes from {.create_api_key} with an `assets:download`
  # grant. The default key has no grants. {#decide} applies a reviewer's decision, and
  # {Assets#wait_for_decision} takes no real time: a pending asset times out at once.
  # Filters join comparisons with `;` (and), which binds tighter than `,` (or), and group them with
  # `( … )`; list cursors resume after the last item returned. {Assets#search} is the API's keyword
  # search: every query word (case-insensitive, up to 8) must appear in a searchable field, and
  # results carry the API's `score` and `matchedFields`, ranked by score and then newest first.
  #
  # To script exact responses, enqueue them: queued responses and errors are used first, in order,
  # before the stand-in answers.
  #
  # @example
  #   mock = CalmLens::MockServerClient.new
  #   asset = mock.assets.classify(name: 'note', content: {plain_text: 'hi', type: 'text/plain'})
  #   mock.assets.retrieve(asset_id: asset['id']).dig('classification', 'moderation', 'status') # => "allowed"
  #   mock.enqueue(status: 503, body: {code: 'server/unavailable', message: 'Try again'})
  class MockServerClient < ServerClient
    # A request the mock received.
    #
    # `path` is relative to `base_url` for API calls (`/projects/<id>/assets`) and to
    # `cdn_base_url` for CDN requests. `query` holds the decoded query string. `body` is the bytes
    # sent: JSON text, or the uploaded content (streams are read), or nil.
    Request = Struct.new(:method, :url, :path, :query, :headers, :body, keyword_init: true) do
      # @return [Object] the body parsed as JSON.
      def json = body && JSON.parse(body)
    end

    # @return [Testing::State] the stored assets, folders, content and events.
    attr_reader :state

    # The prefix of mock API keys made by {.create_api_key}.
    API_KEY_PREFIX = 'sk_test_'
    # Simulated failures for {#fail_next_request}, besides API error codes and exceptions.
    REQUEST_FAILURES = %w[transport-error timeout].freeze
    # The methods {#fail_next_request} can target, by resource. Iterators are their list calls.
    OPERATIONS = { assets: %i[search list retrieve list_children update create classify upload_part create_signed_url move
                              retry explain wait_for_decision delete_content delete],
                   folders: %i[list retrieve create update delete move], text: %i[classify], events: %i[list],
                   cdn: %i[serve] }.freeze
    private_constant :OPERATIONS

    # A mock API key carrying permission grants, such as
    # `[{ actions: ['assets:download'], folderId: nil, includeSubfolders: true }]` for CDN reads of
    # private and age-restricted assets.
    # @param grants [Array<Hash>] snake_case keys are converted.
    # @return [String]
    def self.create_api_key(grants = [])
      API_KEY_PREFIX + [JSON.generate(Internal.normalize(grants))].pack('m0').tr('+/', '-_').delete('=')
    end

    # The grants a key from {.create_api_key} carries; none for any other key.
    # @api private
    def self.grants_of(api_key)
      return [] unless api_key.start_with?(API_KEY_PREFIX)

      encoded = api_key.delete_prefix(API_KEY_PREFIX).tr('-_', '+/')
      grants = JSON.parse("#{encoded}#{'=' * (-encoded.size % 4)}".unpack1('m0'))
      grants.is_a?(Array) ? grants.grep(Hash) : []
    rescue ArgumentError, JSON::ParserError
      []
    end

    # Signs an upload token like {UploadTokens#sign}, with the same checks, at a fixed time and with
    # a fixed nonce, so tests can compare exact tokens.
    # @param api_key [String]
    # @param options [Hash] the options of {UploadTokens#sign}
    # @param now [Integer] the signing time in milliseconds since the Unix epoch
    # @param nonce [String]
    # @return [Hash] `{'token', 'expiresAt'}`
    def self.sign_upload_token(api_key, options, now:, nonce:)
      UploadTokens.sign_at(api_key, options, now: now, nonce: nonce)
    rescue KeyError, TypeError, ArgumentError, JSON::GeneratorError, EncodingError => e
      raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, e.message), cause: e
    end

    # A clock in epoch milliseconds that follows the system time but never repeats or goes back.
    # @api private
    def self.monotonic_clock
      last = 0
      lock = Mutex.new
      -> { lock.synchronize { last = [(Time.now.to_f * 1000).to_i, last + 1].max } }
    end

    # @param project_id [String]
    # @param api_key [String] a key from {.create_api_key}; the default has no grants.
    # @param now [#call] returns the current time in epoch milliseconds. The default clock reads the
    #   system time but advances at least 1 ms per reading, so records made in a row have strictly
    #   increasing `createdAt` and order predictably. A clock you pass is used as is.
    # @param create_id [#call] returns a new ID.
    # @param queued_outcome [String] the outcome of assets created with {Assets#create}: `pending`
    #   (processing, moderation pending), `allowed`, `limited`, `age-restricted`, `blocked` or `purged` (processing
    #   done with that moderation status; `purged` also removes the content) or `failed` (processing
    #   failed, retryable).
    # @param analyzed_outcome [String, Hash, #call] the result of {Assets#classify}: an outcome, fields
    #   to deep-merge into the asset (`{'classification' => {'moderation' => {'status' => 'blocked'}}}`;
    #   the outcome follows `classification.moderation.status`, or is `failed` when `classification.status` is `failed`,
    #   and is `allowed` otherwise), or a callable that receives a copy of the asset and returns either.
    # @param options [Hash] other {ServerClient#initialize} settings, except `api_key` and `transport`.
    #   Retries and decision checks wait no real time.
    def initialize(project_id: 'project-1', api_key: MockServerClient.create_api_key, base_url: 'https://api.calmlens.invalid/v1',
                   cdn_base_url: 'https://cdn.calmlens.invalid/v1', now: MockServerClient.monotonic_clock,
                   create_id: -> { SecureRandom.uuid }, queued_outcome: 'pending', analyzed_outcome: 'allowed',
                   **options)
      @mock_lock = Mutex.new
      @queue = []
      @received = []
      @failures = []
      @call_key = :"calmlens_mock_call_#{object_id}"
      super(api_key: api_key, project_id: project_id, base_url: base_url, cdn_base_url: cdn_base_url,
            **options, transport: method(:receive))
      @fake = Testing::FakeAPI.new(project_id: project_id, base_url: self.base_url, cdn_base_url: self.cdn_base_url,
                                   now: now, create_id: create_id, queued_outcome: queued_outcome,
                                   analyzed_outcome: analyzed_outcome, grants: MockServerClient.grants_of(api_key))
      @state = @fake.state
      # Like the API, the stand-in checks upload sizes itself, in the API's order.
      @session.defer_upload_checks = true
      OPERATIONS.each { |resource, methods| track(public_send(resource), Internal.camelize(resource), methods) }
      # Retries and decision checks advance this clock instead of sleeping.
      @waited = 0.0
      @session.use_clock(monotonic: -> { @mock_lock.synchronize { @waited } },
                         pause: ->(seconds) { @mock_lock.synchronize { @waited += seconds } })
    end

    # Applies a reviewer's decision to a stored asset, as the portal or API would: the moderation
    # status changes (`purged` also removes the content), the review joins `manualReviews`, and an
    # `asset.<decision>` event with a `decided-by: reviewer` fact joins the events feed.
    # @param asset_id [String]
    # @param decision [String] `allowed`, `limited`, `age-restricted`, `blocked` or `purged`
    # @return [Hash] the asset
    # @raise [APIError] `asset/not-found` for an unknown asset
    def decide(asset_id, decision)
      asset = @mock_lock.synchronize { @fake.decide(asset_id, decision) }
      return asset if asset

      raise APIError.class_for(404).new(ErrorCodes::ASSET_NOT_FOUND, 'Asset not found', status: 404)
    end

    # Changes the grants of the mock's API key, as editing the key in the portal would: later
    # requests, such as {CDN#serve}, use them. The key itself stays the same, so idempotency keys it
    # used still replay.
    # @param grants [Array<Hash>] like {.create_api_key}'s
    def api_key_grants=(grants)
      normalized = JSON.parse(JSON.generate(Internal.normalize(grants)))
      @mock_lock.synchronize { @fake.grants = normalized }
    end

    # Makes the next call (or the next call to `operation`) fail instead of running, as if its
    # request never completed: every request it sends, retries included, fails the same way. Queue
    # several to fail several calls in a row; each is used once.
    # @param failure [String, Exception] `transport-error` (`sdk/transport-error`), `timeout`
    #   (`sdk/timeout`), an API error code such as `upload/limit-exceeded` (answered with its HTTP
    #   status), or an exception for the transport to raise.
    # @param operation [String, nil] a method such as `assets.create`, `assets.upload_part`,
    #   `cdn.serve` or `ensure_lens` (JavaScript names such as `assets.uploadPart` work too).
    # @return [self]
    def fail_next_request(failure = 'transport-error', operation: nil)
      unless failure.is_a?(Exception) || REQUEST_FAILURES.include?(failure) || ErrorCodes::STATUSES.key?(failure)
        raise Internal.invalid("Unknown failure #{failure.inspect}: use #{REQUEST_FAILURES.join(', ')}, an API error code or an exception")
      end

      name = operation && operation.to_s.split('.').map { |part| Internal.camelize(part) }.join('.')
      @mock_lock.synchronize { @failures << { failure: failure, operation: name } }
      self
    end

    # @see ServerClient#ensure_lenses
    def ensure_lenses(options) = operation('ensureLenses') { super }

    # @see ServerClient#ensure_lens
    def ensure_lens(options) = operation('ensureLens') { super }

    # Queues a JSON response for the next request.
    # @param status [Integer]
    # @param body [Object] encoded as JSON
    # @param headers [Hash{String => String}]
    # @return [self]
    def enqueue(body:, status: 200, headers: {})
      enqueue_raw(status: status, body: JSON.generate(body), headers: { 'content-type' => 'application/json' }.merge(headers))
    end

    # Queues a response with a raw body, such as malformed JSON or binary CDN content.
    # @return [self]
    def enqueue_raw(body:, status: 200, headers: {})
      response = Response.new(status: status, body: body.to_s.dup,
                              headers: { 'x-request-id' => "mock-#{SecureRandom.hex(8)}" }.merge(headers))
      @mock_lock.synchronize { @queue << response }
      self
    end

    # Fails the next request with an exception raised by the transport, such as
    # `Net::ReadTimeout.new` (raised as `sdk/timeout`) or `Errno::ECONNRESET.new`
    # (`sdk/transport-error`). The client wraps it exactly as it wraps real network failures.
    # @return [self]
    def enqueue_error(error)
      @mock_lock.synchronize { @queue << error }
      self
    end

    # Adds an event to the mock's events feed. Fields you omit (`id`, `projectId`, `createdAt`,
    # `severity`, `title`, `facts`) are filled in.
    # @param event [Hash] at least `type:`; snake_case keys are converted.
    # @return [Hash] the stored event
    def enqueue_event(event)
      @mock_lock.synchronize { JSON.parse(JSON.generate(@fake.add_event(Internal.normalize(event)))) }
    end

    # @return [Array<Request>] copies of every request received so far, oldest first.
    def requests
      @mock_lock.synchronize { @received.map { |request| Request.new(**Marshal.load(Marshal.dump(request.to_h))) } }
    end

    # @return [Integer] queued responses and errors not used yet.
    def remaining_responses
      @mock_lock.synchronize { @queue.size }
    end

    def inspect = "#<#{self.class.name} project_id=#{project_id.inspect}>"

    private

    # Wraps a resource's methods so requests know which call sent them, for {#fail_next_request}.
    def track(resource, prefix, methods)
      mock = self
      resource.singleton_class.prepend(Module.new do
        methods.each do |name|
          define_method(name) do |*args, **options, &block|
            mock.send(:operation, "#{prefix}.#{Internal.camelize(name)}") { super(*args, **options, &block) }
          end
        end
      end)
    end

    # Runs a call; calls it makes (text.classify through assets.classify) count as the outer one.
    def operation(name)
      return yield if Thread.current[@call_key]

      begin
        Thread.current[@call_key] = { operation: name }
        yield
      ensure
        Thread.current[@call_key] = nil
      end
    end

    # The failure for this request: the one its call already took, or the next queued for it.
    def failure_for(call)
      return call[:failure] if call&.key?(:failure)

      index = @failures.index { |pending| pending[:operation].nil? || pending[:operation] == call&.dig(:operation) }
      return unless index

      failure = @failures.delete_at(index)[:failure]
      call[:failure] = failure if call
      failure
    end

    # Returns the response rather than yielding it: the client accepts either from a transport.
    def receive(request, &)
      body = request.body.respond_to?(:read) ? read_stream(request.body) : request.body&.b
      path, query = Internal.split_url(request.url).last.split('?', 2)
      base = request.url.start_with?("#{cdn_base_url}/") ? URI(cdn_base_url).path : URI(base_url).path
      call = Thread.current[@call_key]
      @mock_lock.synchronize do
        @received << Request.new(method: request.method, url: request.url, path: path.delete_prefix(base),
                                 query: URI.decode_www_form(query.to_s).to_h, headers: request.headers.dup,
                                 body: body)
        failure = failure_for(call)
        return fail_request(failure) if failure

        queued = @queue.shift
        raise queued if queued.is_a?(Exception)

        queued || @fake.handle(request.method, request.url, request.headers, body)
      end
    end

    def fail_request(failure)
      raise failure if failure.is_a?(Exception)
      raise Errno::ECONNRESET, 'Simulated network failure' if failure == 'transport-error'
      raise Net::ReadTimeout, 'Simulated timeout' if failure == 'timeout'

      @fake.error(failure)
    end

    def read_stream(io)
      buffer = String.new(encoding: Encoding::BINARY)
      while (chunk = io.read(64 * 1024))
        buffer << chunk
      end
      buffer
    end
  end
end
