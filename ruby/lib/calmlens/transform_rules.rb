# frozen_string_literal: true

module CalmLens
  # The CDN's rules for transforms: options checked against the image transform schema
  # (Internal::TRANSFORM_OPTIONS_SCHEMA), and selectors read as the CDN reads them.
  # @api private
  module TransformRules
    module_function

    # Checks transform options against the image transform schema, as the CDN does, and returns
    # the dotted keys it doesn't know and those whose values it refuses (or that are required and
    # missing). nil options are left out of a selector, so they are not checked.
    # @return [Array(Array<String>, Array<String>)] the unknown keys and the invalid keys
    def check(options)
      unknown = []
      invalid = []
      check_rule(Internal::TRANSFORM_OPTIONS_SCHEMA, options, '', unknown, invalid)
      [unknown, invalid]
    end

    def check_rule(schema, value, key, unknown, invalid)
      rule = schema.key?('oneOf') ? schema['oneOf'].find { |branch| rule_type?(branch['type'], value) } : schema
      return invalid << key unless rule && rule_allows?(rule, value)
      return unless rule['type'] == 'object'

      path = ->(name) { key.empty? ? name : "#{key}.#{name}" }
      entries = value.to_h { |name, item| [name.to_s, item] }
      rule.fetch('required', []).each { |name| invalid << path.call(name) if entries[name].nil? }
      entries.keys.sort.each do |name|
        next if entries[name].nil?

        child = rule.fetch('properties', {})[name]
        child ? check_rule(child, entries[name], path.call(name), unknown, invalid) : unknown << path.call(name)
      end
    end

    def rule_allows?(rule, value)
      rule_type?(rule['type'], value) &&
        (!rule.key?('enum') || rule['enum'].include?(value)) &&
        (!rule.key?('minimum') || value >= rule['minimum']) &&
        (!rule.key?('maximum') || value <= rule['maximum'])
    end

    def rule_type?(type, value)
      case type
      when 'object' then value.is_a?(Hash)
      when 'string' then value.is_a?(String)
      when 'boolean' then [true, false].include?(value)
      when 'number' then value.is_a?(Integer) || (value.is_a?(Float) && value.finite?)
      when 'integer' then value.is_a?(Integer) || (value.is_a?(Float) && value.finite? && value == value.floor)
      else true
      end
    end

    NUMBER = /\A-?(?:0|[1-9]\d*)(?:\.\d+)?\z/
    LENS = /\A[a-z0-9-]{1,50}\z/

    # Reads a CDN selector, the path text after the resource as sent (still percent-encoded), as the
    # CDN does: an optional first `@lens`, then `key=value` options with dotted keys for nested ones (a
    # bare key is `true`). Values are numbers, `true`, `false`, hex colours (`#` added) for colour
    # options, or text. Raises ArgumentError on anything the CDN refuses as `transform/invalid`.
    # Used by the mock CDN.
    # @return [Array(String, Hash)] the lens and the options, each nil when absent
    def parse_selector(selector)
      return [nil, nil] if selector.empty?
      raise ArgumentError, "Invalid transform selector #{selector.inspect}" if selector.include?('/')

      entries = selector.split(',', -1)
      lens = nil
      if entries.first.start_with?('@')
        lens = selector_text(entries.shift.delete_prefix('@'), selector)
        raise ArgumentError, "Invalid transform selector #{selector.inspect}" unless lens.match?(LENS)
      end
      return [lens, nil] if entries.empty?

      options = {}
      entries.each { |entry| add_selector_entry(options, entry, selector) }
      [lens, options]
    end

    def add_selector_entry(options, entry, selector)
      fail = -> { ArgumentError.new("Invalid transform selector #{selector.inspect}") }
      raise fail.call if entry.empty? || entry.start_with?('@')

      key, separator, text = entry.partition('=')
      parts = key.split('.', -1)
      raise fail.call unless parts.all? { |part| part.match?(Transforms::OPTION_NAME) }

      value = separator.empty? || selector_value(key, selector_text(text, selector))
      raise fail.call if value == ''

      target = parts[0..-2].reduce(options) do |current, part|
        raise fail.call unless current[part].nil? || current[part].is_a?(Hash)

        current[part] ||= {}
      end
      raise fail.call if target.key?(parts.last)

      target[parts.last] = value
    end

    def selector_value(key, text)
      return text if text.empty?
      return "##{text.downcase}" if Transforms::COLOUR_KEYS.include?(key) && Transforms::HEX_COLOUR.match?("##{text}")
      return text.include?('.') ? Float(text) : Integer(text, 10) if text.match?(NUMBER)
      return text == 'true' if %w[true false].include?(text)

      text
    end

    # Percent-decodes selector text, refusing malformed escapes and text that isn't UTF-8.
    def selector_text(text, selector)
      decoded = text.b.gsub(/%(\h\h)/n) { Regexp.last_match(1).hex.chr }.force_encoding(Encoding::UTF_8)
      raise ArgumentError, "Invalid transform selector #{selector.inspect}" if text.match?(/%(?!\h\h)/) || !decoded.valid_encoding?

      decoded
    end
  end
  private_constant :TransformRules
end
