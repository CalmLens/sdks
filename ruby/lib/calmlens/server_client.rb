# frozen_string_literal: true

require 'uri'

module CalmLens
  # The CalmLens API client. Create one per process (or per project) and reuse it: it keeps
  # keep-alive connections, is safe to share between threads, and reconnects after `fork`.
  #
  # @example
  #   client = CalmLens::ServerClient.new(api_key: ENV.fetch('CALMLENS_API_KEY'),
  #                                 project_id: ENV.fetch('CALMLENS_PROJECT_ID'))
  #   asset = client.text.classify(text: 'Hello world')
  #   client.close
  class ServerClient
    DEFAULT_BASE_URL = 'https://api.calmlens.com/v1'
    DEFAULT_CDN_BASE_URL = 'https://cdn.calmlens.com/v1'
    # Seconds allowed for each socket read or write.
    DEFAULT_TIMEOUT = 120
    DEFAULT_OPEN_TIMEOUT = 10
    DEFAULT_MAX_RETRIES = 2
    # Seconds before the first retry; later retries wait twice as long each time, up to `max_retry_delay`.
    DEFAULT_RETRY_BASE_DELAY = 0.5
    DEFAULT_MAX_RETRY_DELAY = 8
    # A `Retry-After` longer than this many seconds is returned to the caller instead of waited out.
    RETRY_AFTER_MAX = 60
    # The largest response body read, in bytes (32 MiB).
    DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
    # Content larger than this many bytes is uploaded in parts of this size (8 MiB).
    DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024
    # The smallest and largest `part_size_bytes`: every part but the last is at least 5 MiB.
    MIN_PART_SIZE_BYTES = 5 * 1024 * 1024
    MAX_PART_SIZE_BYTES = 64 * 1024 * 1024
    # The most lens definitions {#ensure_lenses} sends in one request.
    ENSURE_LENSES_MAX_PER_REQUEST = 100

    # @return [Assets]
    attr_reader :assets
    # @return [Folders]
    attr_reader :folders
    # @return [HashLists]
    attr_reader :hash_lists
    # @return [Policies]
    attr_reader :policies
    # @return [Text]
    attr_reader :text
    # @return [UploadTokens]
    attr_reader :upload_tokens
    # @return [Events]
    attr_reader :events
    # @return [CDN]
    attr_reader :cdn
    # @return [Lenses]
    attr_reader :lenses
    # @return [UploadPresets]
    attr_reader :upload_presets
    # @return [ProjectSettings]
    attr_reader :project_settings
    # @return [MetadataFields]
    attr_reader :metadata_fields

    # @param api_key [String] a project API key, `CALMLENS_API_KEY` by default. Keep it on your server.
    # @param project_id [String] `CALMLENS_PROJECT_ID` by default.
    # @param base_url [String] the API base URL, `CALMLENS_BASE_URL` when set.
    # @param cdn_base_url [String] the CDN base URL.
    # @param timeout [Numeric] seconds allowed for each socket read or write, including waiting for a
    #   moderation decision. It is not a deadline for a whole transfer, so large uploads and downloads
    #   are not cut off. Override per call with `request_options: {timeout:}`.
    # @param open_timeout [Numeric] seconds allowed to open a connection.
    # @param upload_timeout [Numeric, nil] seconds allowed for each attempt of a binary upload (file
    #   content or a multipart part) as a whole. Uploads have no such deadline unless you set one; text
    #   content follows `timeout` like other requests.
    # @param max_response_bytes [Integer] the largest response body read; a larger one fails with
    #   `sdk/response-too-large`, before it is read when its `Content-Length` says so.
    # @param max_retries [Integer] retries of requests that are safe to repeat: GET/HEAD, and uploads,
    #   which carry an `Idempotency-Key`. Connection failures, timeouts, 429, 500, 502, 503, 504 and
    #   `idempotency/request-in-progress` are retried with jittered exponential backoff, honouring
    #   `Retry-After`. Other writes are never retried. 0 disables retries.
    # @param retry_base_delay [Numeric] seconds before the first retry when the API gives no
    #   `Retry-After`; later retries wait up to twice as long each time, at most `max_retry_delay`.
    # @param max_retry_delay [Numeric] the longest wait between retries, in seconds, when the API gives
    #   no `Retry-After`; 8 by default.
    # @param part_size_bytes [Integer] content larger than this many bytes whose size the client knows
    #   and can read again (a binary String, base64, or a File, StringIO or other seekable IO) is
    #   uploaded in parts of this size: each part is retried on its own, and calling again with the
    #   same `idempotency_key` resumes an interrupted upload. From 5 MiB to 64 MiB; default 8 MiB.
    # @param transport [#call, nil] a custom {Transport}; defaults to {Transport::NetHTTP}.
    # @param app_info [Hash, nil] `{name:, version:, url:}` of your integration, added to the
    #   `User-Agent` as `name/version (url)`; `version` and `url` are optional.
    # @param logger [Logger, nil] logs each request attempt: its operation, method, path, status,
    #   attempt, duration and request ID, never the API key, bodies, upload tokens or CDN URLs. With
    #   `CALMLENS_LOG` set and no logger, logs to standard error.
    # @param log_level [String, nil] `info` (each attempt's outcome) or `debug` (also each attempt as
    #   it starts); `CALMLENS_LOG` by default, else `info` when a logger is given.
    # @param on_request [#call, nil] called after each attempt with
    #   `{operation:, method:, path:, attempt:, delay:, status:, request_id:, error_code:, duration:}`:
    #   `operation` is the method, such as `assets.retrieve` (nil for {#request}), `delay` the wait
    #   before the next attempt (nil when there is none), `error_code` the attempt's error, `duration`
    #   its seconds, and `path` nil for a CDN URL, which may be signed. Use it for metrics or tracing.
    # @raise [ConfigurationError] `sdk/invalid-config` for a missing or malformed setting.
    def initialize(api_key: ENV.fetch('CALMLENS_API_KEY', nil), project_id: ENV.fetch('CALMLENS_PROJECT_ID', nil),
                   base_url: ENV.fetch('CALMLENS_BASE_URL', DEFAULT_BASE_URL), cdn_base_url: DEFAULT_CDN_BASE_URL,
                   timeout: DEFAULT_TIMEOUT, open_timeout: DEFAULT_OPEN_TIMEOUT, upload_timeout: nil,
                   max_retries: DEFAULT_MAX_RETRIES, retry_base_delay: DEFAULT_RETRY_BASE_DELAY,
                   max_retry_delay: DEFAULT_MAX_RETRY_DELAY, max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
                   part_size_bytes: DEFAULT_PART_SIZE_BYTES, transport: nil, app_info: nil, logger: nil, log_level: nil,
                   on_request: nil)
      check_config(api_key, project_id, timeout, open_timeout, max_retries, retry_base_delay, transport)
      observability = ServerClient.observability(logger, log_level, on_request)
      unless max_retry_delay.is_a?(Numeric) && max_retry_delay.real? && max_retry_delay.to_f.finite? && max_retry_delay >= 0
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'max_retry_delay must be a non-negative number')
      end

      check_limits(upload_timeout, max_response_bytes, part_size_bytes)
      @project_id = project_id
      @base_url = ServerClient.check_url(base_url, 'base_url')
      @cdn_base_url = ServerClient.check_url(cdn_base_url, 'cdn_base_url')
      @session = Session.new(api_key: api_key, project_id: project_id, base_url: @base_url,
                             cdn_base_url: @cdn_base_url, timeout: timeout, open_timeout: open_timeout,
                             max_retries: max_retries, retry_base_delay: retry_base_delay, max_retry_delay: max_retry_delay,
                             max_response_bytes: max_response_bytes, upload_timeout: upload_timeout,
                             part_size_bytes: part_size_bytes, transport: transport || Transport::NetHTTP.new,
                             user_agent: ServerClient.user_agent(app_info), **observability)
      @assets = Assets.new(@session)
      @folders = Folders.new(@session)
      @hash_lists = HashLists.new(@session)
      @policies = Policies.new(@session)
      @text = Text.new(@session, @assets)
      @upload_tokens = UploadTokens.new(@session, api_key)
      @events = Events.new(@session)
      @cdn = CDN.new(@session)
      @lenses = Lenses.new(@session)
      @upload_presets = UploadPresets.new(@session)
      @project_settings = ProjectSettings.new(@session)
      @metadata_fields = MetadataFields.new(@session)
    end

    # @return [String]
    attr_reader :project_id
    # @return [String] the API base URL, without a trailing slash.
    attr_reader :base_url
    # @return [String] the CDN base URL, without a trailing slash.
    attr_reader :cdn_base_url

    # Never shows the API key, including in resource objects that reference the client.
    def inspect = "#<#{self.class.name} project_id=#{@project_id.inspect} base_url=#{@base_url.inspect} api_key=[REDACTED]>"

    def pretty_print(printer) = printer.text(inspect)

    # Closes pooled connections. Requests made afterwards fail with `sdk/transport-error`.
    # @return [void]
    def close
      @session.close
      nil
    end

    # Creates named lenses (saved transforms), or changes them to these definitions, and returns
    # them. Definitions this client already saved are not sent again, and sending the same
    # definition again returns the lens unchanged. More than 100 new definitions are sent in
    # consecutive requests, in order. {#lenses} manages lenses one by one.
    # @option options [Array<Hash>] :lenses `[{identifier:, name:, type:, transform:, ...}]`, each served unless `active: false`
    # @return [Array<Lens>] the saved lenses, in the given order.
    def ensure_lenses(**) = @lenses.__send__(:ensure_lenses, **)

    # Creates or updates one lens. Takes one lens definition as keywords; see {#ensure_lenses}.
    # @return [Lens] the saved lens
    def ensure_lens(**) = @lenses.__send__(:ensure_lens, **)

    # Sends a request to any API path with the client's authentication, retries and error mapping,
    # for endpoints this release has no method for. Reads are retried; writes only with
    # `request_options: {idempotency_key:}`.
    # @param method [String] `GET`, `POST`, `PUT`, `PATCH` or `DELETE`
    # @param path [String] beneath the base URL, such as `/projects/prj_1/assets`
    # @param query [Hash] query parameters
    # @param body [Hash, nil] a JSON body
    # @param headers [Hash{String => String}] extra headers; the API key and user agent are the client's
    # @return [Model, Object, nil] a {Model} for a JSON object (with `last_response`), else the parsed JSON
    def request(method, path, query: {}, body: nil, headers: {}, request_options: {})
      verb = method.to_s.upcase
      raise Internal.invalid('method must be GET, POST, PUT, PATCH or DELETE') unless %w[GET POST PUT PATCH DELETE].include?(verb)
      raise Internal.invalid('path must start with / and stay on the API') unless path.is_a?(String) && path.match?(%r{\A/(?!/)})
      raise Internal.invalid('query must be a Hash') unless query.is_a?(Hash)

      _, options = Internal.options({ request_options: request_options })
      outer = Thread.current[:calmlens_operation]
      # A raw request has no operation name.
      Thread.current[:calmlens_operation] = nil
      json = @session.request(verb, path, query: query.transform_keys(&:to_s), body: body && Internal.normalize(body),
                                          headers: Internal.headers(headers), request_options: options)
      json.is_a?(Hash) ? Model.new(json, last_response: @session.last_response) : json
    ensure
      Thread.current[:calmlens_operation] = outer
    end

    # The `User-Agent`, with your integration's name, version and URL.
    # @api private
    def self.user_agent(app_info)
      return Session::USER_AGENT if app_info.nil?

      info = app_info.to_h.transform_keys(&:to_sym)
      name, version, url = info.values_at(:name, :version, :url)
      unless name.is_a?(String) && name.match?(%r{\A[^\s/()]+\z}) && [version, url].all? do |part|
        part.nil? || (part.is_a?(String) && part.match?(Internal::HEADER_VALUE))
      end
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'app_info needs a name without spaces, and String version and url')
      end

      "#{Session::USER_AGENT} #{[name, version].compact.join('/')}#{" (#{url})" if url}"
    end

    # Writes log lines to standard error when `CALMLENS_LOG` is set without a logger; any Ruby
    # `Logger` works in its place.
    # @api private
    class StderrLogger
      def info(&) = warn(yield)
      def debug(&) = warn(yield)
    end

    # The logger, level and hook the session reports attempts to.
    # @api private
    def self.observability(logger, log_level, on_request)
      level = (log_level || ENV.fetch('CALMLENS_LOG', nil))&.to_s&.downcase
      raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'log_level must be info or debug') unless [nil, 'info',
                                                                                                             'debug'].include?(level)
      unless on_request.nil? || on_request.respond_to?(:call)
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG,
                                     'on_request must respond to call')
      end

      logger ||= StderrLogger.new if level
      { logger: logger, log_level: level || (logger && 'info'), on_request: on_request }
    end

    # @api private
    def self.check_url(value, name)
      uri = URI.parse(value.to_s)
      unless %w[http https].include?(uri.scheme) && uri.host && !uri.host.empty? && uri.userinfo.nil? &&
             uri.query.nil? && uri.fragment.nil?
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG,
                                     "#{name} must be an http(s) URL without credentials, query or fragment")
      end

      value.to_s.sub(%r{/+\z}, '')
    rescue URI::Error
      raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, "#{name} is not a valid URL")
    end

    private

    def check_limits(upload_timeout, max_response_bytes, part_size_bytes)
      unless upload_timeout.nil? || Internal.positive?(upload_timeout)
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'upload_timeout must be nil or a positive number of seconds')
      end
      unless part_size_bytes.is_a?(Integer) && part_size_bytes.between?(MIN_PART_SIZE_BYTES, MAX_PART_SIZE_BYTES)
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG,
                                     "part_size_bytes must be an Integer from #{MIN_PART_SIZE_BYTES} (5 MiB) to " \
                                     "#{MAX_PART_SIZE_BYTES} (64 MiB)")
      end
      return if max_response_bytes.is_a?(Integer) && max_response_bytes.positive?

      raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'max_response_bytes must be a positive Integer')
    end

    def check_config(api_key, project_id, timeout, open_timeout, max_retries, retry_base_delay, transport)
      unless api_key.is_a?(String) && !api_key.empty? && api_key.match?(/\A[\x21-\x7e]+\z/)
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'api_key must be a non-empty printable ASCII String')
      end
      unless project_id.is_a?(String) && !project_id.empty? && !%w[. ..].include?(project_id)
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'project_id is required')
      end
      unless Internal.positive?(timeout) && Internal.positive?(open_timeout)
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'timeout and open_timeout must be positive numbers of seconds')
      end
      unless max_retries.is_a?(Integer) && max_retries >= 0
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'max_retries must be a non-negative Integer')
      end
      unless retry_base_delay.is_a?(Numeric) && retry_base_delay.real? && retry_base_delay.to_f.finite? && retry_base_delay >= 0
        raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'retry_base_delay must be a non-negative number')
      end
      return if transport.nil? || transport.respond_to?(:call)

      raise ConfigurationError.new(SdkErrorCodes::INVALID_CONFIG, 'transport must respond to call')
    end
  end
end
