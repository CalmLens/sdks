# frozen_string_literal: true

require 'json'
require 'securerandom'
require 'timeout'
require 'uri'

module CalmLens
  # Sends API and CDN requests: authentication, JSON encoding, retries and error mapping.
  # The resources share one session per client. It never prints the API key.
  # @api private
  class Session
    RETRYABLE_STATUSES = [429, 502, 503, 504].freeze
    USER_AGENT = "calmlens-ruby/#{VERSION} (ruby/#{RUBY_VERSION})".freeze

    # Raised through the transport so an exception from the caller's streaming block is
    # re-raised unchanged instead of being mistaken for a network failure.
    class CallerError < Exception # rubocop:disable Lint/InheritException
      attr_reader :error

      def initialize(error)
        super(error.message)
        @error = error
      end
    end

    attr_reader :project_id, :base_url, :cdn_base_url
    # Leaves the upload size checks the API also makes (part and image sizes) to the API, so an
    # offline stand-in answers them like the API does. {MockServerClient} sets it.
    attr_accessor :defer_upload_checks

    def initialize(api_key:, project_id:, base_url:, cdn_base_url:, timeout:, open_timeout:, max_retries:,
                   retry_base_delay:, max_response_bytes:, upload_timeout:, transport:)
      @api_key = api_key
      @project_id = project_id
      @base_url = base_url
      @cdn_base_url = cdn_base_url
      @timeout = timeout
      @open_timeout = open_timeout
      @max_retries = max_retries
      @retry_base_delay = retry_base_delay
      @max_response_bytes = max_response_bytes
      @upload_timeout = upload_timeout
      @transport = transport
      @lenses = {}
      @lens_lock = Mutex.new
    end

    def inspect = "#<#{self.class.name} project_id=#{@project_id.inspect} api_key=[REDACTED]>"

    # Seconds on a monotonic clock, for decision deadlines. {MockServerClient} replaces it.
    def monotonic = @monotonic ? @monotonic.call : Process.clock_gettime(Process::CLOCK_MONOTONIC)

    # Waits between retries and decision checks. {MockServerClient} replaces it.
    def pause(seconds) = @pause ? @pause.call(seconds) : sleep(seconds)

    # Replaces the clock and wait used between retries and decision checks, so a mock's waits take no
    # real time.
    def use_clock(monotonic:, pause:)
      @monotonic = monotonic
      @pause = pause
    end

    def close
      @transport.close if @transport.respond_to?(:close)
    end

    def project(path) = "/projects/#{Internal.segment(@project_id)}/#{path}"

    # Sends an API request and returns the parsed JSON body (nil for an empty 204 or DELETE response).
    #
    # @param idempotent [Boolean] send an `Idempotency-Key` (generated unless the caller gave one),
    #   reused across retries so the API runs the request at most once.
    # @param upload [Boolean] a binary upload: `upload_timeout`, when set, limits each attempt.
    def request(method, path, request_options:, query: {}, body: nil, raw: nil, headers: {}, idempotent: false,
                upload: false)
      url = @base_url + path
      params = Internal.query(query)
      url += "?#{URI.encode_www_form(params)}" unless params.empty?
      headers = headers.merge('Accept' => 'application/json')
      unless body.nil?
        raw = JSON.generate(body)
        headers['Content-Type'] = 'application/json'
      end
      raw = UploadBody.new(raw) if raw && !raw.is_a?(UploadBody)
      if raw&.size
        headers['Content-Length'] = raw.size.to_s
      elsif raw
        headers['Transfer-Encoding'] = 'chunked'
      end
      headers['Idempotency-Key'] = request_options[:idempotency_key] || SecureRandom.uuid if idempotent || request_options[:idempotency_key]
      limit = request_options.fetch(:max_response_bytes, @max_response_bytes)
      deadline = request_options.fetch(:upload_timeout, @upload_timeout) if upload
      execute(method, url, headers, raw, request_options, deadline: deadline) { |response| parse(method, response, limit) }
    end

    # Sends a CDN request, retrying like an API read, and returns the last response rather than
    # raising an error status. With a block, yields the streaming {Response} and returns the block's
    # value; otherwise returns the response with its body read.
    def cdn(method, url, headers, request_options, &block)
      limit = request_options.fetch(:max_response_bytes, nil)
      execute(method, url, headers, nil, request_options, allow_http_errors: true) do |response|
        next response.tap { response.body(limit: limit) } unless block

        streaming = Response.new(status: response.status, headers: response.headers) do |&sink|
          response.each_chunk do |chunk|
            sink.call(chunk)
          rescue StandardError => e
            raise CallerError, e
          end
        end
        begin
          block.call(streaming)
        rescue CallerError
          raise
        rescue StandardError => e
          raise CallerError, e
        end
      end
    end

    # Resolves lens definitions, sending only definitions this client has not saved before, at most
    # ServerClient::ENSURE_LENSES_MAX_PER_REQUEST per request, in order. Calls are serialized, so concurrent calls
    # for the same definitions send them once.
    def ensure_lenses(lenses, request_options)
      if !lenses.is_a?(Array) || lenses.empty? || lenses.any? { |lens| !lens.is_a?(Hash) || lens['identifier'].to_s.empty? }
        raise Internal.invalid('At least one lens with an identifier is required')
      end

      @lens_lock.synchronize do
        keys = lenses.map { |lens| lens_key(lens) }
        missing = keys.zip(lenses).to_h.reject { |key, _| @lenses.key?(key) }
        missing.each_slice(ServerClient::ENSURE_LENSES_MAX_PER_REQUEST) do |slice|
          chunk = slice.to_h
          returned = request('PUT', project('lenses'), body: { 'lenses' => chunk.values },
                                                       request_options: request_options)
          returned = returned['lenses'] if returned.is_a?(Hash)
          unless lenses_match?(returned, chunk.values)
            raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Unexpected lens response')
          end

          # A new version of a lens replaces the cached definition with the same identifier.
          chunk.keys.zip(returned).each do |key, lens|
            @lenses.delete_if { |_, saved| saved['identifier'] == lens['identifier'] }
            @lenses[key] = lens
          end
        end
        keys.map do |key|
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'CalmLens did not return a lens') unless @lenses.key?(key)

          JSON.parse(JSON.generate(@lenses[key]))
        end
      end
    end

    def headers_for(extra)
      extra.reject { |name, _| %w[x-api-key user-agent authorization].include?(name.downcase) }
           .merge('X-Api-Key' => @api_key, 'User-Agent' => USER_AGENT)
    end

    private

    # The fields that identify a lens definition, as canonical JSON: an unset description or
    # transforms list is the same definition as an explicit null.
    def lens_key(lens)
      fields = { 'identifier' => lens['identifier'], 'name' => lens['name'], 'description' => lens['description'],
                 'type' => lens['type'], 'transforms' => lens['transforms'] }
      %w[active version].each { |name| fields[name] = lens[name] if lens.key?(name) }
      JSON.generate(canonical(fields))
    end

    def canonical(value)
      case value
      when Hash then value.sort_by { |key, _| key.to_s }.to_h { |key, item| [key.to_s, canonical(item)] }
      when Array then value.map { |item| canonical(item) }
      else value
      end
    end

    # Whether the saved lenses line up, one for one and in order, with the definitions that were sent.
    def lenses_match?(returned, sent)
      returned.is_a?(Array) && returned.size == sent.size &&
        returned.zip(sent).all? { |saved, definition| saved.is_a?(Hash) && saved['identifier'] == definition['identifier'] }
    end

    # Sends a request, retrying transport failures, timeouts, 429, 502–504 and
    # `idempotency/request-in-progress` when it is safe to repeat: reads, and requests with an
    # `Idempotency-Key` whose body can be sent again. Redirects are never followed.
    def execute(method, url, headers, body, request_options, allow_http_errors: false, deadline: nil, &handler)
      retries = request_options.fetch(:max_retries, @max_retries)
      retryable = retries.positive? && (%w[GET HEAD].include?(method) || headers.key?('Idempotency-Key')) &&
                  (body.nil? || body.replayable?)
      request = Transport::Request.new(method: method, url: url, headers: headers_for(headers), body: body&.content,
                                       open_timeout: request_options.fetch(:open_timeout, @open_timeout),
                                       timeout: request_options.fetch(:timeout, @timeout))
      limit = request_options.fetch(:max_response_bytes, @max_response_bytes)
      attempt = 0
      loop do
        body&.rewind if attempt.positive?
        context = { again: retryable && attempt < retries, attempt: attempt, limit: limit, deadline: deadline,
                    allow_http_errors: allow_http_errors }
        outcome, value = send_attempt(request, context, &handler)
        if outcome == :error
          delay = http_delay(value.retry_after, attempt)
          raise value unless context[:again] && delay <= ServerClient::RETRY_AFTER_MAX && value.retryable?

          outcome = :retry
          value = delay
        end
        return value if outcome == :ok

        pause(value)
        attempt += 1
      end
    end

    # One attempt: `[:ok, result]`, `[:error, error]` for an error response, or `[:retry, seconds]`.
    # A response returned to the caller (or its streaming block) is never retried.
    def send_attempt(request, context, &handler)
      delivered = false
      within(context[:deadline]) do
        send_request(request) do |response|
          raise redirect_error(response) if redirect?(response)

          if context[:allow_http_errors] && !response.success?
            delay = http_delay(Error.parse_retry_after(response.headers['retry-after']), context[:attempt])
            retry_status = RETRYABLE_STATUSES.include?(response.status) && delay <= ServerClient::RETRY_AFTER_MAX
            next [:retry, delay] if context[:again] && retry_status
          end
          next [:error, http_error(response, context[:limit])] unless response.success? || context[:allow_http_errors]

          delivered = true
          [:ok, handler.call(response)]
        end
      end
    rescue Error => e
      raise unless context[:again] && !delivered && e.retryable?

      [:retry, backoff(context[:attempt])]
    end

    # Runs one attempt within an upload deadline, when there is one.
    def within(deadline, &)
      deadline ? ::Timeout.timeout(deadline, &) : yield
    rescue ::Timeout::Error => e
      raise TimeoutError.new(SdkErrorCodes::TIMEOUT, 'Request timed out'), cause: e
    end

    def send_request(request, &handler)
      yielded = false
      result = nil
      returned = @transport.call(request) do |response|
        yielded = true
        result = handler.call(response)
      end
      if yielded
        result
      else
        handler.call(returned.is_a?(Response) ? returned : adapt(returned))
      end
    rescue CallerError => e
      raise e.error
    rescue Error
      raise
    rescue ::Timeout::Error => e
      raise TimeoutError.new(SdkErrorCodes::TIMEOUT, 'Request timed out'), cause: e
    rescue *Transport::ERRORS => e
      raise ConnectionError.new(SdkErrorCodes::TRANSPORT_ERROR, "Request failed: #{e.message}"), cause: e
    rescue ArgumentError, URI::Error => e
      raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, e.message), cause: e
    end

    # Accepts any response object with a status (or code), headers and body.
    def adapt(value)
      raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'The transport returned no response') if value.nil?

      status = value.respond_to?(:status) ? value.status : value.code
      headers = value.respond_to?(:to_hash) ? value.to_hash : (value.respond_to?(:headers) && value.headers) || {}
      Response.new(status: status, headers: headers, body: value.body.to_s)
    end

    # A redirect the SDK must not follow: it would send the API key to another origin.
    def redirect?(response) = response.status.between?(300, 399) && response.headers.key?('location')

    def redirect_error(response)
      Error.build(SdkErrorCodes::HTTP_ERROR, "Unexpected redirect (HTTP #{response.status})", status: response.status,
                                                                                              headers: response.headers)
    end

    # Exponential backoff with jitter: half the delay is fixed, the other half random.
    def backoff(attempt)
      delay = [@retry_base_delay * (2**attempt), ServerClient::RETRY_MAX_DELAY].min
      ((delay / 2.0) + (rand * delay / 2.0)).round(3)
    end

    def http_delay(retry_after, attempt) = retry_after.nil? ? backoff(attempt) : retry_after

    def read(response, limit)
      declared = response.content_length
      raise too_large(response, limit) if declared && declared > limit

      response.body(limit: limit)
    rescue InvalidResponseError => e
      raise e unless e.code == SdkErrorCodes::RESPONSE_TOO_LARGE

      raise too_large(response, limit)
    end

    def too_large(response, limit)
      InvalidResponseError.new(SdkErrorCodes::RESPONSE_TOO_LARGE, "Response body exceeds #{limit} bytes",
                               status: response.status, headers: response.headers)
    end

    def parse(method, response, limit)
      text = read(response, limit).dup.force_encoding(Encoding::UTF_8)
      return nil if text.empty? && (response.status == 204 || method == 'DELETE')

      JSON.parse(text)
    rescue JSON::ParserError, EncodingError
      raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, "Invalid JSON response (HTTP #{response.status})",
                                     status: response.status, headers: response.headers)
    end

    # The error for a non-2xx response: the API's code and details, or `sdk/http-error`.
    def http_error(response, limit)
      text = read(response, limit).dup.force_encoding(Encoding::UTF_8)
      data = begin
        JSON.parse(text)
      rescue JSON::ParserError, EncodingError
        nil
      end
      unless data.is_a?(Hash) && data['code'].is_a?(String)
        return Error.build(SdkErrorCodes::HTTP_ERROR, "HTTP #{response.status}", status: response.status,
                                                                                 headers: response.headers)
      end

      # The X-Request-Id header, or the body's `requestId` when a proxy dropped the header.
      request_id = response.headers['x-request-id'] || (data['requestId'] if data['requestId'].is_a?(String))
      message = data['message'].is_a?(String) ? data['message'] : nil
      details = data['details'].is_a?(Hash) ? data['details'] : nil
      Error.build(data['code'], message, status: response.status, details: details, headers: response.headers,
                                         request_id: request_id)
    rescue InvalidResponseError => e
      e
    end
  end
  private_constant :Session
end
