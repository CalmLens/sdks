# frozen_string_literal: true

require_relative 'classification'

module CalmLens
  module TestInputs
    # Checks a test scenario's `detections` (test_input_scenario.rb).
    # @api private
    module Detections
      module_function

      # The people and faces a test image reports, each a list of boxes or `unavailable`.
      def validate(value)
        value = Scenario.fields(value, 'detections', %w[people faces], [])
        checked = {}
        checked['people'] = list(value['people'], 'people', %w[box confidence]) if value.key?('people')
        checked['faces'] = list(value['faces'], 'faces', %w[box confidence age]) if value.key?('faces')
        checked
      end

      def list(value, name, allowed)
        return value if value == 'unavailable'

        Scenario.check(value.is_a?(Array), "Detection #{name} must be an Array or 'unavailable'")
        Scenario.array(value, name, MockClassification::TEST_DETECTIONS_MAX).map do |entry|
          entry = Scenario.fields(entry, 'detection', allowed, %w[box])
          checked = { 'box' => check_box(entry['box']) }
          if entry.key?('confidence')
            Scenario.check(integer_between?(entry['confidence'], 0, 100), 'Detection confidence must be an Integer from 0 to 100')
            checked['confidence'] = entry['confidence']
          end
          checked['age'] = check_age(entry['age']) if entry.key?('age')
          checked
        end
      end

      # `[left, top, width, height]` in basis points of the image, inside it.
      def check_box(box)
        max = MockClassification::TEST_DETECTION_BOX_MAX
        Scenario.check(box.is_a?(Array) && box.size == 4 && box.all? { |item| integer_between?(item, 0, max) } &&
                box[0] + box[2] <= max && box[1] + box[3] <= max,
                       "A detection box is [left, top, width, height]: Integers from 0 to #{max} inside the image")
        box.dup
      end

      def check_age(age)
        return age if age.is_a?(String) && MockClassification::TEST_FACE_AGE_PRESETS.include?(age)

        max = MockClassification::TEST_FACE_AGE_MAX
        age = Scenario.fields(age, 'age', %w[low high], %w[low high]) if age.is_a?(Hash)
        Scenario.check(age.is_a?(Hash) && integer_between?(age['low'], 0, max) && integer_between?(age['high'], age['low'], max),
                       "A face age is #{MockClassification::TEST_FACE_AGE_PRESETS.join(' or ')}, or Integers low to high from 0 to #{max}")
        { 'low' => age['low'], 'high' => age['high'] }
      end

      def integer_between?(value, min, max) = value.is_a?(Integer) && value.between?(min, max)
    end

    private_constant :Detections
  end
end
