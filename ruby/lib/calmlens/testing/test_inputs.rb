# frozen_string_literal: true

require 'openssl'
require_relative 'classification'
require_relative 'test_input_scenario'

module CalmLens
  # Signed test inputs: text codes and media phrases that a project's moderation
  # recognises as a declared scenario when they are signed with its secret test input key (shown in
  # the portal's project settings), so CalmLens returns that scenario instead of classifying them.
  # The formats match the JavaScript SDK's `calmlens/test-inputs` byte for byte.
  #
  # A scenario is a Hash with the API's keys, as Strings or Symbols (snake_case keys are converted
  # to camelCase like other options):
  # `{ 'regionalActions' => [{ 'region' => 'DE', 'action' => 'block' }], 'unassessedCategories' => ['profanity'],
  # 'instances' => [{ 'category' => 'harassment', 'score' => 0.9, 'action' => 'block', 'qualifiers' => ['harassment-abuse'] }] }`.
  # `instances` (at most 128) and each instance's `qualifiers` (unique qualifiers of its category, at
  # most 64; input-type qualifiers such as `sexual-text` are automatic) are required; `score` (0 to
  # 1) and `action` (`allow`, `limit`, `age-restrict` or `block`, on every instance or none) are
  # optional. `unassessedCategories` lists categories reported as not assessed, none with instances;
  # `regionalActions` gives up to one `limit`, `age-restrict` or `block` action for each of
  # {REGIONS}. Values are Strings and Numerics. An absent list is left out of the signed scenario;
  # an empty one is sent as `[]`. Anything else raises `sdk/invalid-argument`.
  #
  # @example
  #   code = CalmLens::TestInputs.generate_text_code('harassment.insult', test_input_key)
  #   phrase = CalmLens::TestInputs.generate_media_code('violence', test_input_key)
  module TestInputs
    # The regions a regional action can name.
    REGIONS = %w[DE AT FR GB EU AU BR].freeze
    # The signals {generate_text_code} and {for_signal} accept: the categories and
    # five named shortcuts.
    SIGNALS = (MockClassification::CATEGORIES +
               %w[sexual.involving-minors harassment.insult sexual.adult hate.regional-symbol violence.graphic]).freeze
    # The signals {generate_media_code} accepts.
    MEDIA_SIGNALS = (MockClassification::CATEGORIES + %w[violence.graphic]).freeze

    one = ->(category, *qualifiers) { { 'instances' => [{ 'category' => category, 'qualifiers' => qualifiers }] } }
    deep_freeze = lambda do |value|
      value.each_value { |item| deep_freeze.call(item) } if value.is_a?(Hash)
      value.each { |item| deep_freeze.call(item) } if value.is_a?(Array)
      value.freeze
    end
    # Ready-made scenarios (deeply frozen): a clean input, a limited one, adult images and text,
    # regional delivery, content restricted in Germany, and mixed instances in one category.
    PRESETS = deep_freeze.call(
      clean: { 'instances' => [] },
      limited: one.call('harassment', 'harassment-abuse'),
      adult_image: one.call('sexual', 'sexual-pornographic-media'),
      adult_text: one.call('sexual', 'sexual-explicit-language'),
      regional_delivery: { 'instances' => [], 'regionalActions' => [{ 'region' => 'DE', 'action' => 'block' },
                                                                    { 'region' => 'GB', 'action' => 'age-restrict' },
                                                                    { 'region' => 'FR', 'action' => 'limit' }] },
      germany: one.call('hate', 'hate-symbol', 'hate-nazi-symbols-public-display'),
      mixed: { 'instances' => [{ 'category' => 'harassment', 'qualifiers' => %w[harassment-abuse harassment-documentary] },
                               { 'category' => 'harassment', 'qualifiers' => ['harassment-threat'] }] }
    )

    HEX_WORDS = %w[zero one two three four five six seven eight nine alpha bravo charlie delta echo foxtrot].freeze
    private_constant :HEX_WORDS

    module_function

    # The scenario a signal (one of {SIGNALS}) stands for in a text input (`kind` `'text'`) or an
    # image (`'image'`), as a new Hash. {generate_text_code} uses the text kind.
    # @param signal [String]
    # @param kind [String] `'text'` or `'image'`
    # @return [Hash{String => Object}]
    # @raise [InvalidArgumentError] `sdk/invalid-argument` for an unknown signal or kind
    def for_signal(signal, kind = 'text')
      raise Internal.invalid("Test input kind must be text or image (got #{kind.inspect})") unless %w[text image].include?(kind)

      preset = case signal
               when 'harassment.insult' then PRESETS[:limited]
               when 'sexual.adult' then PRESETS[kind == 'image' ? :adult_image : :adult_text]
               when 'hate.regional-symbol' then PRESETS[:germany]
               when 'sexual.involving-minors' then { 'instances' => [{ 'category' => 'sexual', 'qualifiers' => ['sexual-minors'] }] }
               when 'violence.graphic' then { 'instances' => [{ 'category' => 'violence', 'qualifiers' => ['violence-graphic'] }] }
               when *MockClassification::CATEGORIES then { 'instances' => [{ 'category' => signal, 'qualifiers' => [] }] }
               else raise Internal.invalid("Unknown test signal #{signal.inspect}")
               end
      Marshal.load(Marshal.dump(preset))
    end

    # The signed text code for a scenario or a signal (one of {SIGNALS}): put it anywhere in a text
    # input.
    # @param input [Hash, String] a scenario or a signal
    # @param test_input_key [String] the project's secret test input key from the portal
    # @return [String]
    # @raise [InvalidArgumentError] `sdk/invalid-argument` for an invalid key, scenario or signal
    def generate_text_code(input, test_input_key)
      check_key(test_input_key)
      checked = Scenario.validate(input.is_a?(String) ? for_signal(input) : input)
      payload = [Scenario.canonical_json(checked)].pack('m0').tr('+/', '-_').delete('=')
      raise Internal.invalid('Test scenario is too large') if payload.bytesize > 8000

      "<!calmlens-test #{tag(test_input_key, "calmlens-test:v1:#{payload}")} #{payload}>"
    end

    # The phrase that triggers a signal (one of {MEDIA_SIGNALS}) in audio or video: read it aloud,
    # or show it as large, high-contrast text in a frame.
    # @param signal [String]
    # @param test_input_key [String] the project's secret test input key from the portal
    # @return [String]
    # @raise [InvalidArgumentError] `sdk/invalid-argument` for an invalid key or signal
    def generate_media_code(signal, test_input_key)
      raise Internal.invalid("Unsupported media test signal #{signal.inspect}") unless MEDIA_SIGNALS.include?(signal)

      check_key(test_input_key)
      words = tag(test_input_key, "calmlens-test:media:#{signal}").each_char.map { |digit| HEX_WORDS[digit.to_i(16)] }
      ['Calm Lens test', *words, signal.tr('.-', '  '), 'end test'].join(' ')
    end

    def check_key(key)
      return if key.is_a?(String) && key.match?(/\A[a-f0-9]{32}\z/)

      raise Internal.invalid('The test input key must be 32 lowercase hexadecimal characters')
    end

    # The first 32 hex characters of HMAC-SHA256 with the key's ASCII bytes.
    def tag(key, message) = OpenSSL::HMAC.hexdigest('SHA256', key, message)[0, 32]

    private_class_method :check_key, :tag
  end
end
