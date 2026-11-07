# frozen_string_literal: true

require 'digest'
require 'minitest/autorun'
require 'zlib'
require 'calmlens'
require 'calmlens/testing'
require_relative 'contract_fixtures'

# Replays testdata/test-inputs.json: signed text codes, test images and media phrases must match
# the backend's formats byte for byte, and every invalid key, signal or scenario is refused with
# `sdk/invalid-argument`. Each fixture case is its own test.
class ContractTestInputsTest < Minitest::Test
  extend ContractFixtures

  FIXTURE = fixture('test-inputs')
  TestInputs = CalmLens::TestInputs
  KEY = '1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d'

  def self.each_case(prefix, cases)
    cases.each_with_index do |item, index|
      label = yield(item).to_s.downcase.gsub(/[^a-z0-9]+/, '_').delete_prefix('_').delete_suffix('_')
      define_method("test_#{prefix}_#{index + 1}_#{label}") { public_send("replay_#{prefix}", item) }
    end
  end

  # A fixture case's scenario, or its signal.
  def input(item) = item.key?('signal') ? item['signal'] : item['input']

  def test_presets_match_the_fixture
    presets = TestInputs::PRESETS.transform_keys { |name| name.to_s.gsub(/_([a-z])/) { Regexp.last_match(1).upcase } }
    assert_equal FIXTURE['presets'], presets
    assert_raises(FrozenError) { TestInputs::PRESETS[:mixed]['instances'][0]['qualifiers'] << 'harassment-threat' }
    assert_raises(FrozenError) { TestInputs::PRESETS[:group]['detections']['faces'][0]['box'][0] = 0 }
  end

  # The detection limits and age presets a scenario accepts are the fixture's.
  def test_detection_limits_match_the_fixture
    limits = FIXTURE['detections']
    classification = CalmLens::MockClassification
    assert_equal [limits['maxEntries'], limits['boxMax'], limits['ageMax'], limits['agePresets'].keys],
                 [classification::TEST_DETECTIONS_MAX, classification::TEST_DETECTION_BOX_MAX, classification::TEST_FACE_AGE_MAX,
                  classification::TEST_FACE_AGE_PRESETS]
    face = ->(box, age) { { 'instances' => [], 'detections' => { 'faces' => [{ 'box' => box, 'age' => age }] } } }
    max = limits['boxMax']
    assert accepts?(face.call([0, 0, max, max], { 'low' => 0, 'high' => limits['ageMax'] }))
    refute accepts?(face.call([0, 0, max + 1, 0], 'adult'))
    refute accepts?(face.call([0, 0, 1, 1], { 'low' => 0, 'high' => limits['ageMax'] + 1 }))
    limits['agePresets'].each_key { |preset| assert accepts?(face.call([0, 0, 1, 1], preset)), preset }
    list = ->(size) { { 'instances' => [], 'detections' => { 'people' => Array.new(size) { { 'box' => [0, 0, 1, 1] } } } } }
    assert accepts?(list.call(limits['maxEntries']))
    refute accepts?(list.call(limits['maxEntries'] + 1))
  end

  def test_signals_match_the_fixture
    assert_equal FIXTURE['signals']['text'], TestInputs::SIGNALS
    assert_equal FIXTURE['signals']['media'], TestInputs::MEDIA_SIGNALS
  end

  # A scenario accepts exactly the fixture's qualifiers of each category.
  def test_allowed_qualifiers_match_the_fixture
    assert_equal FIXTURE['qualifiers'].keys, CalmLens::MockClassification::CATEGORIES
    accepted = CalmLens::MockClassification::QUALIFIERS.to_h do |category, qualifiers|
      [category, qualifiers.select { |qualifier| accepts?('instances' => [{ 'category' => category, 'qualifiers' => [qualifier] }]) }]
    end
    assert_equal FIXTURE['qualifiers'], accepted
  end

  def accepts?(input)
    TestInputs.generate_text_code(input, KEY)
    true
  rescue CalmLens::InvalidArgumentError
    false
  end

  def test_scenarios_accept_symbol_and_snake_case_keys
    expected = FIXTURE['text'].find { |item| item['name'] == 'keyOrder' }
    symbolized = JSON.parse(JSON.generate(expected['input']), symbolize_names: true)
    symbolized[:regional_actions] = symbolized.delete(:regionalActions)
    assert_equal expected['code'], TestInputs.generate_text_code(symbolized, expected['key'])
  end

  def test_a_key_given_in_two_forms_is_refused
    error = assert_raises(CalmLens::InvalidArgumentError) do
      TestInputs.generate_text_code({ 'instances' => [], instances: [] }, KEY)
    end
    assert_equal CalmLens::SdkErrorCodes::INVALID_ARGUMENT, error.code
  end

  def test_detection_keys_accept_symbols
    expected = FIXTURE['text'].find { |item| item['name'] == 'detectionsKeyOrder' }
    symbolized = JSON.parse(JSON.generate(expected['input']), symbolize_names: true)
    assert_equal expected['code'], TestInputs.generate_text_code(symbolized, expected['key'])
  end

  # Each detection key given as both a String and a Symbol is refused rather than one winning.
  def test_a_detection_key_given_in_two_forms_is_refused
    box = [0, 0, 1, 1]
    duplicated = {
      'detections' => { 'instances' => [], 'detections' => {}, detections: {} },
      'people' => { 'instances' => [], 'detections' => { 'people' => [], people: [] } },
      'faces' => { 'instances' => [], 'detections' => { 'faces' => [], faces: [] } },
      'box' => { 'instances' => [], 'detections' => { 'faces' => [{ 'box' => box, box: box }] } },
      'confidence' => { 'instances' => [], 'detections' => { 'people' => [{ 'box' => box, 'confidence' => 1, confidence: 1 }] } },
      'age' => { 'instances' => [], 'detections' => { 'faces' => [{ 'box' => box, 'age' => 'adult', age: 'adult' }] } },
      'low' => { 'instances' => [], 'detections' => { 'faces' => [{ 'box' => box, 'age' => { 'low' => 1, low: 1, 'high' => 2 } }] } },
      'high' => { 'instances' => [], 'detections' => { 'faces' => [{ 'box' => box, 'age' => { 'low' => 1, 'high' => 2, high: 2 } }] } }
    }
    duplicated.each do |key, input|
      error = assert_raises(CalmLens::InvalidArgumentError, key) { TestInputs.generate_text_code(input, KEY) }
      assert_equal CalmLens::SdkErrorCodes::INVALID_ARGUMENT, error.code
      assert accepts?(string_keys_only(input)), "#{key} once is accepted"
    end
  end

  # `value` without its Symbol keys.
  def string_keys_only(value)
    case value
    when Hash then value.reject { |key, _| key.is_a?(Symbol) }.transform_values { |item| string_keys_only(item) }
    when Array then value.map { |item| string_keys_only(item) }
    else value
    end
  end

  def test_signal_inputs_are_new_hashes
    first = TestInputs.for_signal('harassment.insult')
    first['instances'] << { 'category' => 'hate', 'qualifiers' => [] }
    assert_equal FIXTURE['presets']['limited'], TestInputs.for_signal('harassment.insult')
  end

  each_case('signal_input', FIXTURE['signalInputs']) { |item| "#{item['signal']} #{item['kind']}" }
  each_case('text', FIXTURE['text']) { |item| item['name'] }
  each_case('media', FIXTURE['media']) { |item| item['signal'] }
  each_case('image', FIXTURE['images']) { |item| item['name'] }
  each_case('image_rejection', FIXTURE['imageRejections']) { |item| item['name'] }
  each_case('rejection', FIXTURE['rejections']) { |item| "#{item['kind']} #{item['name']}" }

  def replay_signal_input(item)
    assert_equal item['input'], TestInputs.for_signal(item['signal'], item['kind'])
  end

  def replay_text(item)
    assert_equal item['code'], TestInputs.generate_text_code(input(item), item['key'])
  end

  def replay_media(item)
    assert_equal item['code'], TestInputs.generate_media_code(item['signal'], item['key'])
  end

  def replay_image(item)
    image = TestInputs.paint_image(input(item), item['key'])
    assert_equal [item['width'], item['height']], [image.width, image.height]
    assert_equal item['rgbaSha256'], Digest::SHA256.hexdigest(image.rgba)
    assert_equal item['levels'], fixture_levels(image, item['cells'])
    assert_equal [image.width, image.height, image.rgba], decode_png(image.png)
  end

  def replay_image_rejection(item)
    error = assert_raises(CalmLens::InvalidArgumentError, item['name']) { TestInputs.paint_image(input(item), item['key']) }
    assert_equal CalmLens::SdkErrorCodes::INVALID_ARGUMENT, error.code
  end

  # Each cell's level as packages/sdk-contract/testInputs.ts records it: "r" for the outer ring,
  # else the data level (0-3) nearest the luma of the cell's top-left pixel.
  def fixture_levels(image, cells)
    levels = TestInputs.const_get(:Grid)::LEVELS
    size = image.width / cells
    Array.new(cells * cells) do |cell|
      row, column = cell.divmod(cells)
      next 'r' if [0, cells - 1].include?(row) || [0, cells - 1].include?(column)

      offset = ((row * size * image.width) + (column * size)) * 4
      red, green, blue = image.rgba.byteslice(offset, 3).bytes
      luma = ((77 * red) + (150 * green) + (29 * blue)) >> 8
      levels.each_index.min_by { |index| (levels[index] - luma).abs }
    end.join
  end

  # Width, height and RGBA of an unfiltered 8-bit RGBA PNG, checking every chunk's CRC.
  def decode_png(png)
    assert_equal "\x89PNG\r\n\x1a\n".b, png.byteslice(0, 8)
    offset = 8
    chunks = Hash.new { |hash, key| hash[key] = +''.b }
    while offset < png.bytesize
      length = png.byteslice(offset, 4).unpack1('N')
      type = png.byteslice(offset + 4, 4)
      body = png.byteslice(offset + 8, length)
      assert_equal Zlib.crc32(type + body), png.byteslice(offset + 8 + length, 4).unpack1('N')
      chunks[type] << body
      offset += 12 + length
    end
    width, height, depth, colour = chunks['IHDR'].unpack('NNCC')
    assert_equal [8, 6], [depth, colour]
    raw = Zlib::Inflate.inflate(chunks['IDAT'])
    stride = (width * 4) + 1
    rows = Array.new(height) { |row| raw.byteslice(row * stride, stride) }
    assert(rows.all? { |row| row.getbyte(0).zero? })
    [width, height, rows.map { |row| row.byteslice(1..) }.join]
  end

  def replay_rejection(item)
    error = assert_raises(CalmLens::InvalidArgumentError, item['name']) do
      if item['kind'] == 'media'
        TestInputs.generate_media_code(item['signal'], item['key'])
      else
        TestInputs.generate_text_code(input(item), item['key'])
      end
    end
    assert_equal CalmLens::SdkErrorCodes::INVALID_ARGUMENT, error.code
  end
end
