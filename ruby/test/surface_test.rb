# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'

# Replays testdata/surface.json and testdata/rejections.json (packages/sdk-contract/surface.ts):
# every capability a server SDK must offer exists under its Ruby name, and every request the API
# would reject is refused before anything is sent.
class SurfaceTest < Minitest::Test
  FIXTURES = File.expand_path('../testdata', __dir__)

  def fixtures(name) = JSON.parse(File.read("#{FIXTURES}/#{name}.json", encoding: 'UTF-8'))

  def client(transport = ->(request) { flunk "Sent #{request.url}" })
    CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', max_retries: 0, transport: transport)
  end

  def snake(name) = name.gsub(/([a-z])([A-Z])/, '\1_\2').downcase

  def constant(name)
    Object.const_get(name)
  rescue NameError
    nil
  end

  def raised_error(spec)
    failing = client(lambda do |_request|
      CalmLens::Response.new(status: spec['status'], headers: spec['headers'], body: JSON.generate(spec['body']))
    end)
    resource, method = spec['operation'].split('.')
    failing.public_send(resource).public_send(snake(method), spec['options'])
    flunk "#{spec['operation']} did not fail"
  rescue CalmLens::Error => e
    e
  end

  def mock_outcome(option)
    mock = CalmLens::MockServerClient.new(option.to_sym => 'blocked')
    content = { name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' } }
    asset = option == 'queued_outcome' ? mock.assets.create(content) : mock.assets.classify(content)
    asset.dig('classification', 'moderation', 'status')
  end

  def present?(capability, surface)
    name = capability['names']['ruby']
    case capability['kind']
    when 'method'
      *resources, method = name.split('.')
      target = resources.reduce(client) { |value, resource| value.public_send(resource) }
      target.respond_to?(method)
    when 'function', 'mock-function'
      receiver, method = name.split(/\.(?=[a-z_]+\z)/)
      constant(receiver)&.respond_to?(method)
    when 'constant' then constant(name) == capability['value']
    when 'error-field'
      spec = surface['errorResponse']
      expected = spec['expected']
      want = { 'errors.code' => expected['code'], 'errors.status' => expected['status'],
               'errors.requestId' => expected['requestId'],
               'errors.retryAfter' => expected['retryAfterSeconds'] }.fetch(capability['id'])
      error = raised_error(spec)
      error.respond_to?(name) && error.public_send(name) == want
    when 'cdn-resource'
      client.cdn.get_asset_url(asset_identifier: 'asset-1', resource: name).end_with?("/asset-1/#{capability['value']}")
    when 'cdn-option'
      client.cdn.get_asset_url(asset_identifier: 'asset-1', name.to_sym => true).end_with?('?allowAgeRestricted=true')
    when 'mock-client' then constant(name).is_a?(Class)
    when 'mock-method' then CalmLens::MockServerClient.method_defined?(name)
    when 'mock-option' then mock_outcome(name) == 'blocked'
    else flunk "Unknown capability kind #{capability['kind']}"
    end
  end

  def test_offers_every_capability
    surface = fixtures('surface')
    missing = surface['capabilities'].reject { |capability| present?(capability, surface) }
    assert_empty(missing.map { |capability| "#{capability['id']} (#{capability['names']['ruby']})" })
  end

  def test_refuses_rejected_requests_before_sending
    fixtures('rejections').each do |rejection|
      resource, method = rejection['operation'].split('.')
      error = assert_raises(CalmLens::Error, rejection['name']) do
        client.public_send(resource).public_send(snake(method), rejection['options'])
      end
      assert_equal rejection['error'], error.code, rejection['name']
    end
  end
end
