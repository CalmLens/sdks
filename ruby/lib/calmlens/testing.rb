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
  # move and delete, folders behave like the API's, the CDN serves stored bytes, and errors use
  # the API's codes, HTTP statuses and body shape. It does not classify content: assets moderated
  # synchronously get `analyzed_outcome` and queued ones `queued_outcome`. Content is kept only with
  # `keepContentAfterProcessing: true`; otherwise it is removed once processing is `done`, as in the API.
  #
  # To script exact responses, enqueue them: queued responses and errors are used first, in order,
  # before the stand-in answers.
  #
  # @example
  #   mock = CalmLens::MockServerClient.new
  #   asset = mock.assets.moderate(name: 'note', content: {plain_text: 'hi', type: 'text/plain'})
  #   mock.assets.retrieve(asset_id: asset['id']).dig('moderation', 'status') # => "approved"
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

    # @param project_id [String]
    # @param now [#call] returns the current time in epoch milliseconds.
    # @param create_id [#call] returns a new ID.
    # @param queued_outcome [String] the outcome of assets created with {Assets#create}: `pending`
    #   (processing, moderation pending), `approved` or `rejected` (processing done with that
    #   decision) or `failed` (processing failed, retryable).
    # @param analyzed_outcome [String, Hash, #call] the result of {Assets#moderate}: an outcome, fields
    #   to deep-merge into the asset (`{'moderation' => {'status' => 'rejected', 'action' => 'hide'}}`;
    #   the outcome follows `moderation.status`, or is `failed` when `processing.status` is `failed`,
    #   and is `approved` otherwise), or a callable that receives a copy of the asset and returns either.
    # @param options [Hash] other {ServerClient#initialize} settings, except `api_key` and `transport`.
    #   Retries wait no time unless a queued response sets `Retry-After`.
    def initialize(project_id: 'project-1', base_url: 'https://api.calmlens.invalid/v1',
                   cdn_base_url: 'https://cdn.calmlens.invalid/v1', now: -> { (Time.now.to_f * 1000).to_i },
                   create_id: -> { SecureRandom.uuid }, queued_outcome: 'pending', analyzed_outcome: 'approved',
                   **options)
      @mock_lock = Mutex.new
      @queue = []
      @received = []
      super(api_key: 'mock-key', project_id: project_id, base_url: base_url, cdn_base_url: cdn_base_url,
            retry_base_delay: 0, **options, transport: method(:receive))
      @fake = Testing::FakeAPI.new(project_id: project_id, base_url: self.base_url, cdn_base_url: self.cdn_base_url,
                                   now: now, create_id: create_id, queued_outcome: queued_outcome,
                                   analyzed_outcome: analyzed_outcome)
      @state = @fake.state
    end

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

    # Returns the response rather than yielding it: the client accepts either from a transport.
    def receive(request, &)
      body = request.body.respond_to?(:read) ? read_stream(request.body) : request.body&.b
      path, query = Internal.split_url(request.url).last.split('?', 2)
      base = request.url.start_with?("#{cdn_base_url}/") ? URI(cdn_base_url).path : URI(base_url).path
      @mock_lock.synchronize do
        @received << Request.new(method: request.method, url: request.url, path: path.delete_prefix(base),
                                 query: URI.decode_www_form(query.to_s).to_h, headers: request.headers.dup,
                                 body: body)
        queued = @queue.shift
        raise queued if queued.is_a?(Exception)

        queued || @fake.handle(request.method, request.url, request.headers, body)
      end
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
