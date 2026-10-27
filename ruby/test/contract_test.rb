# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require_relative 'contract_fixtures'
require 'pp'
require 'rbs'
require 'stringio'

# Replays the shared SDK contract fixtures that packages/sdk-contract/generate.ts writes to testdata
# (format in packages/sdk-contract/README.md): transform options, the mock behaviour scenarios, the
# server SDK surface (its capabilities, errorResponse and retryable errors) and rejections.
# contract_client_test.rb replays the real client's fixtures and contract_webhooks_test.rb the
# webhook and upload token ones; each fixture is replayed in one of them, read through
# ContractFixtures. Each fixture case is its own test.
class ContractTest < Minitest::Test
  extend ContractFixtures

  # Defines one test per fixture case, named after the case and its position.
  def self.each_case(prefix, cases)
    cases.each_with_index do |item, index|
      label = yield(item).to_s.downcase.gsub(/[^a-z0-9]+/, '_').delete_prefix('_').delete_suffix('_')
      define_method("test_#{prefix}_#{index + 1}_#{label}") { replay(prefix, item) }
    end
  end

  def replay(prefix, item) = public_send("replay_#{prefix}", item)

  def test_inspect_redacts_the_api_key
    client = CalmLens::ServerClient.new(api_key: 'secret-api-key', project_id: 'project-1', transport: ->(_) { flunk })
    [client.inspect, client.assets.inspect, client.folders.inspect, client.cdn.inspect, client.pretty_inspect,
     client.assets.pretty_inspect, client.instance_variables.map { |name| client.instance_variable_get(name).inspect }.join].each do |text|
      refute_includes text, 'secret-api-key'
    end
  end

  TRANSFORM_OPTIONS = fixture('transform-options')

  # Every transform option serializes to the step the CDN writes for it.
  def replay_transform(item)
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1')
    step = { 'type' => 'imageTransform', 'options' => item['options'] }
    url = client.cdn.get_asset_url(asset_identifier: 'asset-1', transform: step)
    assert_equal item['selector'], url.split('/rendered/', 2).last, item['options'].inspect
  end
  each_case('transform', TRANSFORM_OPTIONS['cases']) { |item| item['selector'] }

  # The option names the signatures accept, and the options written as colours, are the schema's.
  def test_transform_options_and_colour_keys_follow_the_schema
    loader = RBS::EnvironmentLoader.new
    loader.add(path: Pathname(File.expand_path('../sig', __dir__)))
    env = RBS::Environment.from_loader(loader).resolve_type_names
    options = env.type_alias_decls.fetch(RBS::TypeName.parse('::CalmLens::image_transform_options_input')).decl.type
    assert_equal TRANSFORM_OPTIONS['options'].sort, options.fields.keys.map(&:to_s).concat(options.optional_fields.keys.map(&:to_s)).sort
    assert_equal TRANSFORM_OPTIONS['colourKeys'], CalmLens.const_get(:Transforms)::COLOUR_KEYS
    used = TRANSFORM_OPTIONS['cases'].flat_map { |item| item['options'].keys }.uniq
    assert_empty TRANSFORM_OPTIONS['options'] - used, 'every option has a serialization case'
  end

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

  # Resolves the `$ref`, `$concat` and `$base64Repeat` markers.
  def resolve(value, saved)
    if value.is_a?(Hash) && value.key?('$ref')
      name, rest = value['$ref'].split('.', 2)
      return rest ? at(saved.fetch(name), rest) : saved.fetch(name)
    end
    return value['$concat'].map { |part| resolve(part, saved).to_s }.join if value.is_a?(Hash) && value.key?('$concat')
    return [value['$base64Repeat']['text'] * value['$base64Repeat']['count']].pack('m0') if value.is_a?(Hash) && value.key?('$base64Repeat')

    case value
    when Array then value.map { |item| resolve(item, saved) }
    when Hash then value.transform_values { |item| resolve(item, saved) }
    else value
    end
  end

  def json(value) = JSON.parse(JSON.generate(value))

  def run_step(mock, operation, args)
    case operation
    when 'mock.decide' then mock.decide(args['assetId'], args['outcome'])
    when 'mock.enqueueEvent' then mock.enqueue_event(args)
    when 'mock.grant' then mock.api_key_grants = args['grants']
    when 'mock.failNext' then mock.fail_next_request(args['failure'], operation: args['operation'])
    when 'cdn.serve'
      response = mock.cdn.serve(args)
      body = response.body.to_s
      code = response.content_type.to_s.start_with?('application/json') ? JSON.parse(body)['code'] : nil
      { 'status' => response.status, 'code' => code, 'bytes' => body, 'headers' => response.headers }
    when 'assets.iterate' then json(mock.assets.each(args).to_a)
    when 'assets.iterateChildren' then json(mock.assets.each_child(args).to_a)
    when 'events.pages' then json(mock.events.each_page(args).to_a)
    when 'assets.waitForDecision'
      json(mock.assets.wait_for_decision(args.except('timeoutMs').merge('timeout' => args['timeoutMs'] / 1000.0)))
    else
      options = args.except('idempotencyKey')
      options['request_options'] = { idempotency_key: args['idempotencyKey'] } if args.key?('idempotencyKey')
      *resources, method = operation.split('.')
      target = resources.reduce(mock) { |value, resource| value.public_send(snake_name(resource)) }
      json(target.public_send(snake_name(method), options))
    end
  end

  # Header names are case-insensitive; Response#headers has lowercase names.
  def check_cdn(wanted, result, label)
    served = { 'status' => result['status'] }
    served['code'] = result['code'] if wanted.key?('code')
    served['body'] = result['bytes'].dup.force_encoding('UTF-8') if wanted.key?('body')
    served['headers'] = wanted['headers'].to_h { |name, _| [name, result['headers'][name.downcase]] } if wanted.key?('headers')
    assert_equal wanted.slice('status', 'code', 'body', 'headers'), served, label
    wanted.fetch('headersPresent', []).each { |name| assert result['headers'].key?(name.downcase), "#{label}: #{name} header" }
    return unless wanted.key?('bodyPrefixBase64')

    prefix = wanted['bodyPrefixBase64'].unpack1('m0')
    assert_equal prefix, result['bytes'].b[0, prefix.bytesize], "#{label}: body prefix"
  end

  def check_error(wanted, error, saved, label)
    assert_equal wanted.slice('code', 'status'), { 'code' => error.code, 'status' => error.status }, label
    wanted.fetch('details', {}).each do |key, value|
      expected = resolve(value, saved)
      actual = error.details&.fetch(key, nil)
      expected.nil? ? assert_nil(actual, "#{label}: details.#{key}") : assert_equal(expected, actual, "#{label}: details.#{key}")
    end
  end

  # Records the status of each response the mock's in-memory API answers, to check a step's final one.
  def record_statuses(mock)
    statuses = []
    mock.instance_variable_get(:@fake).singleton_class.prepend(Module.new do
      define_method(:handle) { |*args| super(*args).tap { |response| statuses << response.status } }
    end)
    statuses
  end

  def check_step(mock, step, saved, label, statuses)
    args = resolve(step.fetch('args', {}), saved)
    expect = step.fetch('expect', {})
    if (wanted = expect['error'])
      error = assert_raises(CalmLens::Error, label) { run_step(mock, step['operation'], args) }
      return check_error(wanted, error, saved, label)
    end

    statuses.clear
    result = run_step(mock, step['operation'], args)
    assert_equal [expect['httpStatus']], statuses.last(1), "#{label}: final response status" if expect['httpStatus']
    check_cdn(resolve(expect['cdn'], saved), result, label) if expect['cdn']
    if (name = expect['sameAs'])
      assert saved.key?(name), "#{label}: nothing saved as #{name}"
      assert_equal saved[name], result, "#{label}: same as #{name}"
    end
    expect.fetch('result', {}).each do |path, raw|
      if raw.is_a?(Hash) && raw.key?('$contains')
        assert_includes at(result, path), resolve(raw['$contains'], saved), "#{label}: #{path}"
      elsif raw.is_a?(Hash) && raw.key?('$id')
        assert_match(/\A#{raw['$id']}_[0-9A-Za-z]{20}\z/, at(result, path), "#{label}: #{path}")
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
    statuses = record_statuses(mock)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    scenario['steps'].each_with_index do |step, index|
      step.fetch('repeat', 1).times do |run|
        check_step(mock, step, saved, "step #{index + 1}#{" run #{run + 1}" if step['repeat']} (#{step['operation']})", statuses)
      end
    end
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
    failing.public_send(snake_name(resource)).public_send(snake_name(method), spec['options'])
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
      receiver, method = name.split(/\.(?=[a-z_]+\??\z)/)
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

  # Whether an error is retryable follows from its code and status alone, whichever class carries it.
  def replay_retryable(entry)
    label = "#{entry['code']} #{entry['status'].inspect}"
    [CalmLens::Error.build(entry['code'], status: entry['status']),
     CalmLens::Error.new(entry['code'], status: entry['status'])].each do |error|
      assert_equal entry['retryable'], error.retryable?, "#{error.class} #{label}"
    end
  end
  each_case('retryable', SURFACE['retryable']) { |entry| "#{entry['code']} #{entry['status']}" }

  def replay_surface(capability)
    reason = capability.dig('notApplicable', 'ruby')
    skip "not applicable: #{reason}" if reason

    assert present?(capability, SURFACE), "missing #{capability['id']} (#{capability['names']['ruby']})"
  end
  each_case('surface', SURFACE['capabilities']) { |capability| capability['id'] }

  # rejections.json: every request the API would reject is refused before anything is sent.
  def replay_rejection(rejection)
    resource, method = rejection['operation'].split('.')
    error = assert_raises(CalmLens::Error, rejection['name']) do
      client.public_send(snake_name(resource)).public_send(snake_name(method), rejection['options'])
    end
    assert_equal rejection['error'], error.code, rejection['name']
  end
  each_case('rejection', fixture('rejections')) { |rejection| rejection['name'] }
end
