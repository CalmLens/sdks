# frozen_string_literal: true

require 'json'
require 'uri'

module CalmLens
  # Option conversion, identifier encoding and argument checks shared by the resources.
  # @api private
  module Internal
    # Per-call settings accepted under the `request_options:` option of any method.
    REQUEST_OPTIONS = %i[idempotency_key timeout open_timeout max_retries].freeze
    IDEMPOTENCY_KEY = /\A[\x21-\x7e]{1,255}\z/
    HEADER_VALUE = /\A[^\r\n\0]*\z/

    module_function

    # @return [InvalidArgumentError]
    def invalid(message, code = SdkErrorCodes::INVALID_ARGUMENT)
      InvalidArgumentError.new(code, message)
    end

    # Converts one snake_case option name to the API's camelCase. camelCase names are unchanged.
    def camelize(key)
      key.to_s.gsub(/_+([a-z0-9])/i) { Regexp.last_match(1).upcase }
    end

    # Converts every Hash key to camelCase strings, except inside `metadata`, whose keys are yours.
    def normalize(value)
      case value
      when Hash
        value.to_h do |key, item|
          name = camelize(key)
          [name, name == 'metadata' ? item : normalize(item)]
        end
      when Array then value.map { |item| normalize(item) }
      else value
      end
    end

    # Splits a method's options into API options (camelCase strings) and per-call request options.
    # @return [Array(Hash, Hash)]
    def options(value)
      value = {} if value.nil?
      raise invalid("Options must be a Hash, got #{value.class}") unless value.is_a?(Hash)

      request = value.find { |key, _| %w[request_options requestOptions].include?(key.to_s) }&.last || {}
      raise invalid('request_options must be a Hash') unless request.is_a?(Hash)

      request = request.to_h { |key, item| [key.to_s.gsub(/([a-z])([A-Z])/, '\1_\2').downcase.to_sym, item] }
      unknown = request.keys - REQUEST_OPTIONS
      raise invalid("Unknown request option: #{unknown.join(', ')}") unless unknown.empty?

      check_request_options(request)
      api = value.reject { |key, _| %w[request_options requestOptions].include?(key.to_s) }
      [normalize(api), request]
    end

    def check_request_options(request)
      key = request[:idempotency_key]
      if !key.nil? && !(key.is_a?(String) && key.match?(IDEMPOTENCY_KEY))
        raise invalid('idempotency_key must be 1 to 255 printable ASCII characters')
      end

      %i[timeout open_timeout].each do |name|
        next if request[name].nil? || positive?(request[name])

        raise invalid("#{name} must be a positive number of seconds")
      end
      retries = request[:max_retries]
      raise invalid('max_retries must be a non-negative Integer') unless retries.nil? || (retries.is_a?(Integer) && retries >= 0)
    end

    def positive?(value)
      value.is_a?(Numeric) && value.real? && value.to_f.finite? && value.positive?
    end

    # Fetches a required option.
    def required(options, key, code = SdkErrorCodes::INVALID_ARGUMENT)
      raise invalid("#{key} is required", code) unless options.key?(key)

      options[key]
    end

    # Encodes an identifier as one path segment. "." and ".." are rejected because URL resolution
    # treats them as relative segments, which would reach another route.
    def segment(value)
      text = value.to_s
      raise invalid('Identifier is required') if text.empty?
      raise invalid('Identifier cannot be "." or ".."') if %w[. ..].include?(text)

      URI.encode_www_form_component(text).gsub('+', '%20')
    end

    # Splits an absolute URL into its parsed origin and its raw request target. Only the origin is
    # parsed, so the request target is sent exactly as the SDK built it.
    # @return [Array(URI::Generic, String)]
    def split_url(url)
      match = %r{\A([A-Za-z][A-Za-z0-9+.-]*://[^/?#]*)([^#]*)}.match(url.to_s)
      raise URI::InvalidURIError, "Invalid URL: #{url}" unless match && match[2].match?(/\A[!-~]*\z/)

      target = match[2]
      target = "/#{target}" unless target.start_with?('/')
      [URI(match[1]), target]
    end

    # Checks caller-supplied HTTP headers: names and values must be strings without line breaks.
    def headers(value)
      raise invalid('headers must be a Hash') unless value.is_a?(Hash)

      value.to_h do |name, item|
        name = name.to_s
        unless name.match?(/\A[!#$%&'*+\-.^_`|~0-9A-Za-z]+\z/) && item.is_a?(String) && item.match?(HEADER_VALUE)
          raise invalid("Invalid header #{name.inspect}: names are tokens and values are single-line strings")
        end

        [name, item]
      end
    end

    # Encodes query values the way the API's parser expects: strings as-is, everything else as
    # JSON, and ordering as `ordering[i][field]` pairs.
    def query(params)
      encoded = {}
      params.each do |key, value|
        next if value.nil?

        if key == 'ids' && value.is_a?(Array)
          value.each_with_index { |item, index| encoded["ids[#{index}]"] = item.to_s }
        elsif key == 'ordering' && value.is_a?(Array)
          value.each_with_index do |order, index|
            raise invalid('Each ordering entry must be a Hash') unless order.is_a?(Hash)

            order.each { |name, item| encoded["ordering[#{index}][#{name}]"] = item.to_s }
          end
        else
          encoded[key] = value.is_a?(String) ? value : JSON.generate(value)
        end
      end
      encoded
    end
  end
  private_constant :Internal
end
