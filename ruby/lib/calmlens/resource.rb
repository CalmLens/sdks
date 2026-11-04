# frozen_string_literal: true

require 'json'
require 'uri'

module CalmLens
  # Shared behaviour of the client's resource objects.
  class Resource
    # @api private
    def initialize(session)
      @session = session
    end

    def inspect = "#<#{self.class.name} project_id=#{@session.project_id.inspect}>"

    private

    # The option keys of methods that send no request of their own, or take options of their own
    # beside a request's; Internal::OPTION_KEYS, generated from the API, has the rest.
    LOCAL_OPTION_KEYS = {
      'assets.waitForDecision' => %w[assetId timeout].freeze,
      'cdn.getAssetUrl' => %w[assetIdentifier lens resource transform viewerClaims].freeze,
      'cdn.serve' => %w[assetIdentifier init lens resource transform viewerClaims].freeze,
      'uploadTokens.sign' => %w[expiresInSeconds externalId uploadPresetId].freeze
    }.freeze
    private_constant :LOCAL_OPTION_KEYS

    # Runs a public method: splits options, and raises every argument problem as {InvalidArgumentError}.
    # `method` names the public method: an option it doesn't take, such as a misspelt one, raises
    # `sdk/invalid-argument` instead of being silently dropped.
    # An option given as nil is left out, as if omitted, unless the API takes null for it
    # (Internal::NULLABLE_OPTION_KEYS), such as `description: nil` to clear a description;
    # `keep_nil: true` sends every option as given, as for a lens definition.
    def call(options, method, keep_nil: false)
      operation = [self.class::OPERATIONS, Internal.camelize(method)].compact.join('.')
      check_option_keys(options, operation)
      api, request = Internal.options(options)
      nullable = Internal::NULLABLE_OPTION_KEYS.fetch(operation, [])
      api = api.reject { |key, value| value.nil? && !nullable.include?(key) } unless keep_nil
      yield api, request
    rescue Error
      raise
    rescue KeyError, TypeError, ArgumentError, JSON::GeneratorError, EncodingError, URI::Error, FloatDomainError => e
      raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, e.message), cause: e
    end

    def check_option_keys(options, operation)
      return unless options.is_a?(Hash)

      allowed = LOCAL_OPTION_KEYS.fetch(operation) { Internal::OPTION_KEYS.fetch(operation) }
      unknown = options.keys.reject do |key|
        %w[request_options requestOptions].include?(key.to_s) || allowed.include?(Internal.camelize(key))
      end
      return if unknown.empty?

      raise Internal.invalid("Unknown option#{'s' if unknown.size > 1} for #{operation}: #{unknown.join(', ')}")
    end

    def request(...) = @session.request(...)
    def project(path) = @session.project(path)

    def without(options, *keys) = options.except(*keys)

    # Fetches cursor pages lazily, from `start`, until a page has no next cursor, says there is no
    # more or is empty. A page with more to follow that hands back a cursor this iteration already
    # sent raises `sdk/invalid-response` rather than repeating pages forever.
    def pages(start, &fetch)
      Enumerator.new do |out|
        cursor = start
        sent = []
        loop do
          page = fetch.call(cursor)
          items = page.is_a?(Hash) ? page['items'] : nil
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Page has no items') unless items.is_a?(Array)

          following = page['nextCursor']
          more = following.is_a?(String) && !following.empty? && page['hasMore'] == true && !items.empty?
          new_cursor!(sent, following) if more
          out << page
          break unless more

          cursor = following
        end
      end
    end

    # Records a cursor an iteration sends, raising `sdk/invalid-response` (with `details['cursor']`)
    # when a page with more to follow hands back one it already sent, which would repeat pages forever.
    def new_cursor!(sent, cursor)
      if sent.include?(cursor)
        raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE,
                                       'The API returned a cursor it had already returned, with more pages to follow',
                                       details: { 'cursor' => cursor })
      end

      sent << cursor
    end
  end
end
