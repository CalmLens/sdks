# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'stringio'
require 'pp'

class ContractTest < Minitest::Test
  FIXTURES = File.expand_path('../testdata', __dir__)

  def fixtures(name) = JSON.parse(File.read("#{FIXTURES}/#{name}.json", encoding: 'UTF-8'))

  def invoke(client, operation, options)
    parts = operation.split('.')
    target = parts.size == 1 ? client : client.public_send(parts.first)
    target.public_send(parts.last.gsub(/([a-z])([A-Z])/, '\1_\2').downcase, options)
  end

  # Converts option names to snake_case symbols the way Ruby callers write them; metadata keys stay.
  def snake(value)
    case value
    when Hash
      value.to_h do |key, item|
        name = key.gsub(/([a-z])([A-Z])/, '\1_\2').downcase.to_sym
        [name, key == 'metadata' ? item : snake(item)]
      end
    when Array then value.map { |item| snake(item) }
    else value
    end
  end

  def capture(fixture)
    captured = nil
    transport = lambda do |request|
      uri = URI(request.url)
      body = request.body
      body = body.dup.force_encoding(Encoding::UTF_8) if body
      body = JSON.parse(body) if body && request.headers['Content-Type'] == 'application/json'
      captured = { 'method' => request.method, 'path' => uri.path, 'query' => URI.decode_www_form(uri.query || '').to_h,
                   'body' => body }
      assert_equal 'key', request.headers['X-Api-Key']
      CalmLens::Response.new(status: 200, body: JSON.generate(fixture['response']))
    end
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', transport: transport)
    yield client
    captured
  end

  def test_all_request_contracts_in_camel_and_snake_case
    fixtures('requests').each do |fixture|
      [fixture['options'], snake(fixture['options'])].each do |options|
        captured = capture(fixture) { |client| invoke(client, fixture['operation'], options) }
        assert_equal fixture['request'], captured, "#{fixture['operation']} #{options.inspect}"
      end
    end
  end

  # The mock answers each error code with this status, so a stale generated file would mislead tests.
  def test_generated_error_codes_match_the_shared_errors_fixture
    assert_equal fixtures('errors').to_h { |entry| [entry['code'], entry['status']] }, CalmLens::ErrorCodes::STATUSES
  end

  def test_path_safety_contracts
    paths = fixtures('paths')
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', transport: ->(request) { flunk "Sent #{request.url}" })
    paths['rejections'].each do |rejection|
      error = assert_raises(CalmLens::InvalidArgumentError) { invoke(client, rejection['operation'], rejection['options']) }
      assert_equal rejection['error'], error.code, rejection.inspect
    end
    paths['cdnUrls'].each do |cdn|
      [cdn['options'], snake(cdn['options'])].each do |options|
        if cdn['url']
          assert_equal cdn['url'], client.cdn.get_asset_url(options)
        else
          assert_equal cdn['error'], assert_raises(CalmLens::Error) { client.cdn.get_asset_url(options) }.code, options.inspect
        end
      end
    end
  end

  def test_inspect_redacts_the_api_key
    client = CalmLens::ServerClient.new(api_key: 'secret-api-key', project_id: 'project-1', transport: ->(_) { flunk })
    [client.inspect, client.assets.inspect, client.folders.inspect, client.cdn.inspect, client.pretty_inspect,
     client.assets.pretty_inspect, client.instance_variables.map { |name| client.instance_variable_get(name).inspect }.join].each do |text|
      refute_includes text, 'secret-api-key'
    end
  end

  def test_webhook_contracts
    webhooks = fixtures('webhooks')
    webhooks['parsing'].each do |entry|
      parsed = CalmLens.parse_webhook_event(payload: entry['body'], signature: entry['signature'],
                                            timestamp: entry['timestamp'], secret: entry['secret'], now: entry['now'])
      assert_equal JSON.parse(entry['body'])['data'], parsed.data
      assert_equal entry['expectedType'], parsed['type']
      assert_equal entry['expectedFactKey'], parsed['data']['facts'][0]['key']
    end

    webhooks['signatures'].each do |vector|
      assert_equal vector['signature'],
                   CalmLens.create_webhook_signature_header(payload: vector['body'], timestamp: vector['timestamp'],
                                                            secret: vector['secret'])
    end
    webhooks['verification'].each do |vector|
      valid = CalmLens.verify_webhook_signature(payload: vector['body'], signature: vector['signature'], timestamp: vector['timestamp'],
                                                secret: vector['secret'], now: vector['now'],
                                                tolerance_seconds: vector.fetch('toleranceSeconds', 300))
      assert_equal vector['valid'], valid, vector['name']
    end
    webhooks['payloads'].each do |entry|
      assert_equal entry['payload'], CalmLens.to_webhook_event_payload(entry['event'])
    end
    vector = webhooks['signatures'].first
    headers = CalmLens.create_webhook_headers(payload: vector['body'], delivery_id: 'delivery-1',
                                              secret: vector['secret'], timestamp: vector['timestamp'].to_i)
    assert_equal({ 'content-type' => 'application/json', CalmLens::WEBHOOK_DELIVERY_HEADER => 'delivery-1',
                   CalmLens::WEBHOOK_TIMESTAMP_HEADER => vector['timestamp'],
                   CalmLens::WEBHOOK_SIGNATURE_HEADER => vector['signature'] }, headers)
  end

  def test_parse_event_parses_every_payload_fixture
    fixtures('webhooks')['payloads'].each do |fixture|
      body = JSON.generate(fixture['payload'])
      signature = CalmLens.create_webhook_signature_header(payload: body, timestamp: 1_760_000_000, secret: 'whsec')
      event = CalmLens.parse_webhook_event(payload: body, signature: signature, timestamp: '1760000000', secret: 'whsec',
                                           now: 1_760_000_000)
      assert_equal fixture['event']['id'], event.id
      assert_equal fixture['event']['type'], event.type
      assert_equal fixture['event']['createdAt'], event.created_at
      assert_equal fixture['event']['facts'], event.facts
      assert_equal fixture['payload']['data'], event.data
      if fixture['event']['assetId']
        assert_equal fixture['event']['assetId'], event.asset_id
      else
        assert_nil event.asset_id
      end
    end
  end

  # Every transform option serializes to the step the CDN writes for it.
  def test_transform_options
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1')
    fixtures('transform-options')['cases'].each do |item|
      step = { 'type' => 'imageTransform', 'options' => item['options'] }
      url = client.cdn.get_asset_url(asset_identifier: 'asset-1', transform: step)
      assert_equal item['selector'], url.split('/rendered/', 2).last, item['options'].inspect
    end
  end
end
