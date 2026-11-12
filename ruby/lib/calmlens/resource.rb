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
      'cdn.getAssetUrl' => %w[assetId externalId lens projectId resource transform viewerClaims].freeze,
      'cdn.serve' => %w[assetId externalId init lens projectId resource transform viewerClaims].freeze,
      'uploadTokens.sign' => %w[expiresIn externalId uploadPresetId].freeze
    }.freeze
    private_constant :LOCAL_OPTION_KEYS

    # Runs a public method: splits options, and raises every argument problem as {InvalidArgumentError}.
    # `method` names the public method: an option it doesn't take, such as a misspelt one, raises
    # `sdk/invalid-argument` instead of being silently dropped.
    # An option given as nil is left out, as if omitted, unless the API takes null for it
    # (Internal::NULLABLE_OPTION_KEYS), such as `description: nil` to clear a description;
    # `keep_nil: true` sends every option as given, as for a lens definition. `prefix` names the
    # operation's resource, the resource's own unless the method belongs to the client itself.
    def call(options, method, keep_nil: false, prefix: self.class::OPERATIONS)
      operation = [prefix, Internal.camelize(method)].compact.join('.')
      check_option_keys(options, operation)
      api, request = Internal.options(options)
      nullable = Internal::NULLABLE_OPTION_KEYS.fetch(operation, [])
      api = api.reject { |key, value| value.nil? && !nullable.include?(key) } unless keep_nil
      outer = Thread.current[:calmlens_operation]
      Thread.current[:calmlens_operation] ||= operation
      begin
        yield api, request
      ensure
        Thread.current[:calmlens_operation] = outer
      end
    rescue Error
      raise
    rescue KeyError, TypeError, ArgumentError, JSON::GeneratorError, EncodingError, URI::Error, FloatDomainError => e
      raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, e.message), cause: e
    end

    # Options are the snake_case keywords a method declares, plus `request_options:`. Ruby passes
    # them as Symbols; camelCase or String names are refused like misspelt ones.
    def check_option_keys(options, operation)
      return unless options.is_a?(Hash)

      allowed = LOCAL_OPTION_KEYS.fetch(operation) { Internal::OPTION_KEYS.fetch(operation) }
      unknown = options.keys.reject do |key|
        key == :request_options || (key.is_a?(Symbol) && Internal.snake(key) == key.to_s && allowed.include?(Internal.camelize(key)))
      end
      return if unknown.empty?

      raise Internal.invalid("Unknown option#{'s' if unknown.size > 1} for #{operation}: #{unknown.map(&:inspect).join(', ')}")
    end

    # A method's options with the IDs it takes as arguments, such as `asset_id`.
    def with_ids(options, **ids)
      given = ids.keys & options.keys
      raise Internal.invalid("Pass #{given.join(', ')} as an argument, not an option") unless given.empty?

      options.merge(ids)
    end

    def request(...) = @session.request(...)
    def project(path) = @session.project(path)

    def without(options, *keys) = options.except(*keys)

    # The `klass` model of a response, with the response as its `last_response`.
    def build(klass, json, **) = klass.new(json, last_response: @session.last_response, **)

    # A list's response as a `klass` page, which fetches the page after a cursor with `options`
    # through `list`.
    def page(klass, response, options, &list)
      unless response.is_a?(Hash) && response['items'].is_a?(Array)
        raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, "Invalid #{klass} response")
      end

      build(klass, response, fetch: ->(cursor) { list.call(options.merge(cursor: cursor)) }, cursor: options[:cursor])
    end
  end
end
