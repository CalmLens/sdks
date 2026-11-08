# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require 'net/http'
require 'stringio'

class ServerClientTest < Minitest::Test
  OK = '{"id":"asset","upload":{"status":"completed"},"classification":{"status":"completed","moderation":{"status":"allowed"}}}'

  # A transport that answers with a scripted sequence and records each request.
  def scripted(*answers, **options)
    sent = []
    transport = lambda do |request|
      sent << request
      answer = answers.shift || flunk('Unexpected extra request')
      raise answer if answer.is_a?(Exception)

      status, body, headers = answer
      CalmLens::Response.new(status: status, body: body, headers: headers || {})
    end
    [CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: transport, retry_base_delay: 0, **options), sent]
  end

  # A sent request's body, with a stream read.
  def drain(request) = request.body.respond_to?(:read) ? request.body.read.to_s : request.body.to_s

  # An upload form's options (parsed) and file bytes.
  def form_of(request)
    options, file = CalmLens::Testing::FakeAPI.upload_form(drain(request), request.headers['Content-Type'])
    flunk "not an upload form: #{request.headers['Content-Type']}" unless options
    [JSON.parse(options), file]
  end

  def busy(status = 503, code = 'server/unavailable') = [status, %({"code":"#{code}"}), { 'retry-after' => '0' }]

  def test_streamed_uploads_rewind_before_a_retry
    client, sent = scripted(Errno::ECONNRESET.new, [200, OK])
    io = StringIO.new('streamed')
    files = []
    test = self
    sent.define_singleton_method(:<<) do |request|
      files << test.form_of(request).last
      super(request)
    end
    client.assets.create(name: 'note.txt', content: { data: io, type: 'text/plain' })
    assert_equal %w[streamed streamed], files
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
      sleep 2 if request.headers['Content-Type'].start_with?('multipart/form-data')
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
    lens = { identifier: 'thumb', name: 'Thumb', type: 'image', active: true, transform: { width: 1, fit: 'cover' } }
    reordered = lens.merge(transform: { fit: 'cover', width: 1 })
    results = [lens, reordered].map { |definition| Thread.new { client.ensure_lens(definition) } }.map(&:value)
    assert_equal([%w[lens-1 thumb]] * 2, results.map { |saved| saved.values_at('id', 'identifier') })
    assert_equal 1, sent.size
  end

  def test_a_lens_without_active_is_the_same_definition_as_an_active_one
    sent = []
    transport = lambda do |request|
      sent << request.url
      CalmLens::Response.new(status: 200, body: JSON.generate('lenses' => [{ 'id' => 'lens-1', 'identifier' => 'thumb' }]))
    end
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: transport)
    lens = { identifier: 'thumb', name: 'Thumb', type: 'image' }
    client.ensure_lens(lens)
    client.ensure_lens(lens.merge(active: true))
    assert_equal 1, sent.size
    client.ensure_lens(lens.merge(active: false))
    assert_equal 2, sent.size
  end

  def test_a_lens_changed_through_lenses_update_is_sent_again_by_ensure_lens
    methods = []
    transport = lambda do |request|
      methods << request.method
      saved = { 'id' => 'lens-thumb', 'identifier' => 'thumb', 'name' => 'Thumb' }
      body = request.method == 'PATCH' ? saved.merge('name' => 'Renamed') : { 'lenses' => [saved] }
      CalmLens::Response.new(status: 200, body: JSON.generate(body))
    end
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: transport)
    lens = { identifier: 'thumb', name: 'Thumb', type: 'image', active: true }
    2.times { client.ensure_lens(lens) }
    assert_equal %w[PUT], methods
    client.lenses.update(lens_id: 'lens-thumb', name: 'Renamed')
    client.ensure_lens(lens)
    assert_equal %w[PUT PATCH PUT], methods
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
      -> { client.cdn.serve(asset_id: 'a', init: { headers: { 'X-Test' => "a\r\nb" } }) },
      -> { client.cdn.serve(asset_id: 'a', init: { method: 'POST' }) },
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
    assert_equal({ 'items' => [{ 'text' => newest }] }, JSON.parse(sent.first.body)['context'])
  end

  # Upload fields such as earlier posts, author IDs and descriptions never reach the URL, which
  # proxies and servers log: text sends them in its JSON body, a file in its upload form.
  PRIVATE_FIELDS = { description: 'Private description', author_id: 'pupil-7',
                     context: { items: [{ text: 'Another pupil wrote this', author_id: 'pupil-8' }] } }.freeze

  def refute_private_fields_in_url(url)
    query = URI.decode_www_form(URI(url).query.to_s).to_h
    assert_empty query.keys & CalmLens::Assets::UPLOAD_OPTION_KEYS, url
    ['Private description', 'pupil-7', 'pupil-8', 'Another pupil'].each do |value|
      refute_includes URI.decode_www_form_component(url), value
    end
  end

  def test_text_classify_sends_its_fields_in_the_json_body_not_the_url
    client, sent = scripted([200, OK])
    client.text.classify(text: 'Same to you', **PRIVATE_FIELDS)
    refute_private_fields_in_url(sent.first.url)
    assert_equal({ 'wait' => 'true' }, URI.decode_www_form(URI(sent.first.url).query).to_h)
    body = JSON.parse(sent.first.body)
    assert_equal ['Private description', 'pupil-7', [{ 'text' => 'Another pupil wrote this', 'authorId' => 'pupil-8' }]],
                 [body['description'], body['authorId'], body.dig('context', 'items')]
  end

  def test_a_file_upload_sends_its_fields_in_the_form_not_the_url
    client, sent = scripted([200, OK])
    client.assets.create(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, tags: %w[catalogue backpacks],
                         **PRIVATE_FIELDS)
    refute_private_fields_in_url(sent.first.url)
    options, file = form_of(sent.first)
    assert_equal ['photo.png', 'Private description', 'pupil-7', %w[catalogue backpacks], 'hello'],
                 [options['name'], options['description'], options['authorId'], options['tags'], file]
    assert_equal [{ 'text' => 'Another pupil wrote this', 'authorId' => 'pupil-8' }], options.dig('context', 'items')
  end

  def test_structured_transform_numbers_match_javascript_and_other_values_are_rejected
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', transport: ->(_) { flunk 'sent a request' })
    url = client.cdn.get_asset_url(asset_id: 'a', resource: 'rendered',
                                   transform: { brightness: 2.0, blur: 1.0e-7, contrast: -90, gamma: 1e21 })
    assert_equal 'https://cdn.calmlens.com/v1/assets/project/a/rendered/blur=1e-7,brightness=2,contrast=-90,gamma=1e%2B21', url
    [Float::INFINITY, Float::NAN, :png, 1r, { 'border-color' => 1 }].each do |value|
      error = assert_raises(CalmLens::InvalidArgumentError, value.inspect) do
        client.cdn.get_asset_url(asset_id: 'a', resource: 'rendered', transform: { width: value })
      end
      assert_equal 'sdk/invalid-argument', error.code
    end
    assert_equal 'https://cdn.calmlens.com/v1/assets/project/a/rendered/@thumb,background=ffaa00,trim.border.color=abc',
                 client.cdn.get_asset_url(asset_id: 'a', resource: 'rendered', lens: 'thumb',
                                          transform: { trim: { border: { color: '#ABC' } }, background: '#FFAA00' })
    [{}, { width: nil }, [{ width: 1 }]].each do |transform|
      error = assert_raises(CalmLens::InvalidArgumentError, transform.inspect) do
        client.cdn.get_asset_url(asset_id: 'a', resource: 'rendered', lens: 'thumb', transform: transform)
      end
      assert_equal 'sdk/invalid-argument', error.code
    end
  end

  INFO = '{"id":"a","projectId":"project","type":"image","externalUrl":null,"content":{},"availability":"available"}'

  def test_asset_info_is_read_beneath_the_url_without_the_api_key_and_with_the_viewers_claims
    client, sent = scripted([200, INFO], [200, INFO], [403, '{"code":"signed-url/expired"}'])
    signed = 'https://cdn.example/v1/assets/project/sig_00/?viewerClaims=%7B%22region%22%3A%22DE%22%7D'
    assert_equal 'available', client.cdn.get_asset_info(signed)['availability']
    client.cdn.get_asset_info(signed, viewer_claims: { age_confirmed: true })
    error = assert_raises(CalmLens::PermissionDeniedError) { client.cdn.get_asset_info(signed) }
    assert_equal ['signed-url/expired', 403], [error.code, error.status]
    assert_equal ['https://cdn.example/v1/assets/project/sig_00/info?viewerClaims=%7B%22region%22%3A%22DE%22%7D',
                  'https://cdn.example/v1/assets/project/sig_00/info?viewerClaims=%7B%22ageConfirmed%22%3Atrue%7D'],
                 sent.first(2).map(&:url)
    assert_equal([['GET', nil]] * 3, sent.map { |request| [request.method, request.headers['X-Api-Key']] })
  end

  def test_asset_info_refuses_a_relative_url_and_a_response_that_is_not_asset_info
    client, sent = scripted([200, '{"id":"a"}'])
    assert_equal 'sdk/invalid-argument', assert_raises(CalmLens::InvalidArgumentError) { client.cdn.get_asset_info('/assets/p/a') }.code
    assert_empty sent
    error = assert_raises(CalmLens::InvalidResponseError) { client.cdn.get_asset_info('https://cdn.example/v1/assets/p/a') }
    assert_equal 'sdk/invalid-response', error.code
  end

  def test_snake_case_options_are_converted_but_metadata_keys_are_not
    client, sent = scripted([200, OK])
    client.assets.update(asset_id: 'a', external_url: 'https://example.com/a', metadata: { 'my_key' => { 'inner_key' => 2 } })
    assert_equal({ 'externalUrl' => 'https://example.com/a', 'metadata' => { 'my_key' => { 'inner_key' => 2 } } },
                 JSON.parse(sent.first.body))
  end

  def test_an_empty_types_list_filters_nothing_and_types_must_be_strings
    client, sent = scripted([200, '{"items":[],"nextCursor":"c","hasMore":false}'])
    client.events.list(cursor: 'c', types: [])
    assert_equal 'cursor=c', URI.parse(sent.first.url).query
    error = assert_raises(CalmLens::InvalidArgumentError) { client.events.list(cursor: 'c', types: 'asset.blocked') }
    assert_equal CalmLens::SdkErrorCodes::INVALID_ARGUMENT, error.code
    assert_equal 1, sent.size
  end

  def test_oversized_one_request_uploads_are_refused_before_sending
    # With the largest part size, none of these is split into parts.
    client, sent = scripted([200, OK], part_size_bytes: 64 * 1024 * 1024)
    mib = 1024 * 1024
    { 'image/png' => (10 * mib) + 1, 'video/mp4' => (50 * mib) + 1, 'application/pdf' => (5000 * mib) + 1 }.each do |type, size|
      error = assert_raises(CalmLens::InvalidArgumentError, type) do
        client.assets.create(name: 'big', content: { data: StringIO.new(''), size_in_bytes: size, type: type })
      end
      assert_equal [CalmLens::ErrorCodes::UPLOAD_TOO_LARGE, { 'limitBytes' => size - 1, 'source' => 'plan' }], [error.code, error.details]
    end
    assert_empty sent
    client.assets.create(name: 'x.png', content: { data: 'x' * (10 * mib), type: 'image/png' })
    assert_equal 1, sent.size
  end

  def test_unknown_options_are_refused_before_sending
    client, sent = scripted
    calls = {
      'text.classify' => -> { client.text.classify(text: 'hi', extrenal_id: 'post-1') },
      'assets.create' => -> { client.assets.create(name: 'a.txt', content: { plain_text: 'a', type: 'text/plain' }, visiblity: 'private') },
      'assets.retrieve' => -> { client.assets.retrieve(asset_id: 'a', 'assetID' => 'b') },
      'assets.waitForDecision' => -> { client.assets.wait_for_decision(asset_id: 'a', timeout_seconds: 5) },
      'cdn.getAssetUrl' => -> { client.cdn.get_asset_url(asset_id: 'a', lenz: 'thumbnail') },
      'uploadTokens.sign' => -> { client.upload_tokens.sign(upload_preset_id: 'preset_1', external: 'x') }
    }
    calls.each do |operation, call|
      error = assert_raises(CalmLens::InvalidArgumentError, operation) { call.call }
      assert_equal 'sdk/invalid-argument', error.code
      assert_includes error.message, operation
    end
    assert_empty sent
  end

  def test_unknown_response_values_are_returned_unchanged
    client, = scripted([200,
                        '{"id": "a", "visibility": "team", "newField": {"x": 1}, ' \
                        '"classification": {"moderation": {"status": "quarantined"}}}'])
    assert_equal({ 'id' => 'a', 'classification' => { 'moderation' => { 'status' => 'quarantined' } },
                   'visibility' => 'team', 'newField' => { 'x' => 1 } },
                 client.assets.retrieve(asset_id: 'a'))
  end

  def test_wait_for_decision_checks_until_decided_backing_off_up_to_two_seconds
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
    assert_equal [0.5, 0.75, 1.125, 1.6875, 2.0, 2.0, 2.0, 2.0], delays
  end

  def test_wait_for_decision_keeps_waiting_while_queued_or_processing_even_once_a_reviewer_decided
    asset = lambda { |processing, moderation|
      [200, JSON.generate('id' => 'asset-1', 'classification' => { 'status' => processing, 'moderation' => { 'status' => moderation } })]
    }
    client, sent = scripted(asset.call('queued', 'pending'), asset.call('processing', 'blocked'), asset.call('completed', 'blocked'))
    client.assets.define_singleton_method(:sleep) { |_seconds| nil }
    settled = client.assets.wait_for_decision(asset_id: 'asset-1')
    assert_equal %w[completed blocked], [settled.dig('classification', 'status'), settled.dig('classification', 'moderation', 'status')]
    assert_equal 3, sent.size
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
