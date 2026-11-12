# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require_relative 'contract_fixtures'
require_relative 'operation_call'
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
  include OperationCall

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

  # Every transform option serializes to the selector the CDN writes for it.
  def replay_transform(item)
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1')
    url = client.cdn.get_asset_url(asset_id: 'asset-1', resource: 'rendered', transform: item['options'])
    assert_equal item['selector'], url.split('/rendered/', 2).last, item['options'].inspect
  end
  each_case('transform', TRANSFORM_OPTIONS['cases']) { |item| item['selector'] }

  # Options the CDN refuses are refused before any URL is built, naming every refused key.
  def replay_invalid_transform(item)
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', transport: ->(_) { flunk 'sent a request' })
    error = assert_raises(CalmLens::InvalidArgumentError, item['options'].inspect) do
      client.cdn.get_asset_url(asset_id: 'asset-1', resource: 'rendered', transform: item['options'])
    end
    assert_equal 'sdk/invalid-argument', error.code
    assert_equal item.slice('unknownKeys', 'invalidKeys'), error.details
    (item['unknownKeys'] + item['invalidKeys']).each { |key| assert_includes error.message, key }
  end
  each_case('invalid_transform', TRANSFORM_OPTIONS['invalid']) { |item| JSON.generate(item['options']) }

  # upload-mime-types.json: an upload of a type the API refuses is refused before it is sent.
  def replay_refused_upload_type(type)
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', transport: ->(_) { flunk 'sent a request' })
    error = assert_raises(CalmLens::Error, type) do
      client.assets.create(name: 'x', content: { base64: 'aGVsbG8=', type: type })
    end
    assert_equal ['upload/unsupported-type', { 'mimeType' => type, 'source' => 'calmlens' }], [error.code, error.details]
  end
  each_case('refused_upload_type', fixture('upload-mime-types')['refused']) { |type| type }

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

  # Builds a decision spec with the decision builder, in the order the fixture lists its calls.
  def build_decision(spec)
    return CalmLens::MockDecision.of(spec) if spec.is_a?(String)

    decision = CalmLens::MockDecision.of(spec['status'])
    spec.fetch('flags', []).each { |flag| decision.flag(flag['category'], flag['score'], flag.fetch('qualifiers', {})) }
    spec.fetch('notEvaluated', []).each { |category| decision.not_evaluated(category) }
    review = spec['pendingReview']
    decision.pending_review(review['reason'], review.fetch('uncertainCategories', [])) if review
    decision
  end

  # A `moderate` callback that records what it receives in `calls` and answers by name, then by
  # queue mode for uploads, else like the mock's default.
  def recording_moderate(spec, calls)
    lambda do |input|
      asset = input.asset
      calls << { 'trigger' => input.trigger, 'queued' => input.queued, 'assetId' => asset['id'], 'name' => asset['name'],
                 'text' => input.content.text, 'bytesBase64' => input.content.bytes && [input.content.bytes].pack('m0') }
      answer = spec.fetch('byName', {})[asset['name']]
      answer ||= spec[input.queued ? 'queued' : 'analyzed'] if input.trigger == 'upload'
      next build_decision(answer) unless answer.nil?

      input.queued && input.trigger != 'complete' ? 'pending' : 'allowed'
    end
  end

  # The `mock.*` helper steps.
  def run_mock_step(mock, operation, args, moderate_calls)
    case operation
    when 'mock.decide' then json(mock.decide(args['assetId'], args['outcome']))
    when 'mock.completeProcessing'
      json(mock.complete_processing(args['assetId'], args.key?('decision') ? build_decision(args['decision']) : nil))
    when 'mock.moderateCalls' then moderate_calls
    when 'mock.buildDecision' then build_decision(args) && nil
    when 'mock.requests' then mock.requests.map { |request| request.to_h.slice(:method, :path, :query, :status).transform_keys(&:to_s) }
    when 'mock.clearRequests' then mock.clear_requests && nil
    when 'mock.enqueueEvent' then json(mock.enqueue_event(args))
    when 'mock.grant' then mock.api_key_grants = args['grants']
    when 'mock.fetchCdn' then served(mock.fetch_cdn(args['url']))
    when 'mock.failNext'
      mock.fail_next_request(args['failure'], operation: args['operation'], details: args['details'], retry_after: args['retryAfter'])
    else flunk "Unknown mock step #{operation}"
    end
  end

  def run_step(mock, operation, args, moderate_calls)
    return run_mock_step(mock, operation, args, moderate_calls) if operation.start_with?('mock.')

    case operation
    when 'cdn.serve' then served(call_operation(mock, operation, args))
    when 'cdn.getAssetInfo' then json(mock.cdn.get_asset_info(args['url'], viewer_claims: args['viewerClaims']))
    when 'events.pages' then json(call_operation(mock, 'events.list', args).each_page.to_a)
    when *ITERATORS.keys then json(call_operation(mock, list_operation(operation), args).auto_paging_each.to_a)
    when 'assets.waitForDecision'
      json(call_operation(mock, operation, args.except('timeoutMs').merge('timeout' => args['timeoutMs'] / 1000.0)))
    else json(call_operation(mock, operation, args))
    end
  end

  # What a cdn.serve or mock.fetchCdn step returns.
  def served(response)
    body = response.body.to_s
    code = response.content_type.to_s.start_with?('application/json') ? JSON.parse(body)['code'] : nil
    { 'status' => response.status, 'code' => code, 'bytes' => body, 'headers' => response.headers }
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
    ERROR_KINDS.fetch(wanted['kind']).each { |kind| assert_kind_of kind, error, "#{label} is #{wanted['kind']}" } if wanted.key?('kind')
    assert_equal wanted['retryAfter'], error.retry_after, "#{label}: retryAfter" if wanted.key?('retryAfter')
    # `details` lists only the keys to compare, and objects in them (such as each of a validation
    # error's `issues`) only the fields to compare.
    wanted.fetch('details', {}).each do |key, value|
      expected = resolve(value, saved)
      actual = error.details&.fetch(key, nil)
      if expected.nil?
        assert_nil(actual, "#{label}: details.#{key}")
      else
        assert_equal(expected, listed_fields(expected, actual), "#{label}: details.#{key}")
      end
    end
  end

  # `actual` with each Hash in it narrowed to the keys `expected` lists, so comparing the two
  # checks only those fields; Arrays keep their length and order.
  def listed_fields(expected, actual)
    case expected
    when Hash then actual.is_a?(Hash) ? expected.to_h { |key, value| [key, listed_fields(value, actual[key])] } : actual
    when Array then actual.is_a?(Array) ? actual.each_with_index.map { |item, index| listed_fields(expected[index], item) } : actual
    else actual
    end
  end

  # The URL's query parameters, each read as JSON, equal `params`.
  def check_query_json(url, params, label)
    query = URI.decode_www_form(URI.parse(url).query.to_s).to_h
    params.each do |name, value|
      assert query.key?(name), "#{label} ?#{name}"
      assert_equal value, JSON.parse(query[name]), "#{label} ?#{name}"
    end
  end

  def check_step(mock, step, saved, label, moderate_calls)
    args = resolve(step.fetch('args', {}), saved)
    expect = step.fetch('expect', {})
    if (wanted = expect['error'])
      error = assert_raises(CalmLens::Error, label) { run_step(mock, step['operation'], args, moderate_calls) }
      return check_error(wanted, error, saved, label)
    end

    sent = mock.requests.size
    result = run_step(mock, step['operation'], args, moderate_calls)
    # The status of the last response the in-memory API sent during the step, so retries and polls
    # are judged by their final attempt.
    if expect['httpStatus']
      assert_equal [expect['httpStatus']], mock.requests.drop(sent).last(1).map(&:status), "#{label}: final response status"
    end
    check_cdn(resolve(expect['cdn'], saved), result, label) if expect['cdn']
    if (name = expect['sameAs'])
      assert saved.key?(name), "#{label}: nothing saved as #{name}"
      assert_equal saved[name], result, "#{label}: same as #{name}"
    end
    expect.fetch('result', {}).each do |path, raw|
      if raw.is_a?(Hash) && raw.key?('$contains')
        assert_includes at(result, path), resolve(raw['$contains'], saved), "#{label}: #{path}"
      elsif raw.is_a?(Hash) && raw.key?('$queryJson')
        check_query_json(at(result, path), raw['$queryJson'], "#{label}: #{path}")
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
    moderate_calls = []
    settings = { api_key: CalmLens::MockServerClient.create_api_key(options.fetch('apiKeyGrants', [])) }
    settings[:project_id] = 'project-1' unless options['defaultProject']
    settings[:max_retries] = options['maxRetries'] if options.key?('maxRetries')
    settings[:part_size_bytes] = options['partSizeBytes'] if options.key?('partSizeBytes')
    settings[:moderate] = recording_moderate(options['moderate'], moderate_calls) if options.key?('moderate')
    mock = CalmLens::MockServerClient.new(**settings)
    saved = {}
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    scenario['steps'].each_with_index do |step, index|
      step.fetch('repeat', 1).times do |run|
        check_step(mock, step, saved, "step #{index + 1}#{" run #{run + 1}" if step['repeat']} (#{step['operation']})", moderate_calls)
      end
    end
    # Mock waits take no real time.
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 5
  end
  each_case('mock_scenario', fixture('mock-scenarios').fetch('scenarios')) { |scenario| scenario['name'] }

  # surface.json (packages/sdk-contract/surface.ts): every capability a server SDK must offer exists
  # under its Ruby name.
  SURFACE = fixture('surface')
  ITERATORS = iterators

  def client(transport = ->(request) { flunk "Sent #{request.url}" })
    CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', max_retries: 0, transport: transport)
  end

  def constant(name)
    Object.const_get(name)
  rescue NameError
    nil
  end

  def raised_error(spec)
    failing = client(lambda do |_request|
      CalmLens::Response.new(status: spec['status'], headers: spec['headers'], body: JSON.generate(spec['body']))
    end)
    call_operation(failing, spec['operation'], spec['options'])
    flunk "#{spec['operation']} did not fail"
  rescue CalmLens::Error => e
    e
  end

  # The status an option gives an upload: `moderate` answering `blocked`.
  def mock_outcome(option)
    mock = CalmLens::MockServerClient.new(option.to_sym => ->(_input) { 'blocked' })
    asset = mock.assets.classify(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' })
    asset.classification.moderation.decision
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
      client.cdn.get_asset_url(asset_id: 'asset-1', resource: name).end_with?("/asset-1/#{capability['path']}")
    when 'cdn-option' then cdn_option?(name)
    when 'mock-client' then constant(name).is_a?(Class)
    when 'mock-method' then CalmLens::MockServerClient.method_defined?(name)
    when 'mock-option' then mock_outcome(name) == 'blocked'
    else flunk "Unknown capability kind #{capability['kind']}"
    end
  end

  # Each CDN option is checked by the URL it builds.
  def cdn_option?(name)
    case name
    when 'viewer_claims'
      client.cdn.get_asset_url(asset_id: 'asset-1', viewer_claims: { age_confirmed: true })
            .end_with?('/asset-1?viewerClaims=%7B%22ageConfirmed%22%3Atrue%7D')
    when 'external_id' then client.cdn.get_asset_url(external_id: 'post/1').end_with?('/ext:post%2F1')
    else flunk "No check for CDN option #{name}"
    end
  end

  # Whether an error is retryable follows from its code and status alone, whichever class carries it.
  def replay_retryable(entry)
    label = "#{entry['code']} #{entry['status'].inspect}"
    [CalmLens::Error.build(entry['code'], status: entry['status']),
     CalmLens::Error.new(entry['code'], status: entry['status'])].each do |error|
      assert_equal entry['retryable'], error.retryable?, "#{error.class} #{label}"
      assert_equal entry['local'], error.local?, "#{error.class} #{label}"
    end
    built = CalmLens::Error.build(entry['code'], status: entry['status'])
    ERROR_KINDS.fetch(entry['kind']).each { |kind| assert_kind_of kind, built, "#{label} is #{entry['kind']}" }
  end
  each_case('retryable', SURFACE['retryable']) { |entry| "#{entry['code']} #{entry['status']}" }

  def replay_surface(capability)
    reason = capability.dig('notApplicable', 'ruby')
    skip "not applicable: #{reason}" if reason

    assert present?(capability, SURFACE), "missing #{capability['id']} (#{capability['names']['ruby']})"
  end
  each_case('surface', SURFACE['capabilities']) { |capability| capability['id'] }

  # Public methods of the client and its resources that are plumbing, not API capabilities.
  PLUMBING = {
    'close' => 'closes the pooled connections',
    'inspect' => 'shows the client without its API key',
    'pretty_print' => 'shows the client without its API key in pp',
    'project_id' => 'the project the client was made for',
    'base_url' => 'the API base URL the client was made with',
    'cdn_base_url' => 'the CDN base URL the client was made with'
  }.freeze

  # The public methods a class defines itself and inherits from CalmLens classes, not Object's.
  def own_methods(object)
    object.class.ancestors.take_while { |ancestor| ancestor != CalmLens::Resource && ancestor != Object }
          .flat_map { |ancestor| ancestor.public_instance_methods(false) }.uniq.map(&:to_s)
  end

  # Every public method of the client and its resources is a `method` capability or plumbing, so a
  # method the API dropped can't stay.
  def test_every_public_client_method_is_a_capability_or_plumbing
    named = SURFACE['capabilities'].select { |capability| capability['kind'] == 'method' }.map { |capability| capability['names']['ruby'] }
    methods = own_methods(client)
    resources = methods.select { |name| client.method(name).arity.zero? && client.public_send(name).is_a?(CalmLens::Resource) }
    listed = (methods - resources) + resources.flat_map do |resource|
      own_methods(client.public_send(resource)).map do |name|
        "#{resource}.#{name}"
      end
    end
    assert_empty listed - named - PLUMBING.keys, 'public methods no capability names'
    assert_empty PLUMBING.keys - listed, 'plumbing the client no longer has'
  end

  ERROR_KINDS = error_kind_classes

  # Every error kind has its class, a subclass of its parent kind's.
  def test_every_error_kind_has_its_class_under_its_parents
    SURFACE['errorKinds'].each do |kind|
      klass, *ancestors = ERROR_KINDS.fetch(kind['id'])
      assert_operator klass, :<=, CalmLens::Error, kind['id']
      ancestors.each { |ancestor| assert_operator klass, :<, ancestor, kind['id'] }
    end
  end

  # The categories and qualifiers the decision builder accepts are the API's.
  def test_mock_classification_matches_the_surface
    assert_equal SURFACE['classification']['categories'], CalmLens::MockClassification::CATEGORIES
    assert_equal SURFACE['classification']['qualifiers'], CalmLens::MockClassification::QUALIFIERS
  end

  # rejections.json: every request the API would reject is refused before anything is sent.
  def replay_rejection(rejection)
    error = assert_raises(CalmLens::Error, rejection['name']) { call_operation(client, rejection['operation'], rejection['options']) }
    assert_equal rejection['error'], error.code, rejection['name']
    ERROR_KINDS.fetch(rejection['kind']).each { |kind| assert_kind_of kind, error, "#{rejection['name']} is #{rejection['kind']}" }
    assert error.local?, rejection['name']
    assert_nil error.status, rejection['name']
    assert_nil error.request_id, rejection['name']
  end
  each_case('rejection', fixture('rejections')) { |rejection| rejection['name'] }
end
