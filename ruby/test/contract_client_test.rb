# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'digest'
require 'json'
require 'net/http'
require 'stringio'
require_relative 'contract_fixtures'

# Replays the shared fixtures that check the real client's requests and results, written by
# packages/sdk-contract (format in its README.md) to testdata: requests.json, paths.json,
# errors.json, client-cases.json and surface.json's defaults. Each fixture case is its own test.
class ContractClientTest < Minitest::Test
  extend ContractFixtures

  # Defines one test per fixture case, named after the case and its position.
  def self.each_case(prefix, cases)
    cases.each_with_index do |item, index|
      label = yield(item).to_s.downcase.gsub(/[^a-z0-9]+/, '_').delete_prefix('_').delete_suffix('_')
      define_method("test_#{prefix}_#{index + 1}_#{label}") { public_send("replay_#{prefix}", item) }
    end
  end

  SURFACE = fixture('surface')
  CLIENT_CASES = fixture('client-cases')
  NOT_APPLICABLE = SURFACE['capabilities'].to_h { |capability| [capability['id'], capability.dig('notApplicable', 'ruby')] }

  # Raised by {#invoke} when an iterator fails, carrying what it yielded first.
  class IterationFailed < StandardError
    attr_reader :partial, :error

    def initialize(partial, error)
      super(error.message)
      @partial = partial
      @error = error
    end
  end

  # A one-shot stream: it can be read once, and has no size, position or rewind.
  class OneShot
    def initialize(bytes)
      @io = StringIO.new(bytes)
    end

    def read(*args) = @io.read(*args)
  end

  def snake_name(name) = name.gsub(/([a-z])([A-Z])/, '\1_\2').downcase

  def collect
    items = []
    yield items
    items
  rescue CalmLens::Error => e
    raise IterationFailed.new(items, e)
  end

  # Calls an operation named like the JavaScript client's method, with JavaScript option names.
  def invoke(client, operation, args)
    case operation
    when 'assets.iterate' then collect { |items| client.assets.each(args) { |asset| items << asset } }
    when 'assets.iterateChildren' then collect { |items| client.assets.each_child(args) { |asset| items << asset } }
    when 'events.iterate' then collect { |pages| client.events.each_page(args) { |page| pages << page } }
    else
      *resources, method = operation.split('.')
      target = resources.reduce(client) { |value, resource| value.public_send(snake_name(resource)) }
      target.public_send(snake_name(method), args)
    end
  end

  # Translates JavaScript-only options: the Idempotency-Key and waitForDecision's milliseconds.
  def ruby_args(operation, args)
    return args unless args.is_a?(Hash)

    args = args.dup
    args['request_options'] = { 'idempotency_key' => args.delete('idempotencyKey') } if args.key?('idempotencyKey')
    args['timeout'] = args.delete('timeoutMs') / 1000.0 if operation == 'assets.waitForDecision' && args.key?('timeoutMs')
    args
  end

  # Decodes the `$bytes`, `$stream` and `$fill` markers; the byte inputs are Ruby's `data`.
  def decode(value)
    case value
    when Array then value.map { |item| decode(item) }
    when Hash
      return value['$bytes'].unpack1('m0') if value.key?('$bytes')
      return OneShot.new(value['$stream'].unpack1('m0')) if value.key?('$stream')
      return (value.dig('$fill', 'byte').chr * value.dig('$fill', 'length')).b if value.key?('$fill')

      value.to_h { |key, item| [%w[uint8Array buffer].include?(key) ? 'data' : key, decode(item)] }
    else value
    end
  end

  def error_fields(error)
    assert_kind_of CalmLens::Error, error
    { 'code' => error.code, 'status' => error.status, 'requestId' => error.request_id,
      'retryAfter' => error.retry_after, 'details' => error.details && JSON.parse(JSON.generate(error.details)) }
  end

  def failure(&)
    yield
    flunk 'the call succeeded'
  rescue CalmLens::Error => e
    e
  end

  def json(value) = JSON.parse(JSON.generate(value))

  # Compares JSON values, null included.
  def assert_json(expected, actual, message)
    expected.nil? ? assert_nil(actual, message) : assert_equal(expected, actual, message)
  end

  # ---- requests.json ---------------------------------------------------------------------------

  # Captures the one request a call sends and answers it with the fixture's response.
  def capture(fixture)
    captured = []
    transport = lambda do |request|
      uri = URI(request.url)
      body = request.body&.dup&.force_encoding(Encoding::UTF_8)
      body = JSON.parse(body) if body && request.headers['Content-Type'] == 'application/json'
      captured << { 'method' => request.method, 'path' => uri.path, 'query' => URI.decode_www_form(uri.query || '').to_h,
                    'body' => body }
      CalmLens::Response.new(status: 200, headers: { 'content-type' => 'application/json' },
                             body: JSON.generate(fixture['response']))
    end
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', max_retries: 0, transport: transport)
    [yield(client), captured]
  end

  # Converts option names to snake_case symbols the way Ruby callers write them; metadata keys stay.
  def snake(value)
    case value
    when Hash
      value.to_h { |key, item| [snake_name(key).to_sym, key == 'metadata' ? item : snake(item)] }
    when Array then value.map { |item| snake(item) }
    else value
    end
  end

  # requests.json, in camelCase and snake_case: the request sent and the result returned.
  def replay_request(fixture)
    expected = case fixture['operation']
               when /\.(delete|removeEntry)\z/ then nil
               when 'ensureLenses' then fixture['response']['lenses']
               else fixture['response']
               end
    [fixture['options'], snake(fixture['options'])].each do |options|
      result, captured = capture(fixture) { |client| invoke(client, fixture['operation'], options) }
      assert_equal [fixture['request']], captured, "#{fixture['operation']} #{options.inspect}"
      assert_json json(expected), json(result), "#{fixture['operation']} result"
    end
  end
  each_case('request', fixture('requests')) { |fixture| fixture['operation'] }

  # ---- paths.json ------------------------------------------------------------------------------

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

  # ---- errors.json -----------------------------------------------------------------------------

  def replay_api_error(entry)
    response = entry['response']
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', max_retries: 0, transport: lambda do |_|
      CalmLens::Response.new(status: response['status'], headers: response['headers'], body: JSON.generate(response['body']))
    end)
    error = failure { invoke(client, entry['operation'], ruby_args(entry['operation'], entry['args'])) }
    assert_equal entry['expected'], error_fields(error), entry['code']
    assert_instance_of ERROR_CLASSES.fetch(entry['status']) { CalmLens::APIError }, error, entry['code']
  end

  # The error class for each HTTP status; other statuses raise APIError itself.
  ERROR_CLASSES = { 400 => CalmLens::BadRequestError, 401 => CalmLens::AuthenticationError, 403 => CalmLens::PermissionDeniedError,
                    404 => CalmLens::NotFoundError, 409 => CalmLens::ConflictError, 429 => CalmLens::RateLimitError,
                    500 => CalmLens::ServerError, 502 => CalmLens::ServerError, 503 => CalmLens::ServerError,
                    504 => CalmLens::ServerError }.freeze
  each_case('api_error', fixture('errors')) { |entry| entry['code'] }

  # The mock answers each error code with this status, so a stale generated file would mislead tests.
  def test_generated_error_codes_match_the_shared_errors_fixture
    assert_equal self.class.fixture('errors').to_h { |entry| [entry['code'], entry['status']] }, CalmLens::ErrorCodes::STATUSES
  end

  # ---- client-cases.json -----------------------------------------------------------------------

  UUID_V4 = /\A\h{8}-\h{4}-4\h{3}-[89ab]\h{3}-\h{12}\z/i
  CLIENT_OPTIONS = { 'apiKey' => :api_key, 'projectId' => :project_id, 'baseUrl' => :base_url,
                     'cdnBaseUrl' => :cdn_base_url, 'maxRetries' => :max_retries,
                     'maxResponseBytes' => :max_response_bytes }.freeze

  def client_options(options)
    options.to_h do |name, value|
      next [:timeout, value / 1000.0] if name == 'timeoutMs'

      [CLIENT_OPTIONS.fetch(name), value]
    end
  end

  def scripted_response(scripted)
    status = scripted.fetch('status', 200)
    body = if scripted.key?('body') then JSON.generate(scripted['body'])
           elsif scripted.key?('bodyBase64') then scripted['bodyBase64'].unpack1('m0')
           else scripted.fetch('bodyText', '')
           end
    CalmLens::Response.new(status: status, headers: scripted.fetch('headers', {}), body: status == 204 ? '' : body)
  end

  def drain(body)
    return body.to_s.b unless body.respond_to?(:read)

    buffer = String.new(encoding: Encoding::BINARY)
    while (chunk = body.read(16_384))
      buffer << chunk
    end
    buffer
  end

  # A transport that records each request and answers it with the case's next scripted response.
  def scripted_transport(clientcase, received)
    lambda do |request|
      received << { method: request.method, url: request.url, headers: request.headers, body: drain(request.body) }
      scripted = clientcase['responses'][received.size - 1]
      flunk "request #{received.size} has no scripted response" unless scripted
      if scripted['hang']
        sleep(request.timeout)
        raise Net::ReadTimeout
      end
      raise Errno::ECONNRESET if scripted['transportError']

      scripted_response(scripted)
    end
  end

  def header(headers, name) = headers.find { |key, _| key.to_s.casecmp?(name) }&.last

  def check_header(label, name, actual, expected, uuids)
    if expected.is_a?(Hash) && expected.key?('$absent')
      assert_nil actual, "#{label}: #{name} is absent"
    elsif expected.is_a?(Hash) && expected.key?('$regex')
      assert_match Regexp.new(expected['$regex']), actual.to_s, "#{label}: #{name}"
    elsif expected.is_a?(Hash) && expected.key?('$uuid')
      assert_match UUID_V4, actual.to_s, "#{label}: #{name} is a UUID"
      if uuids.key?(expected['$uuid'])
        assert_equal uuids[expected['$uuid']], actual, "#{label}: #{name} reuses #{expected['$uuid']}"
      else
        refute_includes uuids.values, actual, "#{label}: #{name} is a new value"
        uuids[expected['$uuid']] = actual
      end
    else
      assert_equal expected, actual, "#{label}: #{name}"
    end
  end

  def check_requests(clientcase, received)
    assert_equal clientcase['requests'].size, received.size, 'requests sent'
    uuids = {}
    clientcase['requests'].each_with_index do |want, index|
      got = received.fetch(index)
      label = "request #{index + 1}"
      origin, path, query = got[:url].match(%r{\A([a-z]+://[^/?#]+)([^?#]*)(?:\?([^#]*))?}).captures
      assert_equal want.slice('method', 'origin', 'path'), { 'method' => got[:method], 'origin' => origin, 'path' => path }, label
      # Queries compare decoded, as the API's parser reads them; pair order is free.
      assert_equal want['query'].sort, URI.decode_www_form(query.to_s).sort, "#{label}: query"
      CLIENT_CASES['everyRequest']['headers'].merge(want['headers']).each do |name, value|
        check_header(label, name, header(got[:headers], name), value, uuids)
      end
      check_body(label, want, got[:body])
    end
  end

  def check_body(label, want, body)
    if want.key?('body')
      want['body'].nil? ? assert_empty(body, "#{label}: no body") : assert_equal(want['body'], JSON.parse(body), "#{label}: body")
    else
      actual = { 'bodyLength' => body.bytesize, 'bodySha256' => Digest::SHA256.hexdigest(body) }
      actual['bodyBase64'] = [body].pack('m0') if want.key?('bodyBase64')
      assert_equal want.slice('bodyLength', 'bodySha256', 'bodyBase64'), actual, "#{label}: raw body"
    end
  end

  def check_error(label, wanted, error)
    cause = error.is_a?(IterationFailed) ? error.error : error
    fields = error_fields(cause)
    want = wanted['error'].dup
    if want['retryAfter'].is_a?(Hash)
      assert_operator fields['retryAfter'], :>=, want['retryAfter']['$gte'], "#{label}: retryAfter"
      want['retryAfter'] = fields['retryAfter']
    end
    assert_equal want, fields, label
    return unless wanted.key?('partialResult')

    assert_equal wanted['partialResult'], json(error.is_a?(IterationFailed) ? error.partial : nil), "#{label}: yielded"
  end

  def check_result(label, wanted, result)
    if wanted&.key?('cdn')
      cdn = wanted['cdn']
      assert_equal cdn, { 'status' => result.status, 'headers' => cdn['headers'].to_h { |name, _| [name, result.headers[name.downcase]] },
                          'bodyBase64' => [result.body].pack('m0') }, label
    else
      assert_json wanted&.fetch('result', nil), json(result), label
    end
  end

  # The case's client, with a virtual clock whose waits are recorded and pass at once; or the error
  # its options raise.
  def scripted_client(clientcase, received, sleeps)
    options = client_options(CLIENT_CASES['client'].merge(clientcase['client'] || {}))
    client = CalmLens::ServerClient.new(**options, transport: scripted_transport(clientcase, received))
    waited = 0.0
    client.instance_variable_get(:@session).use_clock(monotonic: -> { waited }, pause: lambda { |seconds|
      sleeps << (seconds * 1000).round
      waited += seconds
    })
    client
  rescue CalmLens::Error => e
    e
  end

  def replay_client_case(clientcase)
    received = []
    sleeps = []
    client = scripted_client(clientcase, received, sleeps)
    construction = client if client.is_a?(CalmLens::Error)
    clientcase['steps'].each_with_index do |step, index|
      label = "step #{index + 1} (#{step['operation']})"
      result = nil
      error = construction
      unless error
        begin
          result = invoke(client, step['operation'], ruby_args(step['operation'], decode(step.fetch('args', {}))))
        rescue CalmLens::Error, IterationFailed => e
          error = e
        end
      end
      if step.dig('expect', 'error')
        check_error(label, step['expect'], error)
        break
      end
      raise error if error

      check_result(label, step['expect'], result)
    end
    check_requests(clientcase, received)
    check_sleeps(clientcase.fetch('sleepsMs', []), sleeps)
  end

  def check_sleeps(expected, sleeps)
    assert_equal expected.size, sleeps.size, "waits #{sleeps.inspect}"
    expected.zip(sleeps).each do |want, got|
      want.is_a?(Array) ? assert_includes(want[0]..want[1], got, 'wait') : assert_equal(want, got, 'wait')
    end
  end

  CLIENT_CASES['cases'].each_with_index do |clientcase, index|
    label = "#{clientcase['area']} #{clientcase['name']}".downcase.gsub(/[^a-z0-9]+/, '_').delete_suffix('_')
    define_method("test_client_case_#{index + 1}_#{label}") do
      requirement = clientcase['requires']
      flunk "requires unknown capability #{requirement}" if requirement && !NOT_APPLICABLE.key?(requirement)
      reason = requirement && NOT_APPLICABLE[requirement]
      skip "not applicable: #{reason}" if reason

      replay_client_case(clientcase)
    end
  end

  # ---- surface.json defaults -------------------------------------------------------------------

  def test_client_defaults_follow_the_shared_defaults
    session = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1').instance_variable_get(:@session)
    setting = ->(name) { session.instance_variable_get(name) }
    values = {
      'baseUrl' => session.base_url, 'cdnBaseUrl' => session.cdn_base_url,
      'timeoutMs' => setting.call(:@timeout) * 1000, 'uploadTimeoutMs' => setting.call(:@upload_timeout),
      'maxRetries' => setting.call(:@max_retries), 'retryBaseDelayMs' => setting.call(:@retry_base_delay) * 1000,
      'retryMaxDelayMs' => CalmLens::ServerClient::RETRY_MAX_DELAY * 1000,
      'retryAfterMaxMs' => CalmLens::ServerClient::RETRY_AFTER_MAX * 1000,
      'maxResponseBytes' => setting.call(:@max_response_bytes),
      'signedUrlExpiresInSeconds' => CalmLens::Assets::DEFAULT_SIGNED_URL_SECONDS,
      'uploadTokenExpiresInSeconds' => CalmLens::UploadTokens::DEFAULT_TTL_SECONDS,
      'waitForDecisionTimeoutMs' => CalmLens::Assets::DEFAULT_DECISION_TIMEOUT * 1000,
      'waitForDecisionFirstIntervalMs' => CalmLens::Assets::DECISION_POLL_FIRST_DELAY * 1000,
      'waitForDecisionIntervalFactor' => CalmLens::Assets::DECISION_POLL_FACTOR,
      'waitForDecisionMaxIntervalMs' => CalmLens::Assets::DECISION_POLL_MAX_DELAY * 1000,
      'ensureLensesBatchSize' => CalmLens::ServerClient::ENSURE_LENSES_MAX_PER_REQUEST
    }
    names = CLIENT_CASES['cases'].map { |clientcase| clientcase['name'] }
    SURFACE['defaults'].each do |default|
      assert values.key?(default['id']), "#{default['id']} is known"
      if default['value'].nil?
        assert_nil(values[default['id']],
                   default['id'])
      else
        assert_equal(default['value'], values[default['id']], default['id'])
      end
      default['observedBy'].each { |name| assert_includes names, name, default['id'] }
    end
  end
end
