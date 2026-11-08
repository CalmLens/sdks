# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens/testing'

class MockTest < Minitest::Test
  KEEP = { keep_content_after_processing: true }.freeze
  # A key that may read private content from the CDN; the default key may not.
  DOWNLOAD = CalmLens::MockServerClient.create_api_key([{ actions: ['assets:download'], folder_id: nil, include_subfolders: true }])

  def test_blocked_assets_keep_content_but_are_not_served
    mock = CalmLens::MockServerClient.new(moderate: ->(_input) { 'blocked' })
    asset = mock.assets.classify(name: 'note.txt', content: { data: 'hello', type: 'text/plain' }, processing_options: KEEP)
    assert_equal %w[completed blocked stored],
                 [asset.dig('classification', 'status'), asset.dig('classification', 'moderation', 'status'),
                  asset.dig('content', 'status')]
    assert_equal 403, mock.cdn.serve(asset_id: asset['id']).status
    assert mock.state.content.key?(asset['id'])
  end

  def test_a_rerun_replaces_the_decision_only_with_a_new_one
    outcome = 'blocked'
    mock = CalmLens::MockServerClient.new(moderate: ->(input) { input.trigger == 'rerun' ? outcome : 'allowed' })
    asset = mock.assets.classify(name: 'note.txt', content: { data: 'hello', type: 'text/plain' }, processing_options: KEEP)
    # The response is the asset as the re-run found it; the new decision follows.
    rerun = mock.assets.explain(asset_id: asset['id'], rerun: true)
    assert_equal 'allowed', rerun.dig('classification', 'moderation', 'status')
    assert_equal 'blocked', mock.assets.retrieve(asset_id: asset['id']).dig('classification', 'moderation', 'status')
    # A failed re-run keeps the decision and records no processing events.
    outcome = 'failed'
    mock.assets.explain(asset_id: asset['id'], rerun: true)
    stored = mock.assets.retrieve(asset_id: asset['id'])
    assert_equal %w[completed blocked], [stored.dig('classification', 'status'), stored.dig('classification', 'moderation', 'status')]
    assert_equal 'asset.rerun-requested', mock.state.events.last['type']
    error = assert_raises(CalmLens::InvalidArgumentError) { mock.complete_processing(asset['id']) }
    assert_equal 'sdk/invalid-argument', error.code
  end

  def test_cdn_serves_transformed_urls_and_signed_urls_carry_the_serialized_selector_beneath_the_grant
    mock = CalmLens::MockServerClient.new(api_key: DOWNLOAD)
    asset = mock.assets.classify(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, processing_options: KEEP)
    transform = { width: 10, border: { color: '#fff' } }
    assert_equal 'hello', mock.cdn.serve(asset_id: asset['id'], transform: transform).body
    assert_equal "/assets/project-1/#{asset['id']}/rendered/border.color=fff,width=10", mock.requests.last.path
    signed = mock.cdn.sign_asset_url(asset_id: asset['id'], resource: 'rendered', transform: transform)['url']
    fetched = mock.fetch_cdn(signed)
    assert_equal [200, 'hello'], [fetched.status, fetched.body]
    assert_match %r{\A/assets/project-1/sig_\h+/rendered/border\.color=fff,width=10\z}, mock.requests.last.path
  end

  def test_a_signed_asset_url_expires_and_the_cdn_then_refuses_it
    now = 1_760_000_000_000
    mock = CalmLens::MockServerClient.new(now: -> { now })
    asset = mock.assets.classify(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, processing_options: KEEP)
    signed = mock.cdn.sign_asset_url(asset_id: asset['id'], expires_in: 60)
    assert_equal now + 60_000, signed['expiresAt']
    assert_equal 200, mock.fetch_cdn("#{signed['url']}/rendered").status
    now += 60_000
    expired = mock.fetch_cdn("#{signed['url']}/rendered")
    assert_equal [403, 'signed-url/expired'], [expired.status, JSON.parse(expired.body)['code']]
    error = assert_raises(CalmLens::PermissionDeniedError) { mock.cdn.get_asset_info(signed['url']) }
    assert_equal 'signed-url/expired', error.code
  end

  def test_fetch_cdn_sends_no_api_key_where_serve_sends_it
    mock = CalmLens::MockServerClient.new(api_key: DOWNLOAD)
    asset = mock.assets.classify(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, processing_options: KEEP)
    assert_equal 200, mock.cdn.serve(asset_id: asset['id']).status
    refused = mock.fetch_cdn(mock.cdn.get_asset_url(asset_id: asset['id'], resource: 'rendered'))
    assert_equal [404, 'asset/not-found'], [refused.status, JSON.parse(refused.body)['code']]
    assert_equal [DOWNLOAD, nil], mock.requests.map { |request| request.headers['X-Api-Key'] }.last(2)
  end

  def test_cdn_serve_passes_the_age_restricted_parameter_and_rejects_non_booleans
    mock = CalmLens::MockServerClient.new(api_key: DOWNLOAD)
    asset = mock.assets.classify(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, processing_options: KEEP)
    served = mock.cdn.serve(asset_id: asset['id'], lens: 'thumb', viewer_claims: { age_confirmed: true })
    request = mock.requests.last
    assert_equal ["/assets/project-1/#{asset['id']}/rendered/@thumb", { 'viewerClaims' => '{"ageConfirmed":true}' }],
                 [request.path, request.query]
    assert_equal 200, served.status
    error = assert_raises(CalmLens::InvalidArgumentError) { mock.cdn.get_asset_url(asset_id: asset['id'], viewer_claims: { age_confirmed: 'yes' }) }
    assert_equal 'sdk/invalid-argument', error.code
  end

  def test_decided_audio_renders_as_m4a_with_a_waveform_preview_until_its_content_is_removed
    mock = CalmLens::MockServerClient.new(api_key: DOWNLOAD)
    asset = mock.assets.classify(name: 'take.wav', content: { data: 'hello', type: 'audio/wav' }, processing_options: KEEP)
    assert_equal({ 'kind' => 'audio', 'format' => 'audio/mp4', 'width' => nil, 'height' => nil, 'peaks' => [] },
                 asset.dig('content', 'rendered'))
    assert_equal [1200, 300, '#7f7f7f'], asset.dig('content', 'preview').values_at('width', 'height', 'averageColor')
    rendered = mock.cdn.serve(asset_id: asset['id'])
    assert_equal [200, 'hello', 'audio/mp4'], [rendered.status, rendered.body, rendered.headers['content-type']]
    preview = mock.cdn.serve(asset_id: asset['id'], resource: 'preview')
    assert_equal [200, 'image/png'], [preview.status, preview.headers['content-type']]

    removed = mock.assets.remove_content(asset_id: asset['id'])
    assert_equal [nil, nil], removed['content'].values_at('rendered', 'preview')
    assert_equal 'asset/not-available', JSON.parse(mock.cdn.serve(asset_id: asset['id'], resource: 'placeholder').body)['code']
  end

  def test_a_safety_hold_refuses_every_cdn_resource_and_the_timeline
    mock = CalmLens::MockServerClient.new(api_key: DOWNLOAD)
    asset = mock.assets.classify(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, processing_options: KEEP)
    assert_equal 200, mock.cdn.serve(asset_id: asset['id'], resource: 'placeholder').status
    mock.state.assets[asset['id']]['content']['safetyHold'] = { 'placedAt' => 1, 'reason' => 'suspected-illegal-content' }

    %w[original rendered preview hls embed placeholder].each do |resource|
      served = mock.cdn.serve(asset_id: asset['id'], resource: resource)
      assert_equal [403, 'asset/not-available'], [served.status, JSON.parse(served.body)['code']], resource
    end
    error = assert_raises(CalmLens::APIError) { mock.assets.list_timeline(asset_id: asset['id']) }
    assert_equal ['asset/held', 423, { 'hold' => 'safety' }], [error.code, error.status, error.details]
  end

  def test_the_mock_prepares_no_hls_stream_and_the_embed_page_takes_no_selector_and_shows_any_asset
    mock = CalmLens::MockServerClient.new
    video = mock.assets.classify(name: 'clip.mp4', content: { data: 'hello', type: 'video/mp4' }, processing_options: KEEP,
                                 visibility: 'public')
    assert_nil video['content']['hls']
    base = "#{mock.cdn_base_url}/assets/project-1"
    # The client builds only the master playlist's URL and refuses a selector on the embed page, so
    # these requests go straight to the mock's transport. The selector is refused before the asset is
    # looked up; the stream has neither a master nor a media playlist.
    [["#{base}/missing/embed/@thumbnail", 400, 'transform/invalid'],
     ["#{base}/#{video['id']}/hls/index.m3u8", 404, 'asset/no-rendered-version'],
     ["#{base}/#{video['id']}/hls/video-720p.m3u8", 404, 'asset/no-rendered-version']].each do |url, status, code|
      response = mock.send(:receive, CalmLens::Transport::Request.new(method: 'GET', url: url, headers: {}, body: nil))
      assert_equal [status, code], [response.status, JSON.parse(response.body)['code']], url
    end
    # Unlike the stream, the embed page serves every asset type that may be delivered.
    sheet = mock.assets.classify(name: 'sheet.csv', content: { data: 'a,b', type: 'text/csv' }, processing_options: KEEP,
                                 visibility: 'public')
    [video, sheet].each do |asset|
      embed = mock.cdn.serve(asset_id: asset['id'], resource: 'embed', init: { method: 'HEAD' })
      assert_equal [200, 'text/html; charset=utf-8', ''], [embed.status, embed.headers['content-type'], embed.body], asset['name']
    end
  end

  def test_hash_list_entries_take_an_assets_hash_and_go_with_their_list
    mock = CalmLens::MockServerClient.new
    list = mock.hash_lists.create(name: 'Removed images', action: 'flag')
    asset = mock.assets.classify(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' })
    error = assert_raises(CalmLens::APIError) { mock.hash_lists.add_entry(hash_list_id: list['id'], asset_id: asset['id']) }
    assert_equal ['hash-list/asset-not-hashed', 409], [error.code, error.status]

    mock.state.assets[asset['id']]['content'].merge!('perceptualHash' => 'ab' * 32, 'perceptualHashQuality' => 80)
    entry = mock.hash_lists.add_entry(hash_list_id: list['id'], asset_id: asset['id'], label: 'Report 1042')
    assert_equal ['ab' * 32, 80, asset['id'], 'Report 1042'], entry.values_at('hash', 'quality', 'assetId', 'label')
    again = mock.hash_lists.add_entry(hash_list_id: list['id'], hash: 'AB' * 32)
    assert_equal [entry['id'], 1], [again['id'], mock.state.hash_list_entries.size]

    mock.hash_lists.delete(hash_list_id: list['id'])
    assert_empty mock.state.hash_list_entries
    error = assert_raises(CalmLens::APIError) { mock.hash_lists.remove_entry(entry_id: entry['id']) }
    assert_equal ['hash-list-entry/not-found', 404], [error.code, error.status]
    error = assert_raises(CalmLens::APIError) { mock.hash_lists.list_entries(hash_list_id: list['id']) }
    assert_equal 'hash-list/not-found', error.code
  end

  def test_uploads_store_their_tags_from_a_raw_upload_or_a_url
    mock = CalmLens::MockServerClient.new
    uploaded = mock.assets.create(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, tags: %w[catalogue backpacks])
    site = mock.assets.create(name: 'site', url: 'https://example.com', tags: ['landing'])
    assert_equal %w[catalogue backpacks], uploaded['tags']
    assert_equal ['landing'], mock.assets.retrieve(asset_id: site['id'])['tags']
  end

  def test_a_decision_through_the_api_is_recorded_as_the_api_keys_without_a_name_or_email
    mock = CalmLens::MockServerClient.new
    asset = mock.assets.classify(name: 'note.txt', content: { data: 'hello', type: 'text/plain' })
    blocked = mock.assets.decide(asset_id: asset['id'], decision: 'blocked', note: '  Spam  ')
    reviews = blocked.dig('classification', 'moderation', 'manualReviews')
    assert_equal([{ 'decision' => 'blocked', 'note' => 'Spam', 'decidedBy' => { 'type' => 'api-key', 'id' => nil }, 'applied' => true }],
                 reviews.map { |review| review.except('id', 'reviewedAt') })
    assert_match(/\Arev/, reviews.first['id'])
    assert_kind_of Integer, reviews.first['reviewedAt']
  end

  def test_wait_for_decision_checks_the_mock_storage
    mock = CalmLens::MockServerClient.new
    asset = mock.assets.create(name: 'later.txt', content: { plain_text: 'x', type: 'text/plain' })
    error = assert_raises(CalmLens::TimeoutError) { mock.assets.wait_for_decision(asset_id: asset['id'], timeout: 0) }
    assert_equal ['sdk/timeout', { 'assetId' => asset['id'], 'classificationStatus' => 'processing', 'moderationStatus' => 'pending' }],
                 [error.code, error.details]

    on_pause = -> { mock.state.assets[asset['id']]['classification']['status'] = 'failed' }
    mock.assets.define_singleton_method(:sleep) { |_| on_pause.call }
    before = mock.requests.size
    failed = mock.assets.wait_for_decision(asset_id: asset['id'])
    assert_equal [asset['id'], 'failed'], [failed['id'], failed.dig('classification', 'status')]
    assert_equal([['GET', "/assets/#{asset['id']}"]] * 2, mock.requests.drop(before).map { |request| [request.method, request.path] })

    other = mock.assets.create(name: 'other.txt', content: { plain_text: 'x', type: 'text/plain' })
    # A decision on an asset still processing keeps it waiting until processing completes.
    stored = mock.state.assets[other['id']]['classification']
    steps = [-> { stored['moderation']['status'] = 'age-restricted' }, -> { stored['status'] = 'completed' }]
    on_pause = -> { steps.shift.call }
    before = mock.requests.size
    decided = mock.assets.wait_for_decision(asset_id: other['id'])
    assert_equal [other['id'], 'completed', 'age-restricted'],
                 [decided['id'], decided.dig('classification', 'status'), decided.dig('classification', 'moderation', 'status')]
    assert_equal([['GET', "/assets/#{other['id']}"]] * 3, mock.requests.drop(before).map { |request| [request.method, request.path] })

    error = assert_raises(CalmLens::NotFoundError) { mock.assets.wait_for_decision(asset_id: 'missing') }
    assert_equal CalmLens::ErrorCodes::ASSET_NOT_FOUND, error.code
  end

  def test_filters_sort_and_pagination_are_applied
    clock = 0
    mock = CalmLens::MockServerClient.new(now: -> { clock += 1 }, moderate: lambda { |input|
      input.asset['name'].start_with?('bad') ? 'blocked' : 'allowed'
    })
    %w[good-b bad-a good-a good-c].each { |name| mock.assets.classify(name: name, content: { plain_text: name, type: 'text/plain' }) }

    page = mock.assets.list(filter: 'classification.moderation.status==allowed', sort: 'createdAt', page_size: 2)
    assert_equal [%w[good-b good-a], true], [page['items'].map { |asset| asset['name'] }, page['hasMore']]
    assert_equal(%w[good-c good-a bad-a good-b], mock.assets.each.map { |asset| asset['name'] })
    either = mock.assets.list(filter: 'classification.moderation.status==blocked,name==good-c', sort: 'createdAt')
    assert_equal(%w[bad-a good-c], either['items'].map { |asset| asset['name'] })
    ascending = mock.assets.each(filter: 'name==good-*;classification.moderation.status!=blocked', page_size: 1, sort: 'createdAt')
    assert_equal(%w[good-b good-a good-c], ascending.map { |asset| asset['name'] })
    by_name = lambda do |filter|
      mock.assets.each(filter: filter, sort: 'createdAt').map { |asset| asset['name'] }
    end
    created = mock.assets.each.to_h { |asset| [asset['name'], asset['createdAt']] }
    assert_equal %w[bad-a good-c], by_name.call("name=in=(bad-a,\"good-c\");createdAt>#{created['good-b']}")
    assert_equal %w[good-b good-a], by_name.call('name=out=(bad-a,good-c)')
    assert_equal %w[good-b bad-a], by_name.call("createdAt<=#{created['bad-a']}")
  end

  def test_mock_errors_always_carry_a_details_object_and_request_id
    error = assert_raises(CalmLens::NotFoundError) { CalmLens::MockServerClient.new.assets.retrieve(asset_id: 'missing') }
    assert_equal [{}, 'mock-request-1'], [error.details, error.request_id]
  end

  def test_mock_events_have_the_public_event_fields
    mock = CalmLens::MockServerClient.new
    cursor = mock.events.list['nextCursor']
    mock.enqueue_event(type: 'api-key.created')
    event = mock.events.list(cursor: cursor)['items'].first
    assert_equal %w[actor asset assetId assetSequence createdAt description facts id projectId severity title type], event.keys.sort
    assert_equal({ 'type' => 'api-key', 'id' => nil }, event['actor'])
    assert_equal [nil, nil, nil, nil], event.values_at('description', 'assetId', 'assetSequence', 'asset')
    assert_equal event, CalmLens.to_webhook_event_payload(event)
  end

  def test_each_mock_event_names_who_caused_it
    mock = CalmLens::MockServerClient.new
    cursor = mock.events.list['nextCursor']
    asset = mock.assets.classify(name: 'note.txt', content: { data: 'hello', type: 'text/plain' }, processing_options: KEEP)
    mock.assets.decide(asset_id: asset['id'], decision: 'blocked', note: 'Spam')
    mock.decide(asset['id'], 'allowed')
    mock.enqueue_event(type: 'api-key.created', actor: { type: 'user', id: 'user_8fK2mQx7Lp4NvB3tRz9Y' })
    events = mock.events.list(cursor: cursor)['items']
    assert_equal([%w[asset.uploaded api-key], %w[asset.classified automated], %w[asset.allowed automated],
                  %w[asset.blocked api-key], %w[asset.allowed user], %w[api-key.created user]],
                 events.map { |event| [event['type'], event['actor']['type']] })
    assert_equal([nil, nil, nil, nil, nil, 'user_8fK2mQx7Lp4NvB3tRz9Y'], events.map { |event| event['actor']['id'] })
    keys = events.flat_map { |event| event['facts'].map { |fact| fact['key'] } }
    refute_includes keys, 'decided-by'
    refute_includes keys, 'reviewer-user-id'
  end

  def test_the_events_feed_refuses_an_unknown_type_and_a_malformed_asset_id
    mock = CalmLens::MockServerClient.new
    { { types: ['not a type'] } => 'types', { asset_id: 'fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P' } => 'assetId' }.each do |options, path|
      error = assert_raises(CalmLens::BadRequestError, path) { mock.events.list(options) }
      assert_equal 'validation/invalid-request', error.code
      assert_equal([path], error.details['issues'].map { |issue| issue['path'] })
    end
  end

  def test_queued_responses_come_first_then_the_fake_answers
    mock = CalmLens::MockServerClient.new
    mock.enqueue(status: 503, body: { code: 'server/unavailable', message: 'Busy' }, headers: { 'x-request-id' => 'req-1' })
    error = assert_raises(CalmLens::ServerError) { mock.assets.list }
    assert_equal ['server/unavailable', 503, 'req-1', '[calmlens] Busy'], [error.code, error.status, error.request_id, error.message]
    assert_equal 0, mock.assets.list['items'].length
  end

  def test_enqueued_errors_are_wrapped_like_network_failures
    mock = CalmLens::MockServerClient.new.enqueue_error(Net::ReadTimeout.new).enqueue_error(Errno::ECONNREFUSED.new)
    assert_equal 'sdk/timeout', assert_raises(CalmLens::TimeoutError) { mock.events.list }.code
    assert_equal 'sdk/transport-error', assert_raises(CalmLens::ConnectionError) { mock.events.list }.code
    assert_equal 2, mock.requests.size
  end

  def test_a_moderate_answer_that_is_not_a_decision_is_refused
    [nil, 'maybe', :blocked].each do |answer|
      mock = CalmLens::MockServerClient.new(moderate: ->(_input) { answer })
      error = assert_raises(CalmLens::InvalidArgumentError, answer.inspect) do
        mock.assets.classify(name: 'note.txt', content: { plain_text: 'hi', type: 'text/plain' })
      end
      assert_equal 'sdk/invalid-argument', error.code
    end
    error = assert_raises(CalmLens::InvalidArgumentError) { CalmLens::MockServerClient.new(moderate: 'blocked') }
    assert_equal 'sdk/invalid-argument', error.code
  end

  def test_decisions_take_symbol_qualifiers_and_refuse_scores_that_are_not_finite
    decision = CalmLens::MockDecision.of('blocked').flag(:violence, 0.9, 'violence-threat': 0.7)
    assert_equal({ 'violence-threat' => { 'status' => 'evaluated', 'someScore' => 0.7, 'likelihood' => 'likely' } },
                 decision.report.dig('raw', 'categories', 'violence', 'qualifiers'))
    [Float::NAN, Float::INFINITY, '0.5', Complex(0.5, 0)].each do |score|
      error = assert_raises(CalmLens::InvalidArgumentError, score.inspect) { CalmLens::MockDecision.of('blocked').flag('hate', score) }
      assert_equal 'sdk/invalid-argument', error.code
    end
  end

  def test_fail_next_request_refuses_partial_seconds_and_details_for_an_exception
    mock = CalmLens::MockServerClient.new
    [-> { mock.fail_next_request(Errno::ECONNRESET.new, details: { 'reason' => 'reset' }) },
     -> { mock.fail_next_request(Errno::ECONNRESET.new, retry_after: 1) },
     -> { mock.fail_next_request('upload/website-rate-limit-reached', retry_after: 1.5) },
     -> { mock.fail_next_request('upload/website-rate-limit-reached', retry_after: -1) }].each do |queue|
      assert_equal 'sdk/invalid-argument', assert_raises(CalmLens::InvalidArgumentError) { queue.call }.code
    end
    # Nothing was queued, so the next request reaches the API.
    assert_empty mock.assets.list['items']
    mock.fail_next_request('timeout', operation: 'assets.upload_part')
    assert_empty mock.assets.list['items']
  end

  def test_requests_are_snapshots
    mock = CalmLens::MockServerClient.new
    mock.assets.classify(name: 'text', content: { plain_text: 'hi', type: 'text/plain' })
    mock.requests[0].body.replace('changed')
    assert_equal 'hi', mock.requests[0].json.dig('content', 'plainText')
    assert_empty CalmLens::MockServerClient.new.requests
  end

  PRIVATE_FIELDS = { description: 'Private description', author_id: 'pupil-7',
                     context: { items: [{ text: 'Another pupil wrote this', author_id: 'pupil-8' }] } }.freeze
  EARLIER_POSTS = { 'items' => [{ 'text' => 'Another pupil wrote this', 'authorId' => 'pupil-8' }] }.freeze

  # Upload fields such as earlier posts, author IDs and descriptions travel in the body, so a
  # request's recorded query (and URL) holds only transport values.
  def test_uploads_send_their_fields_in_the_body_and_only_transport_values_in_the_query
    mock = CalmLens::MockServerClient.new
    text = mock.text.classify(text: 'Same to you', **PRIVATE_FIELDS)
    file = mock.assets.create(name: 'photo.png', content: { data: 'hello', type: 'image/png' }, **PRIVATE_FIELDS)
    sent_text, sent_file = mock.requests

    assert_equal [{ 'wait' => 'true' }, { 'wait' => 'false', 'contentType' => 'image/png', 'sizeInBytes' => '5' }],
                 [sent_text.query, sent_file.query]
    [sent_text, sent_file].each do |request|
      ['Private description', 'pupil-7', 'pupil-8', 'Another pupil'].each do |value|
        refute_includes URI.decode_www_form_component(request.url), value
      end
    end
    assert_equal [{ 'plainText' => 'Same to you', 'type' => 'text/plain' }, 'pupil-7', EARLIER_POSTS],
                 sent_text.json.values_at('content', 'authorId', 'context')
    assert_nil sent_text.form
    assert_equal({ 'options' => { 'name' => 'photo.png', 'description' => 'Private description', 'authorId' => 'pupil-7',
                                  'context' => EARLIER_POSTS },
                   'file' => 'hello' }, sent_file.form)
    [text, file].each { |asset| assert_equal ['Private description', 'pupil-7'], asset.values_at('description', 'authorId') }
  end

  def form_body(boundary, options, file)
    "--#{boundary}\r\nContent-Disposition: form-data; name=\"options\"\r\nContent-Type: application/json\r\n\r\n" \
      "#{JSON.generate(options)}\r\n--#{boundary}\r\nContent-Disposition: form-data; name=\"file\"\r\n" \
      "Content-Type: image/png\r\n\r\n#{file}\r\n--#{boundary}--\r\n"
  end

  # Sends a request to the mock as a client of another SDK would, and returns the response.
  def raw_upload(mock, query, body, content_type, key: nil)
    headers = { 'X-Api-Key' => mock.instance_variable_get(:@api_key), 'Content-Type' => content_type,
                'X-CalmLens-Upload' => 'content' }
    headers['Idempotency-Key'] = key if key
    request = CalmLens::Transport::Request.new(method: 'POST', url: "#{mock.base_url}/projects/project-1/assets?#{query}",
                                               headers: headers, body: body)
    mock.send(:receive, request)
  end

  def test_the_mock_refuses_upload_fields_in_the_query_before_storing_anything
    mock = CalmLens::MockServerClient.new
    form = form_body('b1', { name: 'photo.png' }, 'hello')
    response = raw_upload(mock, 'wait=false&contentType=image%2Fpng&context=%7B%7D&authorId=pupil-7', form,
                          'multipart/form-data; boundary=b1')
    body = JSON.parse(response.body)
    assert_equal [400, CalmLens::ErrorCodes::UPLOAD_OPTIONS_IN_QUERY, { 'fields' => %w[authorId context] }],
                 [response.status, body['code'], body['details']]
    assert_empty mock.state.assets
  end

  def test_the_mock_refuses_a_raw_upload_that_is_not_an_upload_form
    mock = CalmLens::MockServerClient.new
    response = raw_upload(mock, 'wait=false&contentType=image%2Fpng', 'hello', 'image/png')
    assert_equal [415, CalmLens::ErrorCodes::UNSUPPORTED_CONTENT_TYPE], [response.status, JSON.parse(response.body)['code']]
    assert_empty mock.state.assets
  end

  # Like the API, a retried upload form matches by its options and file, not its boundary.
  def test_an_upload_form_retried_with_a_new_boundary_replays_and_other_options_reuse_the_key
    mock = CalmLens::MockServerClient.new
    query = 'wait=false&contentType=image%2Fpng'
    first = raw_upload(mock, query, form_body('b1', { name: 'a.png' }, 'hello'), 'multipart/form-data; boundary=b1', key: 'k1')
    again = raw_upload(mock, query, form_body('b2', { name: 'a.png' }, 'hello'), 'multipart/form-data; boundary=b2', key: 'k1')
    other = raw_upload(mock, query, form_body('b3', { name: 'b.png' }, 'hello'), 'multipart/form-data; boundary=b3', key: 'k1')

    assert_equal [200, 'true'], [again.status, again.headers['idempotent-replayed']]
    assert_equal JSON.parse(first.body)['id'], JSON.parse(again.body)['id']
    assert_equal CalmLens::ErrorCodes::IDEMPOTENCY_KEY_REUSED, JSON.parse(other.body)['code']
    assert_equal 1, mock.state.assets.size
  end
end
