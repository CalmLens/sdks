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
    MAX_JSON_BYTES = 32 * 1024 * 1024
    MAX_ERROR_BYTES = 1024 * 1024
    MAX_RETRY_DELAY = 60
    MAX_BACKOFF = 8
    ENSURE_LENSES_MAX_PER_REQUEST = 100
    USER_AGENT = "calmlens-ruby/#{VERSION} (ruby #{RUBY_VERSION})".freeze

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

    def initialize(api_key:, project_id:, base_url:, cdn_base_url:, timeout:, open_timeout:, max_retries:,
                   retry_base_delay:, transport:)
      @api_key = api_key
      @project_id = project_id
      @base_url = base_url
      @cdn_base_url = cdn_base_url
      @timeout = timeout
      @open_timeout = open_timeout
      @max_retries = max_retries
      @retry_base_delay = retry_base_delay
      @transport = transport
      @lenses = {}
      @lens_lock = Mutex.new
    end

    def inspect = "#<#{self.class.name} project_id=#{@project_id.inspect} api_key=[REDACTED]>"

    # Seconds on a monotonic clock, for decision deadlines. {MockServerClient} replaces it.
    def monotonic = @monotonic ? @monotonic.call : Process.clock_gettime(Process::CLOCK_MONOTONIC)

    # Waits between decision checks. {MockServerClient} replaces it.
    def pause(seconds) = @pause ? @pause.call(seconds) : sleep(seconds)

    # Replaces the clock and wait used for decision checks, so a mock's waits take no real time.
    def use_clock(monotonic:, pause:)
      @monotonic = monotonic
      @pause = pause
    end

    def close
      @transport.close if @transport.respond_to?(:close)
    end

    def project(path) = "/projects/#{Internal.segment(@project_id)}/#{path}"

    # Sends an API request and returns the parsed JSON body.
    #
    # @param idempotent [Boolean] send an `Idempotency-Key` (generated unless the caller gave one),
    #   reused across retries so the API runs the request at most once.
    def request(method, path, request_options:, query: {}, body: nil, raw: nil, headers: {}, idempotent: false)
      url = @base_url + path
      params = Internal.query(query)
      url += "?#{URI.encode_www_form(params)}" unless params.empty?
      headers = headers.merge('Accept' => 'application/json')
      unless body.nil?
        raw = JSON.generate(body)
        headers['Content-Type'] = 'application/json'
      end
      if raw.is_a?(UploadBody)
        headers['Content-Length'] = raw.size.to_s
      elsif raw
        raw = UploadBody.new(raw)
      end
      headers['Idempotency-Key'] = request_options[:idempotency_key] || SecureRandom.uuid if idempotent || request_options[:idempotency_key]
      execute(method, url, headers, raw, request_options) { |response| parse(response) }
    end

    # Sends a CDN request. With a block, yields the streaming {Response} and returns the block's
    # value; otherwise returns the response with its body read.
    def cdn(method, url, headers, request_options, &block)
      execute(method, url, headers, nil, request_options, stream: !block.nil?) do |response|
        next response.tap(&:body) unless block

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
    # ENSURE_LENSES_MAX_PER_REQUEST per request, in order.
    def ensure_lenses(lenses, request_options)
      if !lenses.is_a?(Array) || lenses.empty? || lenses.any? { |lens| !lens.is_a?(Hash) || lens['identifier'].to_s.empty? }
        raise Internal.invalid('At least one lens with an identifier is required')
      end

      @lens_lock.synchronize do
        keys = lenses.map { |lens| JSON.generate(lens.sort.to_h) }
        missing = keys.zip(lenses).to_h.reject { |key, _| @lenses.key?(key) }
        resolved = @lenses.dup
        missing.each_slice(ENSURE_LENSES_MAX_PER_REQUEST) do |slice|
          chunk = slice.to_h
          returned = request('PUT', project('lenses'), body: { 'lenses' => chunk.values },
                                                       request_options: request_options)
          returned = returned['lenses'] if returned.is_a?(Hash)
          unless lenses_match?(returned, chunk.values)
            raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Unexpected lens response')
          end

          resolved.merge!(chunk.keys.zip(returned).to_h)
          # A new version of a lens replaces the cached definition with the same identifier.
          chunk.keys.zip(returned).each do |key, lens|
            @lenses.delete_if { |_, saved| saved['identifier'] == lens['identifier'] }
            @lenses[key] = lens
          end
        end
        JSON.parse(JSON.generate(keys.map { |key| resolved.fetch(key) }))
      end
    end

    # Whether the saved lenses line up, one for one and in order, with the definitions that were sent.
    def lenses_match?(returned, sent)
      returned.is_a?(Array) && returned.size == sent.size &&
        returned.zip(sent).all? { |saved, definition| saved.is_a?(Hash) && saved['identifier'] == definition['identifier'] }
    end

    def headers_for(extra)
      extra.reject { |name, _| %w[x-api-key user-agent].include?(name.downcase) }
           .merge('X-Api-Key' => @api_key, 'User-Agent' => USER_AGENT)
    end

    private

    def execute(method, url, headers, body, request_options, stream: false, &handler)
      retries = request_options.fetch(:max_retries, @max_retries)
      retry_allowed = %w[GET HEAD].include?(method) || headers.key?('Idempotency-Key')
      request = Transport::Request.new(method: method, url: url, headers: headers_for(headers), body: body&.content,
                                       open_timeout: request_options.fetch(:open_timeout, @open_timeout),
                                       timeout: request_options.fetch(:timeout, @timeout))
      attempt = 0
      begin
        body&.rewind if attempt.positive?
        delivered = false
        send_request(request) do |response|
          delivered = true if stream
          handler.call(response)
        end
      rescue Error => e
        raise unless retry_allowed && !delivered && attempt < retries && e.retryable? && (body.nil? || body.replayable?)

        delay = retry_delay(attempt, e.retry_after)
        raise if delay.nil?

        sleep(delay)
        attempt += 1
        retry
      end
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
      raise TimeoutError.new(SdkErrorCodes::TIMEOUT, e.message), cause: e
    rescue *Transport::ERRORS => e
      raise ConnectionError.new(SdkErrorCodes::TRANSPORT_ERROR, e.message), cause: e
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

    def retry_delay(attempt, retry_after)
      return (retry_after <= MAX_RETRY_DELAY ? retry_after : nil) if retry_after

      rand * [@retry_base_delay * (2**attempt), MAX_BACKOFF].min
    end

    def parse(response)
      text = response.body(limit: response.success? ? MAX_JSON_BYTES : MAX_ERROR_BYTES).dup.force_encoding(Encoding::UTF_8)
      begin
        data = text.empty? ? nil : JSON.parse(text)
      rescue JSON::ParserError
        raise invalid_body(response) if response.success?

        data = nil
      end
      return data if response.success?

      raise api_error(response, data)
    rescue InvalidResponseError
      raise if response.success?

      raise api_error(response, nil)
    end

    def invalid_body(response)
      InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, "Invalid JSON response (HTTP #{response.status})",
                               headers: response.headers)
    end

    def api_error(response, data)
      unless data.is_a?(Hash) && data['code'].is_a?(String)
        return Error.build(SdkErrorCodes::HTTP_ERROR, "HTTP #{response.status}", status: response.status,
                                                                                 headers: response.headers)
      end

      details = (data['details'].is_a?(Hash) ? data['details'] : {}).merge('network' => true)
      details['traceId'] = data['traceId'] if data.key?('traceId')
      Error.build(data['code'], data['message'].is_a?(String) ? data['message'] : nil,
                  status: response.status, details: details, headers: response.headers)
    end
  end
  private_constant :Session
end
