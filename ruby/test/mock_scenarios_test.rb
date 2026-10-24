# frozen_string_literal: true

require 'json'
require 'minitest/autorun'
require 'calmlens/testing'

# Replays the shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts) against
# MockServerClient. The format is described in packages/sdk-contract/README.md.
class MockScenariosTest < Minitest::Test
  SCENARIOS = JSON.parse(File.read(File.expand_path('../testdata/mock-scenarios.json', __dir__), encoding: 'UTF-8'))

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
      { 'status' => response.status, 'code' => code, 'body' => body.dup.force_encoding('UTF-8') }
    when 'assets.waitForDecision'
      mock.assets.wait_for_decision(args.except('timeoutMs').merge('timeout' => args['timeoutMs'] / 1000.0))
    else
      options = args.except('idempotencyKey')
      options['request_options'] = { idempotency_key: args['idempotencyKey'] } if args.key?('idempotencyKey')
      resource, method = operation.split('.')
      mock.public_send(resource).public_send(method.gsub(/([a-z])([A-Z])/, '\1_\2').downcase, options)
    end
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
    assert_equal expect['cdn'], result.slice(*expect['cdn'].keys), label if expect['cdn']
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

  SCENARIOS.fetch('scenarios').each do |scenario|
    define_method("test_#{scenario['name'].downcase.gsub(/[^a-z0-9]+/, '_')}") do
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
  end
end
