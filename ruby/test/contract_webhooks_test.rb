# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require 'net/http'
require 'openssl'
require_relative 'contract_fixtures'

# Replays the shared webhook and upload token fixtures (testdata/webhooks.json and
# upload-tokens.json, format in packages/sdk-contract/README.md): signing, verification, header
# extraction, parsing, test sends and round trips, and exact and real-clock upload tokens.
class ContractWebhooksTest < Minitest::Test
  extend ContractFixtures

  # Defines one test per fixture case, named after the case and its position.
  def self.each_case(prefix, cases)
    cases.each_with_index do |item, index|
      label = yield(item).to_s.downcase.gsub(/[^a-z0-9]+/, '_').delete_prefix('_').delete_suffix('_')
      define_method("test_#{prefix}_#{index + 1}_#{label}") { public_send("replay_#{prefix}", item) }
    end
  end

  WEBHOOKS = fixture('webhooks')

  # The future-event fixture: every field, known or not, is kept.
  def replay_webhook_parsing(entry)
    parsed = CalmLens.parse_webhook_event(payload: entry['body'], signature: entry['signature'],
                                          timestamp: entry['timestamp'], secret: entry['secret'], now: entry['now'])
    assert_equal JSON.parse(entry['body']), parsed.to_payload
    assert_equal entry['expectedType'], parsed.type
    assert_equal entry['expectedFactKey'], parsed.facts[0]['key']
  end
  each_case('webhook_parsing', WEBHOOKS['parsing']) { |entry| "#{entry['expectedType']} #{entry['expectedFactKey']}" }

  def replay_webhook_signature(vector)
    assert_equal vector['signature'],
                 CalmLens.create_webhook_signature_header(payload: vector['body'], timestamp: vector['timestamp'],
                                                          secret: vector['secret'])
  end
  each_case('webhook_signature', WEBHOOKS['signatures']) { |vector| vector['timestamp'] }

  def replay_webhook_verification(vector)
    valid = CalmLens.verify_webhook_signature(payload: vector['body'], signature: vector['signature'], timestamp: vector['timestamp'],
                                              secret: vector['secret'], now: vector['now'],
                                              tolerance_seconds: vector.fetch('toleranceSeconds', 300))
    assert_equal vector['valid'], valid, vector['name']
  end
  each_case('webhook_verification', WEBHOOKS['verification']) { |vector| vector['name'] }

  def replay_webhook_payload(entry)
    assert_equal entry['payload'], CalmLens.to_webhook_event_payload(entry['event'])
  end
  each_case('webhook_payload', WEBHOOKS['payloads']) { |entry| "#{entry['event']['type']} #{entry['event']['id']}" }

  # The header containers a Ruby receiver gets: a Hash (as Rails and Sinatra give header values),
  # a Rack env and Net::HTTP's headers, which keep repeated values.
  def header_containers(headers)
    net = Net::HTTP::Post.new('/')
    net.initialize_http_header({})
    rack = {}
    headers.each do |name, value|
      Array(value).each { |item| net.add_field(name, item) }
      rack["HTTP_#{name.upcase.tr('-', '_')}"] = Array(value).join(',')
    end
    { 'Hash' => headers, 'Net::HTTPHeader' => net }.merge(headers.values.any?(Array) ? {} : { 'Rack env' => rack })
  end

  def replay_webhook_headers(entry)
    header_containers(entry['headers']).each do |container, headers|
      valid = CalmLens.verify_webhook_request(payload: entry['body'], headers: headers, secret: entry['secret'], now: entry['now'])
      assert_equal entry['valid'], valid, "#{entry['name']} (#{container})"
    end
  end
  each_case('webhook_headers', WEBHOOKS['headerCases']) { |entry| entry['name'] }

  def replay_webhook_parse_error(entry)
    error = assert_raises(CalmLens::WebhookVerificationError) do
      CalmLens.parse_webhook_event(payload: entry['body'], signature: entry['signature'], timestamp: entry['timestamp'],
                                   secret: entry['secret'], now: entry['now'])
    end
    assert_equal entry['error'], error.code
  end
  each_case('webhook_parse_error', WEBHOOKS['parseErrors']) { |entry| entry['name'] }

  def replay_webhook_parsed(entry)
    event = CalmLens.parse_webhook_event(payload: entry['body'], signature: entry['signature'], timestamp: entry['timestamp'],
                                         secret: entry['secret'], now: entry['now'])
    assert_equal entry['expected'], event.to_payload
    assert_equal entry['isTest'], event.test?
  end
  each_case('webhook_parsed', WEBHOOKS['parsed']) { |entry| entry['name'] }

  def replay_webhook_test_fact(entry)
    assert_equal entry['isTest'], CalmLens.test_webhook_event?(entry['event']), entry['name']
  end
  each_case('webhook_test_fact', WEBHOOKS['testFacts']) { |entry| entry['name'] }

  def replay_webhook_round_trip(entry)
    assert_equal entry['payload'], CalmLens.to_webhook_event_payload(entry['event'])
    assert_equal entry['body'], JSON.generate(entry['payload'])
    headers = CalmLens.create_webhook_headers(payload: entry['body'], delivery_id: entry['deliveryId'], secret: entry['secret'],
                                              timestamp: entry['timestampSeconds'])
    assert_equal entry['headers'], headers
    received = CalmLens.parse_webhook_event(payload: entry['body'], headers: headers, secret: entry['secret'],
                                            now: entry['timestampSeconds'])
    assert_equal entry['payload'], received.to_payload
    assert_equal entry['isTest'], received.test?
  end
  each_case('webhook_round_trip', WEBHOOKS['roundTrips']) { |entry| entry['name'] }

  # ---- upload-tokens.json ----------------------------------------------------------------------

  UPLOAD_TOKENS = fixture('upload-tokens')

  def decode_token(token)
    body, signature = token.delete_prefix(UPLOAD_TOKENS['prefix']).split('.', 2)
    [JSON.parse("#{body.tr('-_', '+/')}#{'=' * (-body.size % 4)}".unpack1('m0')), body, signature]
  end

  def replay_token_signing(entry)
    signed = CalmLens::MockServerClient.sign_upload_token(entry['apiKey'], entry['options'], now: entry['now'], nonce: entry['nonce'])
    assert_equal entry['expected'].slice('token', 'expiresAt'), signed

    client = CalmLens::ServerClient.new(api_key: entry['apiKey'], project_id: 'project-1')
    before = (Time.now.to_f * 1000).to_i
    signed = client.upload_tokens.sign(entry['options'])
    lifetime = entry['expected']['expiresAt'] - entry['now']
    claims, body, signature = decode_token(signed['token'])
    assert_equal entry['expected']['claims'].merge('e' => signed['expiresAt'], 'n' => claims['n']), claims
    refute_equal entry['nonce'], claims['n']
    assert_operator signed['expiresAt'] - before, :>=, lifetime
    assert_operator signed['expiresAt'] - (Time.now.to_f * 1000).to_i, :<=, lifetime
    assert_equal OpenSSL::HMAC.hexdigest('SHA256', entry['expected']['signingSecret'], UPLOAD_TOKENS['signingContext'] + body),
                 signature
  end
  each_case('token_signing', UPLOAD_TOKENS['signing']) { |entry| entry['name'] }

  def replay_token_rejection(entry)
    client = CalmLens::ServerClient.new(api_key: entry['apiKey'], project_id: 'project-1')
    [-> { client.upload_tokens.sign(entry['options']) },
     -> { CalmLens::MockServerClient.sign_upload_token(entry['apiKey'], entry['options'], now: 0, nonce: 'n') }].each do |sign|
      assert_equal entry['error'], assert_raises(CalmLens::Error) { sign.call }.code, entry['name']
    end
  end
  each_case('token_rejection', UPLOAD_TOKENS['rejections']) { |entry| entry['name'] }

  # The SDK signs tokens but never decodes or verifies them: the server does.
  UPLOAD_TOKENS['verification'].each_with_index do |entry, index|
    define_method("test_token_verification_#{index + 1}") do
      skip "not applicable: the Ruby SDK signs upload tokens but does not decode them (#{entry['name']})"
    end
  end
end
