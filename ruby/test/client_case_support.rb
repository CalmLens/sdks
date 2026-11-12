# frozen_string_literal: true

# The client-feature parts of client-cases.json that contract_client_test.rb replays: a step's
# request options, the case's environment, and the checks of last_response, the attempt hook's
# events and the logs, and reading an upload form. Only contract_client_test.rb uses it.
module ClientCaseSupport
  # A step's own request options, with the JavaScript names: Ruby takes seconds.
  def request_options(options)
    options.to_h { |name, value| name == 'timeoutMs' ? ['timeout', value / 1000.0] : [name, value] }
  end

  # Sets the case's CALMLENS_* environment while the block runs, clearing any other.
  def with_env(env)
    saved = ENV.to_h.select { |name, _| name.start_with?('CALMLENS_') }
    saved.each_key { |name| ENV.delete(name) }
    env.each { |name, value| ENV[name] = value }
    yield
  ensure
    ENV.each_key.select { |name| name.start_with?('CALMLENS_') }.each { |name| ENV.delete(name) }
    saved.each { |name, value| ENV[name] = value }
  end

  # A logger that keeps every line it is given.
  class CapturingLogger
    attr_reader :lines

    def initialize = @lines = []
    def info(&) = @lines << yield
    def debug(&) = @lines << yield
  end

  def check_last_response(label, want, result)
    last = result.last_response
    assert_equal want, { 'status' => last.status, 'requestId' => last.request_id, 'idempotencyKey' => last.idempotency_key },
                 "#{label}: last_response"
  end

  # The hook's events, without the duration, with the wait in milliseconds.
  def check_attempts(want, events)
    got = events.map do |event|
      { 'operation' => event[:operation], 'method' => event[:method], 'path' => event[:path], 'attempt' => event[:attempt],
        'delayMs' => event[:delay] && (event[:delay] * 1000).round, 'status' => event[:status], 'requestId' => event[:request_id],
        'errorCode' => event[:error_code] }
    end
    assert_equal want, got, 'attempts'
  end

  def check_logs(want, lines)
    refute_empty lines, "#{want['level']} logs"
    want['mustNotContain'].each { |secret| lines.each { |line| refute_includes line, secret, 'a log line' } }
  end

  # Runs a step: a raw request, or an operation with the step's request options.
  def run_step(client, step)
    args = ruby_args(step['operation'], decode(step.fetch('args', {})))
    options = request_options(step.fetch('requestOptions', {}))
    if step['operation'] == 'request'
      return client.request(args['method'], args['path'], query: args.fetch('query', {}), body: args['body'],
                                                          headers: args.fetch('headers', {}), request_options: options)
    end

    args = args.merge('requestOptions' => options) unless options.empty?
    invoke(client, step['operation'], args)
  end

  # Reads an upload form as the API does: exactly an `options` part, then a `file` part, then the
  # closing boundary.
  def read_upload_form(body, content_type)
    boundary = content_type.to_s.match(%r{\Amultipart/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))}i)
    flunk "not an upload form: #{content_type}" unless boundary
    framed = "\r\n".b + body.b
    delimiter = "\r\n--#{boundary[1] || boundary[2]}".b
    assert framed.start_with?(delimiter), "the form doesn't start with its boundary"
    parts = []
    at = 0
    until framed.byteslice(at + delimiter.bytesize, 2) == '--'
      header_end = framed.index("\r\n\r\n", at)
      following = header_end && framed.index(delimiter, header_end + 4)
      flunk 'the form ends before its closing boundary' unless following
      headers = framed.byteslice(at + delimiter.bytesize + 2, header_end - at - delimiter.bytesize - 2)
      parts << { name: headers[/^content-disposition:\s*form-data;[^\r\n]*?\bname="([^"]*)"/i, 1],
                 type: headers[/^content-type:\s*([^\r\n]*)/i, 1], bytes: framed.byteslice(header_end + 4, following - header_end - 4) }
      at = following
    end
    assert_equal %w[options file], parts.map { |part| part[:name] }, 'the form holds options then file'
    { options: JSON.parse(parts[0][:bytes].dup.force_encoding(Encoding::UTF_8)), type: parts[1][:type], bytes: parts[1][:bytes] }
  end
end
