# frozen_string_literal: true

require 'json'
require 'securerandom'
require 'uri'
require_relative '../calmlens'
require_relative 'testing/fake_api'
require_relative 'testing/test_inputs'

module CalmLens
  # An offline client for tests. Calls run the real client's validation, encoding, retries and
  # error handling, then reach an in-memory stand-in for the API and CDN instead of the network.
  #
  # By default the stand-in is stateful: uploads create assets you can retrieve, list, filter,
  # search, move and delete, folders and hash lists behave like the API's, the CDN serves stored bytes, and errors use
  # the API's codes, HTTP statuses and body shape. It does not classify content: the `moderate:`
  # callback decides each upload, retry and rerun with a status or a {MockDecision}, and the events
  # feed gets the pipeline's `asset.uploaded`, `asset.classified`, `asset.<status>` and `asset.failed`
  # events. Without it, queued uploads stay `pending` until {#complete_processing} and the rest are
  # `allowed`. Content is kept only with `keepContentAfterProcessing: true`; otherwise it is removed
  # once classification is `completed`, as in the API.
  # A `purged` outcome removes the content with reason `policy`. The CDN answers like the real one:
  # `asset/not-available` (403) for blocked, purged, failed or removed content,
  # `viewer/age-confirmation-required` (403) for an age-restricted asset without
  # `viewer_claims: {age_confirmed: true}`, whatever the key, and `auth/permission-denied` (403)
  # for a private asset unless `api_key` comes from {.create_api_key} with an `assets:download`
  # grant (the default key has no grants), or the URL is signed: {CDN#sign_asset_url} returns
  # `{cdn_base_url}/assets/{project_id}/sig_…`, a readable grant that only the mock's CDN accepts,
  # which serves `original` only when signed with `original: true`. {#fetch_cdn} loads such a URL
  # without the API key, as a browser would; without the key or a grant, a private asset answers
  # as an unknown one does, `asset/not-found` (404) whatever its state, and only its placeholder is
  # public. {#decide} applies a reviewer's decision, and {Assets#wait_for_decision} takes no real
  # time: a pending asset times out at once.
  # Filters join comparisons with `;` (and), which binds tighter than `,` (or), and group them with
  # `( … )`; list cursors resume after the last item returned. {Assets#search} is the API's keyword
  # search: every query word (case-insensitive, up to 8) must appear in a searchable field, and
  # results carry the API's `score` and `matchedFields`, ranked by score and then newest first.
  #
  # To script exact responses, enqueue them: queued responses and errors are used first, in order,
  # before the stand-in answers.
  #
  # @example
  #   mock = CalmLens::MockServerClient.new(moderate: ->(input) { input.content.text&.include?('spam') ? 'blocked' : 'allowed' })
  #   asset = mock.assets.classify(name: 'note', content: {plain_text: 'hi', type: 'text/plain'})
  #   mock.assets.retrieve(asset_id: asset['id']).dig('classification', 'moderation', 'status') # => "allowed"
  #   mock.enqueue(status: 503, body: {code: 'server/unavailable', message: 'Try again'})
  class MockServerClient < ServerClient
    # A request the mock received.
    #
    # `path` is relative to `base_url` for API calls (`/projects/<id>/assets`, without `/v1`) and to
    # `cdn_base_url` for CDN requests, with each segment decoded. `query` holds the decoded query
    # string; an upload's holds only transport values (`wait`, `contentType`, sizes and part
    # numbers). `body` is the bytes sent (streams are read), or nil: JSON text, including a text
    # upload (`{name, ..., content: {plainText, type}}`), an upload form, or a later part's bytes.
    # `status` is the HTTP status the mock answered with, or nil when the request failed without a
    # response.
    Request = Struct.new(:method, :url, :path, :query, :headers, :body, :status, keyword_init: true) do
      # @return [Object] the body parsed as JSON.
      def json = body && JSON.parse(body)

      # An upload form's asset fields and file: `{'options' => Hash, 'file' => String}`, the file as
      # UTF-8 text for a `text/*` content type and binary otherwise; nil for any other body.
      # @return [Hash, nil]
      def form
        type = headers.find { |name, _| name.to_s.casecmp?('Content-Type') }&.last
        options, file = Testing::FakeAPI.upload_form(body, type)
        return nil unless options

        text = query['contentType'].to_s.downcase.start_with?('text/')
        { 'options' => JSON.parse(options), 'file' => text ? file.dup.force_encoding(Encoding::UTF_8) : file }
      end
    end

    # @return [Testing::State] the stored assets, folders, content and events.
    attr_reader :state

    # The prefix of mock API keys made by {.create_api_key}.
    API_KEY_PREFIX = 'sk_test_'
    # Simulated failures for {#fail_next_request}, besides API error codes and exceptions.
    REQUEST_FAILURES = %w[transport-error timeout].freeze
    # The methods {#fail_next_request} can target, by resource. Iterators are their list calls.
    OPERATIONS = { assets: %i[search list retrieve list_children list_timeline update create classify upload_part move
                              retry explain decide wait_for_decision remove_content delete batch],
                   folders: %i[list retrieve create update delete move],
                   hash_lists: %i[list retrieve create update delete list_entries add_entry remove_entry],
                   policies: %i[list retrieve retrieve_assigned create update reset upgrade set_automatic_updates delete
                                assign],
                   lenses: %i[list create retrieve update delete],
                   upload_presets: %i[list ensure delete],
                   project_settings: %i[get update],
                   metadata_fields: %i[list ensure delete],
                   text: %i[classify], events: %i[list],
                   cdn: %i[serve sign_asset_url get_asset_info] }.freeze
    private_constant :OPERATIONS
    # The operation names {#fail_next_request} accepts, in their camelCase form.
    OPERATION_NAMES = (OPERATIONS.flat_map do |resource, methods|
      methods.map { |name| "#{Internal.camelize(resource)}.#{Internal.camelize(name)}" }
    end + %w[ensureLens ensureLenses]).freeze
    private_constant :OPERATION_NAMES

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

    BASE62 = [*'0'..'9', *'A'..'Z', *'a'..'z'].join.freeze
    private_constant :BASE62

    # A new ID like the API's: `prefix`, `_` and 20 base62 characters from a CSPRNG (bytes 248 to
    # 255 are drawn again, so every character is equally likely).
    # @api private
    def self.new_id(prefix)
      body = +''
      SecureRandom.random_bytes(40).each_byte { |byte| body << BASE62[byte % 62] if byte < 248 } while body.size < 20
      "#{prefix}_#{body[0, 20]}"
    end

    # A clock in epoch milliseconds that follows the system time but never repeats or goes back.
    # @api private
    def self.monotonic_clock
      last = 0
      lock = Mutex.new
      -> { lock.synchronize { last = [(Time.now.to_f * 1000).to_i, last + 1].max } }
    end

    # @param project_id [String] `project-1` by default.
    # @param api_key [String] a key from {.create_api_key}; the default has no grants.
    # @param now [#call] returns the current time in epoch milliseconds. The default clock reads the
    #   system time but advances at least 1 ms per reading, so records made in a row have strictly
    #   increasing `createdAt` and order predictably. A clock you pass is used as is.
    # @param create_id [#call] receives the prefix of the kind of object (`asset`, `fldr`, `hl`, `hle`, `lens`,
    #   `evt` or `rev`) and returns a new ID. The default is like the API's: the prefix, `_` and 20 random base62
    #   characters, such as `asset_5Gm2Rk8XqT3wLp9VbN4c`.
    # @param moderate [#call, nil] decides each asset the mock moderates. It receives a
    #   {MockModerationInput} (the stored asset, its content, the trigger and whether the API would
    #   queue the work) and returns a status from {MockDecision::STATUSES} or a {MockDecision}. It is
    #   called on uploads (`assets.create`, `assets.classify`, `text.classify` and a final part:
    #   trigger `upload`), `assets.retry` (`retry`), `assets.explain` with `rerun: true` (`rerun`) and
    #   {#complete_processing} without a decision (`complete`). `pending` leaves the asset processing;
    #   for a re-run it keeps the asset's decision until {#complete_processing}, and a failed re-run
    #   keeps it.
    #   Without it, queued work other than `complete` stays `pending` and the rest is `allowed`. It
    #   runs while the mock handles a request, so it must not call the mock.
    # @param max_retries [Integer] retries after a retryable failure; 0 by default, so a simulated
    #   failure reaches the caller.
    # @param options [Hash] other {ServerClient#initialize} settings, such as `part_size_bytes`, except
    #   `api_key` and `transport`.
    #   Retries and decision checks wait no real time.
    def initialize(project_id: 'project-1', api_key: MockServerClient.create_api_key, base_url: 'https://api.calmlens.invalid/v1',
                   cdn_base_url: 'https://cdn.calmlens.invalid/v1', now: MockServerClient.monotonic_clock,
                   create_id: ->(prefix) { MockServerClient.new_id(prefix) }, moderate: nil, max_retries: 0, **options)
      raise Internal.invalid('moderate must respond to call') unless moderate.nil? || moderate.respond_to?(:call)

      @mock_lock = Mutex.new
      @queue = []
      @received = []
      @failures = []
      @call_key = :"calmlens_mock_call_#{object_id}"
      super(api_key: api_key, project_id: project_id, base_url: base_url, cdn_base_url: cdn_base_url, max_retries: max_retries,
            **options, transport: method(:receive))
      @fake = Testing::FakeAPI.new(project_id: project_id, base_url: self.base_url, cdn_base_url: self.cdn_base_url,
                                   now: now, create_id: create_id, moderate: moderate, api_key: api_key,
                                   grants: MockServerClient.grants_of(api_key))
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
    # status changes (`purged` also removes the content), the review joins `manualReviews` with
    # `decidedBy` the mock API key (`{ 'type' => 'api-key', 'id' => nil }`) and `applied: true`, an
    # `asset.<decision>` event whose `actor` is a `user` joins the events feed, and a waiting
    # `pendingReview` is settled ({Assets#decide} leaves it waiting, as with the API).
    # @param asset_id [String]
    # @param decision [String] `allowed`, `limited`, `age-restricted`, `blocked` or `purged`
    # @return [Hash] the asset
    # @raise [APIError] `asset/not-found` for an unknown asset
    # @raise [InvalidArgumentError] for any other decision, such as `pending` or `failed`
    def decide(asset_id, decision)
      @mock_lock.synchronize { @fake.decide(asset_id, decision) } || raise(not_found)
    end

    # Finishes processing an asset as the moderation pipeline would: with `decision`, or else what
    # `moderate:` answers for the `complete` trigger (`allowed` without it). A decision adds the
    # `asset.classified` and automated `asset.<status>` events (or `asset.failed`); `pending` leaves
    # the asset processing. It records no manual review.
    # @param asset_id [String]
    # @param decision [String, MockDecision, nil] a status from {MockDecision::STATUSES} or a {MockDecision}
    # @return [Hash] the asset
    # @raise [APIError] `asset/not-found` for an unknown asset
    # @raise [InvalidArgumentError] when the asset isn't processing or awaiting a queued re-run, or for
    #   an unknown decision
    def complete_processing(asset_id, decision = nil)
      @mock_lock.synchronize { @fake.complete_processing(asset_id, decision) } || raise(not_found)
    end

    # Changes the grants of the mock's API key, as editing the key in the portal would: later
    # requests, such as {CDN#serve}, use them. The key itself stays the same, so idempotency keys it
    # used still replay.
    # @param grants [Array<Hash>] like {.create_api_key}'s
    def api_key_grants=(grants)
      normalized = JSON.parse(JSON.generate(Internal.normalize(grants)))
      @mock_lock.synchronize { @fake.grants = normalized }
    end

    # Makes the next request (or the next one `operation` sends) fail instead of running, as if it
    # never completed. Each queued failure fails one request, so a client retry takes the next
    # queued failure or reaches the API. Queue several to fail several requests in a row.
    # @param failure [String, Exception] `transport-error` (`sdk/transport-error`), `timeout`
    #   (`sdk/timeout`), an API error code such as `upload/limit-exceeded` (answered with its HTTP
    #   status), or an exception for the transport to raise.
    # @param operation [String, nil] a method such as `assets.create`, `assets.upload_part`,
    #   `cdn.serve` or `ensure_lens` (JavaScript names such as `assets.uploadPart` work too).
    # @param details [Hash, nil] the API error's `details`, for an API error code.
    # @param retry_after [Integer, nil] whole seconds for the API error's `Retry-After` header.
    # @return [self]
    # @raise [InvalidArgumentError] for an unknown failure or operation, or a `retry_after` that isn't
    #   a whole number of seconds
    def fail_next_request(failure = 'transport-error', operation: nil, details: nil, retry_after: nil)
      unless failure.is_a?(Exception) || REQUEST_FAILURES.include?(failure) || ErrorCodes::STATUSES.key?(failure)
        raise Internal.invalid("Unknown failure #{failure.inspect}: use #{REQUEST_FAILURES.join(', ')}, an API error code or an exception")
      end
      unless retry_after.nil? || (retry_after.is_a?(Integer) && retry_after >= 0)
        raise Internal.invalid('retry_after must be a whole number of seconds')
      end
      raise Internal.invalid('details must be a Hash') unless details.nil? || details.is_a?(Hash)
      if !(failure.is_a?(String) && ErrorCodes::STATUSES.key?(failure)) && !(details.nil? && retry_after.nil?)
        raise Internal.invalid('details and retry_after apply only to an API error code')
      end

      name = operation && operation.to_s.split('.').map { |part| Internal.camelize(part) }.join('.')
      if name && !OPERATION_NAMES.include?(name)
        raise Internal.invalid("Unknown operation #{operation.inspect}: use one of #{OPERATION_NAMES.join(', ')}")
      end

      @mock_lock.synchronize { @failures << { failure: failure, operation: name, details: details, retry_after: retry_after } }
      self
    end

    # Fetches a URL of the mock's CDN as a browser would, with a GET and without the API key: a signed
    # asset URL from {CDN#sign_asset_url} (with a resource appended), or a public one from
    # {CDN#get_asset_url}. The request is recorded like any other. Error statuses are returned, not
    # raised. A private asset without a grant answers `asset/not-found` (404) whatever its state,
    # except for its public placeholder.
    # @param url [String]
    # @return [Response] with its body read
    def fetch_cdn(url)
      raise Internal.invalid('url must be a String') unless url.is_a?(String)

      @session.cdn('GET', url, {}, {}, authenticate: false)
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
    # `severity`, `title`, `facts`, and nil `description` and `assetId`) are filled in, and `actor`
    # is the mock API key (`{ 'type' => 'api-key', 'id' => nil }`) unless you pass one, such as
    # `actor: { type: 'user', id: nil }`. An event
    # with the `asset_id` of a stored asset carries that asset's snapshot as it is now, unless you
    # pass `asset`.
    # @param event [Hash] at least `type:`; snake_case keys are converted.
    # @return [Hash] the stored event
    def enqueue_event(event)
      @mock_lock.synchronize { JSON.parse(JSON.generate(@fake.enqueue_event(Internal.normalize(event)))) }
    end

    # @return [Array<Request>] copies of every request received since the mock was created or
    #   {#clear_requests} last ran, oldest first.
    def requests
      @mock_lock.synchronize { @received.map { |request| Request.new(**Marshal.load(Marshal.dump(request.to_h))) } }
    end

    # Forgets the requests recorded so far.
    # @return [self]
    def clear_requests
      @mock_lock.synchronize { @received.clear }
      self
    end

    # @return [Integer] queued responses and errors not used yet.
    def remaining_responses
      @mock_lock.synchronize { @queue.size }
    end

    def inspect = "#<#{self.class.name} project_id=#{project_id.inspect}>"

    private

    def not_found = APIError.class_for(404).new(ErrorCodes::ASSET_NOT_FOUND, 'Asset not found', status: 404)

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

    # The next queued failure for this request, which it uses up.
    def failure_for(call)
      index = @failures.index { |pending| pending[:operation].nil? || pending[:operation] == call&.dig(:operation) }
      index && @failures.delete_at(index)
    end

    # Returns the response rather than yielding it: the client accepts either from a transport.
    def receive(request, &)
      body = request.body.respond_to?(:read) ? read_stream(request.body) : request.body&.b
      path, query = Internal.split_url(request.url).last.split('?', 2)
      base = request.url.start_with?("#{cdn_base_url}/") ? URI(cdn_base_url).path : URI(base_url).path
      call = Thread.current[@call_key]
      # The later parts of a content upload sent in parts count as assets.uploadPart.
      call = { operation: 'assets.uploadPart' } if request.method == 'POST' && path.delete_prefix(base).match?(%r{\A/assets/[^/]+/part\z})
      @mock_lock.synchronize do
        record = Request.new(method: request.method, url: request.url, path: decode_path(path.delete_prefix(base)),
                             query: URI.decode_www_form(query.to_s).to_h, headers: request.headers.dup, body: body)
        @received << record
        response = answer(request, body, failure_for(call))
        record.status = response.status
        response
      end
    end

    def answer(request, body, failure)
      return fail_request(failure) if failure

      queued = @queue.shift
      raise queued if queued.is_a?(Exception)

      queued || @fake.handle(request.method, request.url, request.headers, body)
    end

    # Each segment of a request path, percent-decoded.
    def decode_path(path)
      path.split('/', -1).map do |segment|
        segment.b.gsub(/%(\h\h)/) { Regexp.last_match(1).hex.chr }.force_encoding(Encoding::UTF_8)
      end.join('/')
    end

    def fail_request(pending)
      failure = pending[:failure]
      raise failure if failure.is_a?(Exception)
      raise Errno::ECONNRESET, 'Simulated network failure' if failure == 'transport-error'
      raise Net::ReadTimeout, 'Simulated timeout' if failure == 'timeout'

      @fake.error(failure, details: pending[:details] && JSON.parse(JSON.generate(pending[:details])), retry_after: pending[:retry_after])
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
