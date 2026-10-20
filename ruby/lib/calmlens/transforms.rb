# frozen_string_literal: true

module CalmLens
  # CDN transform selectors: selector Strings and structured steps serialized the way every SDK does.
  # @api private
  module Transforms
    module_function

    TYPE = /\A[A-Za-z0-9_]+\z/

    # Returns the selector the API and CDN accept for a transform: a selector String unchanged, or
    # structured steps (`{type:, options:}` or an Array of them) serialized by {serialize}.
    def selector(value)
      value.nil? || value.is_a?(String) ? value : serialize(value)
    end

    # Builds the CDN path of a transform. A selector String keeps its own separators and literal
    # `[`/`]`, which the CDN matches; serialized steps are already path-safe.
    def path(value)
      return serialize(value) unless value.is_a?(String)

      text = value.sub(%r{\A/+}, '')
      raise Internal.invalid('Transform cannot contain "..", "?" or "#"') if text.include?('..') || text.match?(/[?#]/)

      # Like JavaScript's encodeURI, except that brackets stay literal.
      text.b.gsub(%r{[^A-Za-z0-9\-_.!~*'();/:@&=+$,\[\]]}n) { |byte| format('%%%02X', byte.ord) }
    end

    # Serializes structured transforms as a CDN selector such as `imageTransform[format=png,width=1024]`.
    # Option keys are sorted so equal transforms share a URL; nested keys (`border[color]`) and values
    # are percent-encoded.
    def serialize(value)
      steps = value.is_a?(Array) ? value : [value]
      raise Internal.invalid('Transform needs at least one step') if steps.empty?

      steps.map do |step|
        raise Internal.invalid('Transform steps must be Hashes') unless step.is_a?(Hash)

        step = step.transform_keys(&:to_s)
        type = step['type']
        unless type.is_a?(String) && type.match?(TYPE)
          raise Internal.invalid('Transform type must contain only letters, digits and underscores')
        end

        options = step['options'] || {}
        raise Internal.invalid('Transform options must be a Hash') unless options.is_a?(Hash)

        pairs = []
        sorted_options(options).each { |key, item| append_pairs(pairs, key, item) }
        "#{type}[#{pairs.join(',')}]"
      end.join(',')
    end

    def sorted_options(options) = options.map { |key, item| [key.to_s, item] }.sort_by(&:first)

    def append_pairs(pairs, key, value)
      return if value.nil?
      return sorted_options(value).each { |child, item| append_pairs(pairs, "#{key}[#{child}]", item) } if value.is_a?(Hash)

      text = case value
             when String, true, false, Integer then value.to_s
             when Float
               raise Internal.invalid("Transform option \"#{key}\" must be a finite number") unless value.finite?

               js_number(value)
             else raise Internal.invalid("Transform option \"#{key}\" must be a String, number, boolean or Hash")
             end
      pairs << "#{component(key)}=#{component(text)}"
    end

    # Percent-encodes everything except RFC 3986 unreserved characters.
    def component(text)
      text.encode(Encoding::UTF_8).b.gsub(/[^A-Za-z0-9\-._~]/n) { |byte| format('%%%02X', byte.ord) }
    end

    # Formats a Float the way JavaScript's String(number) does, so every SDK builds the same URL.
    def js_number(value)
      return '0' if value.zero?

      mantissa, exponent = value.abs.to_s.split('e')
      whole, fraction = mantissa.split('.')
      digits = "#{whole}#{fraction}"
      point = whole.length + exponent.to_i
      stripped = digits.sub(/\A0+/, '')
      point -= digits.length - stripped.length
      digits = stripped.sub(/0+\z/, '')
      sign = value.negative? ? '-' : ''
      "#{sign}#{js_digits(digits, point)}"
    end

    # Places a decimal point in significant `digits` whose value is 0.digits x 10^point.
    def js_digits(digits, point)
      size = digits.length
      if point.between?(size, 21) then digits + ('0' * (point - size))
      elsif point.positive? && point <= 21 then "#{digits[0, point]}.#{digits[point..]}"
      elsif point > -6 && point <= 0 then "0.#{'0' * -point}#{digits}"
      else
        shown = size > 1 ? "#{digits[0]}.#{digits[1..]}" : digits
        "#{shown}e#{point - 1 >= 0 ? '+' : '-'}#{(point - 1).abs}"
      end
    end
  end
  private_constant :Transforms
end
