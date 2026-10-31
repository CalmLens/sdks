# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'net/http'

class ServerClientTest < Minitest::Test
  OK = '{"id":"asset","upload":{"status":"completed"},"classification":{"status":"completed","moderation":{"status":"allowed"}}}'

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

  def test_not_found_is_known_by_status_or_code
    client, = scripted([404, '{"code":"asset/not-found"}'], [410, '{"code":"folder/not-found"}'], [429, '{"code":"rate/limited"}'])
    assert assert_raises(CalmLens::NotFoundError) { client.assets.retrieve(asset_id: 'x') }.not_found?
    assert assert_raises(CalmLens::APIError) { client.folders.retrieve(folder_id: 'x') }.not_found?
    refute assert_raises(CalmLens::RateLimitError) { client.assets.retrieve(asset_id: 'x', request_options: { max_retries: 0 }) }.not_found?
  end

  def test_the_request_id_comes_from_the_header_or_else_the_error_body
    body = '{"code":"asset/not-found","message":"Not found","requestId":"body-id","details":{"path":"assetId"}}'
    client, = scripted([404, body, { 'x-request-id' => 'header-id' }], [404, body])
    from_header = assert_raises(CalmLens::NotFoundError) { client.assets.retrieve(asset_id: 'x') }
    assert_equal ['header-id', { 'path' => 'assetId' }], [from_header.request_id, from_header.details]
    assert_equal 'body-id', assert_raises(CalmLens::NotFoundError) { client.assets.retrieve(asset_id: 'x') }.request_id
  end

  def test_upload_timeout_limits_each_attempt_of_a_binary_upload_only
    slow = lambda do |request|
      sleep 2 if request.headers['Content-Type'] == 'application/pdf'
      CalmLens::Response.new(status: 200, body: OK)
    end
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: slow, upload_timeout: 0.1, max_retries: 0)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    error = assert_raises(CalmLens::TimeoutError) { client.assets.create(name: 'a.pdf', content: { data: 'pdf', type: 'application/pdf' }) }
    assert_equal 'sdk/timeout', error.code
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 1
    assert_equal 'asset', client.assets.create(name: 'a.txt', content: { plain_text: 'hi', type: 'text/plain' })['id']
  end

  def test_concurrent_identical_lens_ensures_send_the_definition_once
    sent = Queue.new
    transport = lambda do |request|
      sent << request
      sleep 0.05
      CalmLens::Response.new(status: 200, body: JSON.generate('lenses' => [{ 'id' => 'lens-1', 'identifier' => 'thumb' }]))
    end
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: transport)
    lens = { identifier: 'thumb', name: 'Thumb', type: 'image', active: true, version: 1,
             transforms: [{ type: 'imageTransform', options: { width: 1, fit: 'cover' } }] }
    reordered = lens.merge(transforms: [{ options: { fit: 'cover', width: 1 }, type: 'imageTransform' }])
    results = [lens, reordered].map { |definition| Thread.new { client.ensure_lens(definition) } }.map(&:value)
    assert_equal([%w[lens-1 thumb]] * 2, results.map { |saved| saved.values_at('id', 'identifier') })
    assert_equal 1, sent.size
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
    [{ api_key: "key\r\nX-Evil: 1" }, { base_url: 'not a url' }, { cdn_base_url: 'https://user:pw@example.com' },
     { open_timeout: Float::INFINITY }, { upload_timeout: 0 }, { max_response_bytes: 1.5 }, { retry_base_delay: -1 },
     { transport: Object.new }].each do |override|
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
      -> { client.assets.wait_for_decision(asset_id: '') },
      -> { client.text.classify(text: 'Same to you', context: { items: 'Earlier post' }) },
      -> { client.text.classify(text: 'Same to you', context: { items: [{ author_id: 'user-1' }] }) }
    ].each_with_index do |action, index|
      assert_equal 'sdk/invalid-argument', assert_raises(CalmLens::InvalidArgumentError, index.to_s) { action.call }.code
    end
  end

  # The newest earlier post is sent even when it alone exceeds the characters CalmLens uses, so the
  # API can reject it; older posts that would not fit are left out.
  def test_the_newest_earlier_post_is_always_sent
    client, sent = scripted([200, OK])
    newest = 'x' * (CalmLens::ModerationContext::USED_CHARACTERS + 1)
    client.text.classify(text: 'Same to you', context: { items: [{ text: 'Older post', author_id: 'user-1' }, { text: newest }] })
    query = URI.decode_www_form(URI(sent.first.url).query).to_h
    assert_equal({ 'items' => [{ 'text' => newest }] }, JSON.parse(query['context']))
  end

  def test_structured_transform_numbers_match_javascript_and_other_values_are_rejected
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: ->(_) { flunk 'sent a request' })
    url = client.cdn.get_asset_url(asset_identifier: 'a',
                                   transform: { type: 'imageTransform', options: { scale: 2.0, blur: 1.0e-7, rotate: -90, dpr: 1e21 } })
    assert_equal 'https://cdn.calmlens.com/v1/assets/project/a/rendered/blur=1e-7,dpr=1e%2B21,rotate=-90,scale=2', url
    [Float::INFINITY, Float::NAN, :png, 1r, { 'border-color' => 1 }].each do |value|
      error = assert_raises(CalmLens::InvalidArgumentError, value.inspect) do
        client.cdn.get_asset_url(asset_identifier: 'a', transform: { type: 'imageTransform', options: { width: value } })
      end
      assert_equal 'sdk/invalid-argument', error.code
    end
    assert_equal 'https://cdn.calmlens.com/v1/assets/project/a/rendered/@thumb/background=ffaa00,trim.border.color=abc',
                 client.cdn.get_asset_url(asset_identifier: 'a', lens: 'thumb', transform: {
                                            type: 'imageTransform', options: { trim: { border: { color: '#ABC' } }, background: '#FFAA00' }
                                          })
    error = assert_raises(CalmLens::InvalidArgumentError) do
      client.cdn.get_asset_url(asset_identifier: 'a', lens: 'thumb', transform: { type: 'imageTransform' })
    end
    assert_equal 'sdk/invalid-argument', error.code
  end

  def test_unknown_snake_case_options_are_converted_but_metadata_keys_are_not
    client, sent = scripted([200, OK])
    client.assets.update(asset_id: 'a', future_option: { nested_key: 1 }, metadata: { 'my_key' => { 'inner_key' => 2 } })
    assert_equal({ 'futureOption' => { 'nestedKey' => 1 }, 'metadata' => { 'my_key' => { 'inner_key' => 2 } } },
                 JSON.parse(sent.first.body))
  end

  def test_unknown_response_values_are_returned_unchanged
    client, = scripted([200,
                        '{"id": "a", "visibility": "team", "newField": {"x": 1}, ' \
                        '"classification": {"moderation": {"status": "quarantined"}}}'])
    assert_equal({ 'id' => 'a', 'classification' => { 'moderation' => { 'status' => 'quarantined' } },
                   'visibility' => 'team', 'newField' => { 'x' => 1 } },
                 client.assets.retrieve(asset_id: 'a'))
  end

  def test_wait_for_decision_checks_until_decided_backing_off_up_to_five_seconds
    asset = lambda { |processing, moderation|
      [200,
       '{"id": "asset-1", "upload": {"status": "completed"}, ' \
       "\"classification\": {\"status\": \"#{processing}\", \"moderation\": {\"status\": \"#{moderation}\"}}}"]
    }
    client, sent = scripted(*Array.new(8) { asset.call('processing', 'pending') }, asset.call('completed', 'blocked'))
    delays = []
    client.assets.define_singleton_method(:sleep) { |seconds| delays << seconds }
    assert_equal({ 'id' => 'asset-1', 'upload' => { 'status' => 'completed' },
                   'classification' => { 'status' => 'completed', 'moderation' => { 'status' => 'blocked' } } },
                 client.assets.wait_for_decision(asset_id: 'asset-1'))
    assert_equal(['/v1/assets/asset-1'] * 9, sent.map { |request| URI(request.url).path })
    assert_equal [0.5, 0.75, 1.125, 1.6875, 2.53125, 3.796875, 5.0, 5.0], delays
  end

  def test_asset_pages_are_fetched_only_as_items_are_needed
    page = [200, JSON.generate('items' => [{ 'id' => 'a' }, { 'id' => 'b' }], 'hasMore' => true, 'nextCursor' => 'next-token')]
    client, sent = scripted(page)
    assert_equal(['a'], client.assets.each.first(1).map { |asset| asset['id'] })
    assert_equal 1, sent.size
  end
end

class WebhookTest < Minitest::Test
  BODY = '{"id":"event-1","type":"asset.allowed","createdAt":1,"projectId":"p",' \
         '"data":{"assetId":"a","facts":[{"key":"test","value":true}]}}'

  def sign(body = BODY, at = 1_700_000_000) = CalmLens.create_webhook_signature_header(payload: body, timestamp: at, secret: 'whsec')

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
