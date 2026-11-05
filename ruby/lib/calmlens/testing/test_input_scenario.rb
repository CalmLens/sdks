# frozen_string_literal: true

require_relative 'classification'
require_relative 'test_input_detections'

module CalmLens
  # The scenario checks behind the signed test inputs (test_inputs.rb).
  module TestInputs
    # Checks test input scenarios and writes them as the backend's canonical JSON.
    # @api private
    module Scenario
      ACTIONS = %w[allow limit age-restrict block].freeze
      REGIONAL_ACTIONS = %w[limit age-restrict block].freeze
      # The qualifiers a scenario may list for each category: all but those the input type sets.
      ALLOWED_QUALIFIERS = MockClassification::QUALIFIERS.transform_values do |list|
        (list - MockClassification::INPUT_QUALIFIERS).freeze
      end.freeze

      module_function

      # A checked scenario's JSON in the backend's key order. Every string is a validated ASCII token.
      def canonical_json(value)
        case value
        when Hash then "{#{value.map { |key, item| "\"#{key}\":#{canonical_json(item)}" }.join(',')}}"
        when Array then "[#{value.map { |item| canonical_json(item) }.join(',')}]"
        when Float then js_number(value)
        when Integer then value.to_s
        else "\"#{value}\""
        end
      end

      # A score as JavaScript's JSON.stringify writes it: the shortest round-tripping digits, in
      # exponent form below 1e-6, and 0 for -0.
      def js_number(value)
        return '0' if value.zero?

        mantissa, exponent = value.to_s.split('e')
        whole, fraction = mantissa.split('.')
        digits = whole + fraction.to_s
        point = whole.size + exponent.to_i
        stripped = digits.sub(/\A0+/, '')
        point -= digits.size - stripped.size
        digits = stripped.sub(/0+\z/, '')
        if value < 1e-6
          "#{digits[0]}#{".#{digits[1..]}" if digits.size > 1}e#{point - 1}"
        elsif point <= 0 then "0.#{'0' * -point}#{digits}"
        elsif point >= digits.size then digits + ('0' * (point - digits.size))
        else "#{digits[0, point]}.#{digits[point..]}"
        end
      end

      # Checks a scenario and returns it with camelCase String keys in canonical order.
      def validate(input)
        input = fields(input, 'scenario', %w[regionalActions unassessedCategories instances detections], %w[instances])
        instances = array(input['instances'], 'instances', 128).map { |instance| check_instance(instance) }
        with_action = instances.count { |instance| instance.key?('action') }
        check([0, instances.size].include?(with_action), 'Set an action for every instance or omit all actions')
        checked = {}
        if input.key?('regionalActions')
          checked['regionalActions'] = array(input['regionalActions'], 'regionalActions', REGIONS.size).each_with_object([]) do |item, done|
            item = fields(item, 'regional action', %w[region action], %w[region action])
            check(REGIONS.include?(item['region']) && done.none? { |other| other['region'] == item['region'] },
                  "Regional actions need unique regions from #{REGIONS.join(', ')} (got #{item['region'].inspect})")
            check(REGIONAL_ACTIONS.include?(item['action']), "Regional action must be one of #{REGIONAL_ACTIONS.join(', ')}")
            done << { 'region' => item['region'], 'action' => item['action'] }
          end
        end
        if input.key?('unassessedCategories')
          unassessed = array(input['unassessedCategories'], 'unassessedCategories', MockClassification::CATEGORIES.size)
          unassessed.each_with_index do |category, index|
            check(MockClassification::CATEGORIES.include?(category) && !unassessed[0, index].include?(category) &&
                    instances.none? { |instance| instance['category'] == category },
                  "Unassessed categories must be unique categories without instances (got #{category.inspect})")
          end
          checked['unassessedCategories'] = unassessed
        end
        checked['instances'] = instances
        checked['detections'] = Detections.validate(input['detections']) if input.key?('detections')
        checked
      end

      def check_instance(instance)
        instance = fields(instance, 'instance', %w[category score action qualifiers], %w[category qualifiers])
        category = instance['category']
        allowed = ALLOWED_QUALIFIERS[category] if category.is_a?(String)
        check(allowed, "Unknown category #{category.inspect}")
        checked = { 'category' => category }
        if instance.key?('score')
          score = instance['score']
          check(score.is_a?(Numeric) && score.real? && score.to_f.between?(0, 1), 'Score must be a number from 0 to 1')
          checked['score'] = score.to_f
        end
        if instance.key?('action')
          check(ACTIONS.include?(instance['action']), "Action must be one of #{ACTIONS.join(', ')}")
          checked['action'] = instance['action']
        end
        qualifiers = array(instance['qualifiers'], 'qualifiers', 64)
        qualifiers.each_with_index do |qualifier, index|
          check(allowed.include?(qualifier) && !qualifiers[0, index].include?(qualifier),
                "Choose unique #{category} qualifiers; input-type qualifiers are automatic (got #{qualifier.inspect})")
        end
        checked.merge('qualifiers' => qualifiers)
      end

      # A Hash's entries by camelCase key, refusing unknown, duplicate and missing keys.
      def fields(value, name, allowed, required)
        check(value.is_a?(Hash), "A test #{name} must be a Hash (got #{value.class})")
        result = {}
        value.each do |key, item|
          field = Internal.camelize(key) if key.is_a?(String) || key.is_a?(Symbol)
          check(allowed.include?(field), "Unknown test #{name} field #{key.inspect}")
          check(!result.key?(field), "Test #{name} field #{field} is given twice")
          result[field] = item
        end
        missing = required - result.keys
        check(missing.empty?, "A test #{name} needs #{missing.join(', ')}")
        result
      end

      def array(value, name, max)
        check(value.is_a?(Array), "#{name} must be an Array")
        check(value.size <= max, "#{name} has at most #{max} items")
        value.dup
      end

      def check(condition, message) = condition || raise(Internal.invalid(message))
    end

    private_constant :Scenario
  end
end
