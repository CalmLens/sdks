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

    # @return [Assets]
    attr_reader :assets
    # @return [Folders]
    attr_reader :folders
    # @return [Text]
    attr_reader :text
    # @return [UploadTokens]
    attr_reader :upload_tokens
    # @return [Events]
    attr_reader :events
    # @return [CDN]
    attr_reader :cdn

    # @param api_key [String] a project API key. Keep it on your server.
    # @param project_id [String]
    # @param base_url [String] the API base URL.
    # @param cdn_base_url [String] the CDN base URL.
    # @param timeout [Numeric] seconds allowed for each socket read or write, including waiting for a
    #   moderation decision. It is not a deadline for a whole transfer, so large uploads and downloads
    #   are not cut off. Override per call with `request_options: {timeout:}`.
    # @param open_timeout [Numeric] seconds allowed to open a connection.
    # @param max_retries [Integer] retries of requests that are safe to repeat: GET/HEAD, and uploads,
    #   which carry an `Idempotency-Key`. Connection failures, timeouts, 429, 502, 503, 504 and
    #   `idempotency/request-in-progress` are retried with jittered exponential backoff, honouring
    #   `Retry-After`. Other writes are never retried. 0 disables retries.
    # @param retry_base_delay [Numeric] seconds before the first retry when the API gives no
    #   `Retry-After`; later retries wait up to twice as long each time, at most 8 seconds.
    # @param transport [#call, nil] a custom {Transport}; defaults to {Transport::NetHTTP}.
    # @raise [ConfigurationError] `sdk/invalid-config` for a missing or malformed setting.
    def initialize(api_key:, project_id:, base_url: DEFAULT_BASE_URL, cdn_base_url: DEFAULT_CDN_BASE_URL,
                   timeout: 120, open_timeout: 10, max_retries: 2, retry_base_delay: 0.5, transport: nil)
      check_config(api_key, project_id, timeout, open_timeout, max_retries, retry_base_delay, transport)
      @project_id = project_id
      @base_url = ServerClient.check_url(base_url, 'base_url')
      @cdn_base_url = ServerClient.check_url(cdn_base_url, 'cdn_base_url')
      @session = Session.new(api_key: api_key, project_id: project_id, base_url: @base_url,
                             cdn_base_url: @cdn_base_url, timeout: timeout, open_timeout: open_timeout,
                             max_retries: max_retries, retry_base_delay: retry_base_delay,
                             transport: transport || Transport::NetHTTP.new)
      @assets = Assets.new(@session)
      @folders = Folders.new(@session)
      @text = Text.new(@session, @assets)
      @upload_tokens = UploadTokens.new(@session, api_key)
      @events = Events.new(@session)
      @cdn = CDN.new(@session)
      @lenses = Lenses.new(@session)
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

    # Creates or updates named lenses (saved transform pipelines) and returns them. Definitions
    # this client already saved are not sent again. Supplying the same definition and version is
    # idempotent; changing a lens needs a higher `version`. More than 100 new definitions are sent in
    # consecutive requests, in order.
    # @option options [Array<Hash>] :lenses `[{identifier:, name:, type:, version:, transforms:, ...}]`
    # @return [Array<Hash>] the saved lenses, in the given order.
    def ensure_lenses(options) = @lenses.ensure_lenses(options)

    # Creates or updates one lens. Takes one lens definition; see {#ensure_lenses}.
    # @return [Hash] the saved lens
    def ensure_lens(options) = @lenses.ensure_lens(options)

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
