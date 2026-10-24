# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require 'stringio'
require 'pp'

# Replays the shared SDK contract fixtures that packages/sdk-contract/generate.ts writes to testdata
# (format in packages/sdk-contract/README.md): requests captured from the JavaScript SDK (against the
# real client and the mock's queued responses), error codes, path safety and CDN URLs, webhooks,
# transform options, the mock behaviour scenarios, the server SDK surface and rejections. Each
# fixture case is its own test.
class ContractTest < Minitest::Test
  FIXTURES = File.expand_path('../testdata', __dir__)

  def self.fixture(name) = JSON.parse(File.read("#{FIXTURES}/#{name}.json", encoding: 'UTF-8'))

  # Defines one test per fixture case, named after the case and its position.
  def self.each_case(prefix, cases)
    cases.each_with_index do |item, index|
      label = yield(item).to_s.downcase.gsub(/[^a-z0-9]+/, '_').delete_prefix('_').delete_suffix('_')
      define_method("test_#{prefix}_#{index + 1}_#{label}") { replay(prefix, item) }
    end
  end

  def replay(prefix, item) = public_send("replay_#{prefix}", item)

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

  # requests.json, in camelCase and snake_case.
  def replay_request(fixture)
    [fixture['options'], snake(fixture['options'])].each do |options|
      captured = capture(fixture) { |client| invoke(client, fixture['operation'], options) }
      assert_equal fixture['request'], captured, "#{fixture['operation']} #{options.inspect}"
    end
  end
  each_case('request', fixture('requests')) { |fixture| fixture['operation'] }

  # requests.json against the mock: queued responses answer each request contract.
  def replay_mock_request(fixture)
    mock = CalmLens::MockServerClient.new.enqueue(body: fixture['response'])
    result = invoke(mock, fixture['operation'], fixture['options'])
    expected = case fixture['operation']
               when /\.delete\z/ then nil
               when 'ensureLenses' then fixture['response']['lenses']
               else fixture['response']
               end
    expected.nil? ? assert_nil(result) : assert_equal(expected, result, fixture['operation'])
    request = mock.requests.fetch(0)
    body = request.headers['Content-Type'] == 'application/json' ? request.json : request.body&.force_encoding('UTF-8')
    assert_equal fixture['request'].merge('path' => fixture['request']['path'].delete_prefix('/v1')),
                 { 'method' => request.method, 'path' => request.path, 'query' => request.query, 'body' => body },
                 fixture['operation']
    assert_equal 0, mock.remaining_responses
  end
  each_case('mock_request', fixture('requests')) { |fixture| fixture['operation'] }

  # The mock answers each error code with this status, so a stale generated file would mislead tests.
  def test_generated_error_codes_match_the_shared_errors_fixture
    assert_equal self.class.fixture('errors').to_h { |entry| [entry['code'], entry['status']] }, CalmLens::ErrorCodes::STATUSES
  end

  def refusing_client
    CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', transport: ->(request) { flunk "Sent #{request.url}" })
  end

  def replay_path_rejection(rejection)
    error = assert_raises(CalmLens::InvalidArgumentError) { invoke(refusing_client, rejection['operation'], rejection['options']) }
    assert_equal rejection['error'], error.code, rejection.inspect
  end
  each_case('path_rejection', fixture('paths')['rejections']) { |rejection| "#{rejection['operation']} #{rejection['options']}" }

  def replay_cdn_url(cdn)
    client = refusing_client
    [cdn['options'], snake(cdn['options'])].each do |options|
      if cdn['url']
        assert_equal cdn['url'], client.cdn.get_asset_url(options)
      else
        assert_equal cdn['error'], assert_raises(CalmLens::Error) { client.cdn.get_asset_url(options) }.code, options.inspect
      end
    end
  end
  each_case('cdn_url', fixture('paths')['cdnUrls']) { |cdn| JSON.generate(cdn['options']) }

  def test_inspect_redacts_the_api_key
    client = CalmLens::ServerClient.new(api_key: 'secret-api-key', project_id: 'project-1', transport: ->(_) { flunk })
    [client.inspect, client.assets.inspect, client.folders.inspect, client.cdn.inspect, client.pretty_inspect,
     client.assets.pretty_inspect, client.instance_variables.map { |name| client.instance_variable_get(name).inspect }.join].each do |text|
      refute_includes text, 'secret-api-key'
    end
  end

  WEBHOOKS = fixture('webhooks')

  def replay_webhook_parsing(entry)
    parsed = CalmLens.parse_webhook_event(payload: entry['body'], signature: entry['signature'],
                                          timestamp: entry['timestamp'], secret: entry['secret'], now: entry['now'])
    assert_equal JSON.parse(entry['body'])['data'], parsed.data
    assert_equal entry['expectedType'], parsed['type']
    assert_equal entry['expectedFactKey'], parsed['data']['facts'][0]['key']
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

  # parse_webhook_event parses every payload fixture into the event it came from.
  def replay_webhook_payload_parsing(fixture)
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
  each_case('webhook_payload_parsing', WEBHOOKS['payloads']) { |entry| "#{entry['event']['type']} #{entry['event']['id']}" }

  def test_webhook_headers_carry_the_first_signature_vector
    vector = WEBHOOKS['signatures'].first
    headers = CalmLens.create_webhook_headers(payload: vector['body'], delivery_id: 'delivery-1',
                                              secret: vector['secret'], timestamp: vector['timestamp'].to_i)
    assert_equal({ 'content-type' => 'application/json', CalmLens::WEBHOOK_DELIVERY_HEADER => 'delivery-1',
                   CalmLens::WEBHOOK_TIMESTAMP_HEADER => vector['timestamp'],
                   CalmLens::WEBHOOK_SIGNATURE_HEADER => vector['signature'] }, headers)
  end

  # Every transform option serializes to the step the CDN writes for it.
  def replay_transform(item)
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1')
    step = { 'type' => 'imageTransform', 'options' => item['options'] }
    url = client.cdn.get_asset_url(asset_identifier: 'asset-1', transform: step)
    assert_equal item['selector'], url.split('/rendered/', 2).last, item['options'].inspect
  end
  each_case('transform', fixture('transform-options')['cases']) { |item| item['selector'] }

  # The shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts), replayed by every
  # SDK's offline mock.
  # Follows a dotted path: numeric segments index arrays, `length` is an array's length.
  def at(value, path)
    path.split('.').reduce(value) do |current, segment|
      case current
      when Array then segment == 'length' ? current.size : current[Integer(segment, 10)]
      when Hash then current[segment]
      end
    end
  end

  def resolve(value, saved)
    if value.is_a?(Hash) && value.key?('$ref')
      name, rest = value['$ref'].split('.', 2)
      return at(saved.fetch(name), rest)
    end

    case value
    when Array then value.map { |item| resolve(item, saved) }
    when Hash then value.transform_values { |item| resolve(item, saved) }
    else value
    end
  end

  def run_step(mock, operation, args)
    case operation
    when 'mock.decide' then mock.decide(args['assetId'], args['outcome'])
    when 'mock.enqueueEvent' then mock.enqueue_event(args)
    when 'cdn.serve'
      response = mock.cdn.serve(args)
      body = response.body.to_s
      code = response.content_type == 'application/json' ? JSON.parse(body)['code'] : nil
      { 'status' => response.status, 'code' => code, 'body' => body.dup.force_encoding('UTF-8'),
        'headers' => response.headers }
    when 'assets.waitForDecision'
      mock.assets.wait_for_decision(args.except('timeoutMs').merge('timeout' => args['timeoutMs'] / 1000.0))
    else
      options = args.except('idempotencyKey')
      options['request_options'] = { idempotency_key: args['idempotencyKey'] } if args.key?('idempotencyKey')
      resource, method = operation.split('.')
      mock.public_send(resource).public_send(method.gsub(/([a-z])([A-Z])/, '\1_\2').downcase, options)
    end
  end

  # Header names are case-insensitive; Response#headers has lowercase names.
  def check_cdn(wanted, result, label)
    served = result.slice(*wanted.keys)
    served['headers'] = wanted['headers'].to_h { |name, _| [name, result['headers'][name.downcase]] } if wanted.key?('headers')
    assert_equal wanted, served, label
  end

  def check_step(mock, step, saved)
    label = "#{step['operation']} #{step['args'].inspect}"
    args = resolve(step.fetch('args', {}), saved)
    expect = step.fetch('expect', {})
    if (wanted = expect['error'])
      error = assert_raises(CalmLens::Error, label) { run_step(mock, step['operation'], args) }
      assert_equal wanted, { 'code' => error.code, 'status' => error.status }, label
      return
    end

    result = run_step(mock, step['operation'], args)
    check_cdn(expect['cdn'], result, label) if expect['cdn']
    if (name = expect['sameAs'])
      assert saved.key?(name), "#{label}: nothing saved as #{name}"
      assert_equal saved[name], result, "#{label}: same as #{name}"
    end
    expect.fetch('result', {}).each do |path, raw|
      if raw.is_a?(Hash) && raw.key?('$contains')
        assert_includes at(result, path), resolve(raw['$contains'], saved), "#{label}: #{path}"
      else
        wanted = resolve(raw, saved)
        wanted.nil? ? assert_nil(at(result, path), "#{label}: #{path}") : assert_equal(wanted, at(result, path), "#{label}: #{path}")
      end
    end
    saved[step['save']] = result if step['save']
  end

  def replay_mock_scenario(scenario)
    options = scenario['mock']
    mock = CalmLens::MockServerClient.new(
      api_key: CalmLens::MockServerClient.create_api_key(options.fetch('apiKeyGrants', [])),
      queued_outcome: options.fetch('queuedOutcome', 'pending'),
      analyzed_outcome: options.fetch('analyzedOutcome', 'allowed')
    )
    saved = {}
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    scenario['steps'].each { |step| check_step(mock, step, saved) }
    # Mock waits take no real time.
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 5
  end
  each_case('mock_scenario', fixture('mock-scenarios').fetch('scenarios')) { |scenario| scenario['name'] }

  # surface.json (packages/sdk-contract/surface.ts): every capability a server SDK must offer exists
  # under its Ruby name.
  SURFACE = fixture('surface')

  def client(transport = ->(request) { flunk "Sent #{request.url}" })
    CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', max_retries: 0, transport: transport)
  end

  def snake_name(name) = name.gsub(/([a-z])([A-Z])/, '\1_\2').downcase

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
    failing.public_send(resource).public_send(snake_name(method), spec['options'])
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

  def replay_surface(capability)
    assert present?(capability, SURFACE), "missing #{capability['id']} (#{capability['names']['ruby']})"
  end
  each_case('surface', SURFACE['capabilities']) { |capability| capability['id'] }

  # rejections.json: every request the API would reject is refused before anything is sent.
  def replay_rejection(rejection)
    resource, method = rejection['operation'].split('.')
    error = assert_raises(CalmLens::Error, rejection['name']) do
      client.public_send(resource).public_send(snake_name(method), rejection['options'])
    end
    assert_equal rejection['error'], error.code, rejection['name']
  end
  each_case('rejection', fixture('rejections')) { |rejection| rejection['name'] }
end
