# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'net/http'

class ServerClientTest < Minitest::Test
  OK = '{"id":"asset","status":"approved"}'

  # A transport that answers with a scripted sequence and records each request.
  def scripted(*answers)
    sent = []
    transport = lambda do |request|
      sent << request
      answer = answers.shift || flunk('Unexpected extra request')
      raise answer if answer.is_a?(Exception)

      status, body, headers = answer
      CalmLens::Response.new(status: status, body: body, headers: headers || {})
    end
    [CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: transport, retry_base_delay: 0), sent]
  end

  def busy(status = 503, code = 'server/unavailable') = [status, %({"code":"#{code}"}), { 'retry-after' => '0' }]

  def test_reads_retry_on_transport_errors_and_retryable_statuses
    client, sent = scripted(Errno::ECONNRESET.new, busy(429), [200, OK])
    error = assert_raises(CalmLens::RateLimitError) { client.assets.retrieve(asset_id: 'asset', request_options: { max_retries: 1 }) }
    assert_equal [429, 2], [error.status, sent.size]
    client, sent = scripted(Errno::ECONNRESET.new, busy(429), [200, OK])
    assert_equal 'asset', client.assets.retrieve(asset_id: 'asset')['id']
    assert_equal 3, sent.size
  end

  def test_uploads_retry_with_the_same_idempotency_key
    client, sent = scripted(Net::ReadTimeout.new, busy(409, 'idempotency/request-in-progress'), [200, OK])
    client.assets.create(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' })
    keys = sent.map { |request| request.headers['Idempotency-Key'] }
    assert_equal 3, keys.size
    assert_equal 1, keys.uniq.size
    assert_match(/\A[0-9a-f-]{36}\z/, keys.first)
    assert_equal %w[hello hello hello], sent.map(&:body)

    client, sent = scripted([200, OK])
    client.assets.create(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' },
                         request_options: { idempotency_key: 'mine-1' })
    assert_equal 'mine-1', sent.first.headers['Idempotency-Key']
  end

  def test_streamed_uploads_rewind_before_a_retry
    client, sent = scripted(Errno::ECONNRESET.new, [200, OK])
    io = StringIO.new('streamed')
    bodies = []
    sent.define_singleton_method(:<<) do |request|
      bodies << request.body.read(100)
      super(request)
    end
    client.assets.create(name: 'note.txt', content: { data: io, type: 'text/plain' })
    assert_equal %w[streamed streamed], bodies
  end

  def test_writes_without_an_idempotency_key_are_not_retried
    client, sent = scripted(busy, [200, OK])
    assert_equal 503, assert_raises(CalmLens::ServerError) { client.assets.update(asset_id: 'asset', name: 'x') }.status
    assert_equal 1, sent.size
    client, sent = scripted(busy)
    assert_raises(CalmLens::ServerError) { client.assets.retrieve(asset_id: 'asset', request_options: { max_retries: 0 }) }
    assert_equal 1, sent.size
  end

  def test_errors_expose_status_request_id_headers_and_retry_after
    client, = scripted([429, '{"code":"rate/limited","message":"Slow down","details":{"field":"x"},"traceId":"t"}',
                        { 'retry-after' => '120', 'x-request-id' => 'req-1' }])
    error = assert_raises(CalmLens::RateLimitError) { client.assets.retrieve(asset_id: 'asset') }
    assert_equal ['rate/limited', 429, 'req-1', 120.0, '[calmlens] Slow down'],
                 [error.code, error.status, error.request_id, error.retry_after, error.message]
    assert_equal({ 'field' => 'x', 'network' => true, 'traceId' => 't' }, error.details)
    assert error.retryable?
    refute error.not_found?

    client, = scripted([404, '{"code":"asset/not-found"}'])
    assert assert_raises(CalmLens::NotFoundError) { client.assets.retrieve(asset_id: 'x') }.not_found?
    client, = scripted([500, 'not json'])
    assert_equal 'sdk/http-error', assert_raises(CalmLens::ServerError) { client.assets.retrieve(asset_id: 'x') }.code
    client, = scripted([200, "\"#{'x' * (32 * 1024 * 1024)}\""])
    assert_equal 'sdk/response-too-large', assert_raises(CalmLens::InvalidResponseError) { client.assets.retrieve(asset_id: 'x') }.code
    client, = scripted([200, 'not json'])
    assert_equal 'sdk/invalid-response', assert_raises(CalmLens::InvalidResponseError) { client.assets.retrieve(asset_id: 'x') }.code
  end

  def test_transport_failures_keep_their_cause
    [Net::HTTPBadResponse.new('bad'), Net::ProtocolError.new('chunk'), Zlib::DataError.new('gzip'), EOFError.new].each do |cause|
      client, = scripted(cause)
      error = assert_raises(CalmLens::ConnectionError) { client.events.list(request_options: { max_retries: 0 }) }
      assert_equal ['sdk/transport-error', cause], [error.code, error.cause]
    end
  end

  def test_invalid_configuration_raises_before_any_request
    valid = { api_key: 'key', project_id: 'project' }
    [{ api_key: '' }, { api_key: "key\r\nX-Evil: 1" }, { project_id: '..' }, { base_url: 'not a url' },
     { base_url: 'ftp://example.com' }, { cdn_base_url: 'https://user:pw@example.com' }, { timeout: 0 },
     { open_timeout: Float::INFINITY }, { max_retries: -1 }, { transport: Object.new }].each do |override|
      error = assert_raises(CalmLens::ConfigurationError, override.inspect) { CalmLens::ServerClient.new(**valid, **override) }
      assert_equal 'sdk/invalid-config', error.code
    end
  end

  def test_invalid_arguments_raise_sdk_errors_without_sending
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: ->(_) { flunk 'sent a request' })
    [
      -> { client.assets.retrieve('not options') },
      -> { client.cdn.serve(asset_identifier: 'a', init: { headers: { 'X-Test' => "a\r\nb" } }) },
      -> { client.cdn.serve(asset_identifier: 'a', init: { method: 'POST' }) },
      lambda {
        client.assets.create(name: 'n', content: { plain_text: 'x', type: 'text/plain' }, request_options: { idempotency_key: "bad key\n" })
      },
      -> { client.assets.list(request_options: { unknown: 1 }) },
      -> { client.assets.update(asset_id: 'a', name: "\xFF".b.force_encoding('UTF-8')) },
      -> { client.assets.wait_for_decision(asset_id: 'a', timeout: -1) },
      -> { client.assets.wait_for_decision(asset_id: '') }
    ].each_with_index do |action, index|
      assert_equal 'sdk/invalid-argument', assert_raises(CalmLens::InvalidArgumentError, index.to_s) { action.call }.code
    end
    error = assert_raises(CalmLens::InvalidArgumentError) do
      client.assets.create(name: 'pipe', content: { data: IO.pipe.first, type: 'text/plain' })
    end
    assert_equal 'upload/invalid-payload', error.code
  end

  def test_structured_transform_numbers_match_javascript_and_other_values_are_rejected
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: ->(_) { flunk 'sent a request' })
    url = client.cdn.get_asset_url(asset_identifier: 'a',
                                   transform: { type: 'imageTransform', options: { scale: 2.0, blur: 1.0e-7, rotate: -90, dpr: 1e21 } })
    assert_equal 'https://cdn.calmlens.com/v1/assets/project/a/content/imageTransform[blur=1e-7,dpr=1e%2B21,rotate=-90,scale=2]', url
    [Float::INFINITY, Float::NAN, :png, 1r].each do |value|
      error = assert_raises(CalmLens::InvalidArgumentError, value.inspect) do
        client.cdn.get_asset_url(asset_identifier: 'a', transform: { type: 'imageTransform', options: { width: value } })
      end
      assert_equal 'sdk/invalid-argument', error.code
    end
    assert_equal 'https://cdn.calmlens.com/v1/assets/project/a/content/@thumb,imageTransform[]',
                 client.cdn.get_asset_url(asset_identifier: 'a', lens: 'thumb', transform: { type: 'imageTransform' })
  end

  def test_unknown_snake_case_options_are_converted_but_metadata_keys_are_not
    client, sent = scripted([200, OK])
    client.assets.update(asset_id: 'a', future_option: { nested_key: 1 }, metadata: { 'my_key' => { 'inner_key' => 2 } })
    assert_equal({ 'futureOption' => { 'nestedKey' => 1 }, 'metadata' => { 'my_key' => { 'inner_key' => 2 } } },
                 JSON.parse(sent.first.body))
  end

  def test_ensure_lenses_sends_large_batches_in_consecutive_requests
    identifiers = (0..100).map { |i| "lens-#{i}" }
    lenses = identifiers.map { |identifier| { identifier: identifier, name: 'Lens', type: 'image', active: true, version: 1 } }
    saved = ->(range) { [200, JSON.generate('lenses' => identifiers[range].map { |id| { 'id' => "id-#{id}", 'identifier' => id } })] }
    client, sent = scripted(saved.call(0...100), saved.call(100..))
    result = client.ensure_lenses(lenses: lenses)
    assert_equal %w[PUT PUT], sent.map(&:method)
    assert_equal([identifiers[0...100], identifiers[100..]],
                 sent.map { |request| JSON.parse(request.body)['lenses'].map { |lens| lens['identifier'] } })
    assert_equal(identifiers, result.map { |lens| lens['identifier'] })
    assert_equal(identifiers.map { |id| "id-#{id}" }, result.map { |lens| lens['id'] })
  end

  def test_unknown_response_values_are_returned_unchanged
    client, = scripted([200, '{"id": "a", "visibility": "team", "newField": {"x": 1}, "classification": {"moderation": {"decision": "quarantined"}}}'])
    assert_equal({ 'id' => 'a', 'classification' => { 'moderation' => { 'decision' => 'quarantined' } }, 'visibility' => 'team', 'newField' => { 'x' => 1 } },
                 client.assets.retrieve(asset_id: 'a'))
  end

  def test_wait_for_decision_checks_until_decided_backing_off_up_to_five_seconds
    asset = lambda { |processing, moderation|
      [200, %({"id": "asset-1", "upload": {"status": "completed"}, "classification": {"status": "#{processing}", "moderation": {"decision": "#{moderation}"}}})]
    }
    client, sent = scripted(*Array.new(8) { asset.call('processing', 'pending') }, asset.call('completed', 'rejected'))
    delays = []
    client.assets.define_singleton_method(:sleep) { |seconds| delays << seconds }
    assert_equal({ 'id' => 'asset-1', 'upload' => { 'status' => 'completed' }, 'classification' => { 'status' => 'completed', 'moderation' => { 'decision' => 'rejected' } } },
                 client.assets.wait_for_decision(asset_id: 'asset-1'))
    assert_equal(['/v1/assets/asset-1'] * 9, sent.map { |request| URI(request.url).path })
    assert_equal [0.5, 0.75, 1.125, 1.6875, 2.53125, 3.796875, 5.0, 5.0], delays
  end

  def test_wait_for_decision_returns_failed_processing_without_a_decision
    client, sent = scripted([200, '{"id": "asset-1", "upload": {"status": "completed"}, "classification": {"status": "failed", "moderation": {"decision": "pending"}}}'])
    client.assets.define_singleton_method(:sleep) { |_| flunk 'waited after processing failed' }
    assert_equal 'failed', client.assets.wait_for_decision(asset_id: 'asset-1').dig('classification', 'status')
    assert_equal 1, sent.size
  end

  def test_wait_for_decision_raises_sdk_timeout_with_the_last_status_without_waiting_past_the_deadline
    client, sent = scripted([200, '{"id": "asset-1", "upload": {"status": "uploading"}, "classification": {"status": "pending", "moderation": {"decision": "pending"}}}'],
                            [200, '{"id": "asset-1", "upload": {"status": "completed"}, "classification": {"status": "processing", "moderation": {"decision": "pending"}}}'])
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    error = assert_raises(CalmLens::TimeoutError) { client.assets.wait_for_decision(asset_id: 'asset-1', timeout: 0.2) }
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 0.45
    assert_equal ['sdk/timeout', { 'assetId' => 'asset-1', 'classificationStatus' => 'processing', 'moderationStatus' => 'pending' }, 2],
                 [error.code, error.details, sent.size]
  end

  def test_asset_pages_iterate_lazily_until_has_more_is_false
    page = lambda do |ids, more|
      [200, JSON.generate('items' => ids.map { |id| { 'id' => id } }, 'hasMore' => more, 'nextCursor' => more ? 'next-token' : nil)]
    end
    client, sent = scripted(page.call(%w[a b], true), page.call(%w[c], false))
    assert_equal(%w[a b c], client.assets.each_child(asset_id: 'parent', page_size: 2).map { |asset| asset['id'] })
    assert_equal([nil, 'next-token'], sent.map { |request| URI.decode_www_form(URI(request.url).query).to_h['cursor'] })
    client, sent = scripted(page.call(%w[a b], true))
    assert_equal(['a'], client.assets.each.first(1).map { |asset| asset['id'] })
    assert_equal 1, sent.size
  end
end

class WebhookTest < Minitest::Test
  BODY = '{"id":"event-1","type":"asset.approved","createdAt":1,"projectId":"p",' \
         '"data":{"assetId":"a","facts":[{"key":"test","value":true}]}}'

  def sign(body = BODY, at = 1_700_000_000) = CalmLens.create_webhook_signature_header(payload: body, timestamp: at, secret: 'whsec')

  def test_parse_event_verifies_then_parses
    event = CalmLens.parse_webhook_event(payload: BODY, signature: sign, timestamp: '1700000000', secret: 'whsec', now: 1_700_000_000)
    assert_equal ['event-1', 'asset.approved', 'a', true], [event.id, event.type, event.asset_id, event.test?]
    error = assert_raises(CalmLens::WebhookVerificationError) do
      CalmLens.parse_webhook_event(payload: "#{BODY} ", signature: sign, timestamp: '1700000000', secret: 'whsec', now: 1_700_000_000)
    end
    assert_equal 'sdk/invalid-webhook-signature', error.code
    error = assert_raises(CalmLens::WebhookVerificationError) do
      CalmLens.parse_webhook_event(payload: '[1]', signature: sign('[1]'), timestamp: '1700000000', secret: 'whsec', now: 1_700_000_000)
    end
    assert_equal 'sdk/invalid-webhook-payload', error.code
    %w[createdAt projectId].each do |field|
      body = JSON.generate(JSON.parse(BODY).except(field))
      error = assert_raises(CalmLens::WebhookVerificationError) do
        CalmLens.parse_webhook_event(payload: body, signature: sign(body), timestamp: '1700000000', secret: 'whsec', now: 1_700_000_000)
      end
      assert_equal 'sdk/invalid-webhook-payload', error.code, field
    end
  end

  def test_parsed_payloads_are_rejected
    [JSON.parse(BODY), nil, StringIO.new(BODY)].each do |payload|
      error = assert_raises(CalmLens::InvalidArgumentError) do
        CalmLens.verify_webhook_signature(payload: payload, signature: sign, timestamp: '1700000000', secret: 'whsec', now: 1_700_000_000)
      end
      assert_equal 'sdk/invalid-argument', error.code
      assert_raises(CalmLens::InvalidArgumentError) { CalmLens.create_webhook_signature_header(payload: payload, timestamp: 1, secret: 'whsec') }
    end
  end

  def test_binary_bodies_verify
    body = "{\"note\":\"h\xC3\xA9\"}".b
    assert CalmLens.verify_webhook_signature(payload: body, signature: sign(body.dup.force_encoding('UTF-8')), timestamp: '1700000000',
                                             secret: 'whsec', now: 1_700_000_000)
  end
end
