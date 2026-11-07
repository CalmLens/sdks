# frozen_string_literal: true

require 'openssl'
require_relative 'classification'
require_relative 'test_input_scenario'
require_relative 'test_image_grid'

module CalmLens
  # Signed test inputs: text codes, test images and media phrases that a project's moderation
  # recognises as a declared scenario when they are signed with its secret test input key (shown in
  # the portal's project settings to those who can read them) and the project has "Recognise test
  # inputs" turned on, so CalmLens returns that scenario instead of classifying them. Text codes and
  # test images expire, by default {DEFAULT_LIFETIME_SECONDS} after they are made, so generate them
  # when tests run rather than storing them. The formats match the JavaScript SDK's
  # `calmlens/test-inputs` byte for byte.
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
  # {REGIONS}. `detections` (optional, `people` and `faces` each optional) sets the person and face
  # detection results a test image reports: each list holds at most 32 entries, or is the String
  # `'unavailable'` to report the feature as not evaluated. An entry has a `box`, `[left, top, width,
  # height]` as Integers in basis points of the image (0 to 10000, inside it), and an optional
  # Integer `confidence` from 0 to 100; a face may also have an `age`, `'adult'`, `'minor'` or
  # `{ 'low' => 30, 'high' => 40 }` (Integers from 0 to 120). Values are Strings and Numerics. An
  # absent list is left out of the signed scenario; an empty one is sent as `[]`. Anything else
  # raises `sdk/invalid-argument`.
  #
  # @example
  #   code = CalmLens::TestInputs.generate_text_code('harassment.insult', test_input_key)
  #   png = CalmLens::TestInputs.paint_image('violence', test_input_key).png
  #   phrase = CalmLens::TestInputs.generate_media_code('violence', test_input_key)
  module TestInputs
    # A painted test image: `width` by `height` pixels of 8-bit RGBA, row by row, in the binary
    # String `rgba`, and the same image as binary PNG bytes in `png`.
    Image = Struct.new(:width, :height, :rgba, :png, keyword_init: true)

    # The regions a regional action can name.
    REGIONS = %w[DE AT FR GB EU AU BR].freeze
    # The signals {generate_text_code}, {paint_image} and {for_signal} accept: the categories and
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
    person = { 'box' => [2500, 1500, 5000, 8500] }
    face = ->(age = nil) { { 'box' => [3500, 2000, 3000, 3500], **(age ? { 'age' => age } : {}) } }
    # Ready-made scenarios (deeply frozen): a clean input, a limited one, adult images and text,
    # regional delivery, content restricted in Germany, mixed instances in one category, and test
    # images with one person and face, nobody, an adult's face, a minor's face and a group of three.
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
                               { 'category' => 'harassment', 'qualifiers' => ['harassment-threat'] }] },
      one_face: { 'instances' => [], 'detections' => { 'people' => [person], 'faces' => [face.call] } },
      no_face: { 'instances' => [], 'detections' => { 'people' => [], 'faces' => [] } },
      adult_face: { 'instances' => [], 'detections' => { 'people' => [person], 'faces' => [face.call('adult')] } },
      minor_face: { 'instances' => [], 'detections' => { 'people' => [person], 'faces' => [face.call('minor')] } },
      group: { 'instances' => [], 'detections' => {
        'people' => [500, 3600, 6700].map { |left| { 'box' => [left, 2000, 2800, 8000] } },
        'faces' => [1200, 4300, 7400].map { |left| { 'box' => [left, 2500, 1400, 2000] } }
      } }
    )

    # A text code or test image expires this many seconds (one day) after it is made unless
    # `expires_at` says otherwise.
    DEFAULT_LIFETIME_SECONDS = 24 * 60 * 60
    # CalmLens ignores a text code or test image more than this many seconds (seven days) from
    # expiring when it arrives.
    MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60

    HEX_WORDS = %w[zero one two three four five six seven eight nine alpha bravo charlie delta echo foxtrot].freeze
    private_constant :HEX_WORDS

    module_function

    # The scenario a signal (one of {SIGNALS}) stands for in a text input (`kind` `'text'`) or an
    # image (`'image'`), as a new Hash. {generate_text_code} uses the text kind and {paint_image}
    # the image kind.
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
               when 'violence.graphic'
                 { 'instances' => [{ 'category' => 'violence', 'qualifiers' => %w[violence-injury violence-graphic] }] }
               when *MockClassification::CATEGORIES then { 'instances' => [{ 'category' => signal, 'qualifiers' => [] }] }
               else raise Internal.invalid("Unknown test signal #{signal.inspect}")
               end
      Marshal.load(Marshal.dump(preset))
    end

    # The signed text code for a scenario or a signal (one of {SIGNALS}). Submit it as the whole
    # text: CalmLens moderates text with anything else around the code as ordinary content.
    # @param input [Hash, String] a scenario or a signal
    # @param test_input_key [String] the project's secret test input key from the portal
    # @param expires_at [Integer, nil] when the code expires, in Unix seconds from 0 to 4294967295;
    #   by default {DEFAULT_LIFETIME_SECONDS} from now
    # @return [String]
    # @raise [InvalidArgumentError] `sdk/invalid-argument` for an invalid key, scenario, signal or
    #   expiry
    def generate_text_code(input, test_input_key, expires_at: nil)
      text_code(scenario(input, 'text', test_input_key), test_input_key, expiry(expires_at))
    end

    # Paints the signed test image for a scenario or a signal (one of {SIGNALS}): a grid that
    # survives lossy formats and resizing. Upload its `png`, or encode its `rgba` in any format, as
    # the whole image, optionally on a plain single-colour border: CalmLens moderates an image with
    # anything else in it as ordinary content.
    # @param input [Hash, String] a scenario or a signal
    # @param test_input_key [String] the project's secret test input key from the portal
    # @param expires_at [Integer, nil] when the image expires, in Unix seconds from 0 to 4294967295;
    #   by default {DEFAULT_LIFETIME_SECONDS} from now
    # @return [Image]
    # @raise [InvalidArgumentError] `sdk/invalid-argument` for an invalid key, scenario, signal or
    #   expiry, or a scenario too large for a test image
    def paint_image(input, test_input_key, expires_at: nil)
      checked = scenario(input, 'image', test_input_key)
      _, signature, payload = text_code(checked, test_input_key, expiry(expires_at)).chomp('>').split
      signed = payload.tr('-_', '+/').unpack1('m')
      data = [signed.bytesize].pack('n') + [signature].pack('H*') + signed
      width, rgba = Grid.paint(data, checked['instances'].map { |instance| instance['category'] })
      Image.new(width: width, height: width, rgba: rgba, png: Png.png(width, width, rgba))
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

    # The checked scenario for an input or signal, in canonical form.
    def scenario(input, kind, test_input_key)
      check_key(test_input_key)
      Scenario.validate(input.is_a?(String) ? for_signal(input, kind) : input)
    end

    # The expiry to sign: `expires_at`, or {DEFAULT_LIFETIME_SECONDS} from now.
    def expiry(expires_at)
      return Time.now.to_i + DEFAULT_LIFETIME_SECONDS if expires_at.nil?
      return expires_at if expires_at.is_a?(Integer) && expires_at.between?(0, 0xFFFF_FFFF)

      raise Internal.invalid("expires_at must be an Integer of Unix seconds from 0 to 4294967295 (got #{expires_at.inspect})")
    end

    # The signed payload is the expiry (four bytes, big-endian Unix seconds), then the scenario's
    # canonical JSON.
    def text_code(checked, test_input_key, expires_at)
      signed = [expires_at].pack('N') + Scenario.canonical_json(checked).b
      payload = [signed].pack('m0').tr('+/', '-_').delete('=')
      raise Internal.invalid('Test scenario is too large') if payload.bytesize > 8000

      "<!calmlens-test #{tag(test_input_key, "calmlens-test:v2:#{payload}")} #{payload}>"
    end

    def check_key(key)
      return if key.is_a?(String) && key.match?(/\A[a-f0-9]{32}\z/)

      raise Internal.invalid('The test input key must be 32 lowercase hexadecimal characters')
    end

    # The first 32 hex characters of HMAC-SHA256 with the key's ASCII bytes.
    def tag(key, message) = OpenSSL::HMAC.hexdigest('SHA256', key, message)[0, 32]

    private_class_method :scenario, :expiry, :text_code, :check_key, :tag
  end
end
