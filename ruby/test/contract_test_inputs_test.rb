# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require_relative 'contract_fixtures'

# Replays testdata/test-inputs.json: signed text codes and media phrases must match
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

  def test_signal_inputs_are_new_hashes
    first = TestInputs.for_signal('harassment.insult')
    first['instances'] << { 'category' => 'hate', 'qualifiers' => [] }
    assert_equal FIXTURE['presets']['limited'], TestInputs.for_signal('harassment.insult')
  end

  each_case('signal_input', FIXTURE['signalInputs']) { |item| "#{item['signal']} #{item['kind']}" }
  each_case('text', FIXTURE['text']) { |item| item['name'] }
  each_case('media', FIXTURE['media']) { |item| item['signal'] }
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
