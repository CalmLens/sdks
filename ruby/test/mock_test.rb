# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens/testing'

class MockTest < Minitest::Test
  def invoke(client, operation, options)
    parts = operation.split('.')
    target = parts.size == 1 ? client : client.public_send(parts.first)
    target.public_send(parts.last.gsub(/([a-z])([A-Z])/, '\1_\2').downcase, options)
  end

  def test_queued_responses_replay_every_request_contract
    JSON.parse(File.read(File.expand_path('../testdata/requests.json', __dir__), encoding: 'UTF-8')).each do |fixture|
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
  end

  KEEP = { keep_content_after_processing: true }.freeze

  def test_uploads_are_stored_retrieved_served_and_deleted
    mock = CalmLens::MockServerClient.new(now: -> { 7 })
    asset = mock.assets.moderate(name: 'note.txt', content: { data: StringIO.new('hello'), type: 'text/plain' },
                                 processing_options: KEEP)
    assert_equal [{ 'status' => 'done', 'updatedAt' => 7, 'uploadPartsReceived' => nil }, 'approved', 7, 'stored', 'text/plain', 5],
                 [asset['processing'], asset.dig('moderation', 'status'), asset.dig('moderation', 'decidedAt'),
                  asset.dig('content', 'status'), asset.dig('content', 'format'), asset.dig('content', 'sizeInBytes')]
    queued = mock.assets.create(name: 'later.txt', content: { plain_text: 'x', type: 'text/plain' })
    assert_equal %w[processing pending temporary],
                 [queued.dig('processing', 'status'), queued.dig('moderation', 'status'), queued.dig('content', 'status')]
    assert_equal asset, mock.assets.retrieve(asset_id: asset['id'])
    served = mock.cdn.serve(asset_identifier: asset['id'])
    assert_equal [200, 'hello', 'text/plain', '5'], [served.status, served.body, served.content_type, served.headers['content-length']]
    refute_nil served.request_id
    assert_equal "/assets/project-1/#{asset['id']}/content", mock.requests.last.path

    removed = mock.assets.delete_content(asset_id: asset['id'])
    assert_equal %w[removed requested], [removed.dig('content', 'status'), removed.dig('content', 'removalReason')]
    assert_equal 404, mock.cdn.serve(asset_identifier: asset['id']).status
    assert_nil mock.assets.delete(asset_id: asset['id'])
    error = assert_raises(CalmLens::NotFoundError) { mock.assets.retrieve(asset_id: asset['id']) }
    assert_equal [CalmLens::ErrorCodes::ASSET_NOT_FOUND, 404, true], [error.code, error.status, error.details['network']]
    refute_nil error.request_id
  end

  def test_content_without_keep_is_removed_once_processing_is_done
    mock = CalmLens::MockServerClient.new(now: -> { 9 })
    asset = mock.assets.moderate(name: 'note.txt', content: { data: 'hello', type: 'text/plain' })
    assert_equal [{ 'status' => 'removed', 'removalReason' => 'retention', 'updatedAt' => 9 }, 'done'],
                 [asset['content'].slice('status', 'removalReason', 'updatedAt'), asset.dig('processing', 'status')]
    assert_equal 404, mock.cdn.serve(asset_identifier: asset['id']).status
    refute mock.state.content.key?(asset['id'])
  end

  def test_rejected_hidden_assets_are_not_served
    mock = CalmLens::MockServerClient.new(analyzed_outcome: { 'moderation' => { 'status' => 'rejected', 'action' => 'hide' } })
    asset = mock.assets.moderate(name: 'note.txt', content: { data: 'hello', type: 'text/plain' }, processing_options: KEEP)
    assert_equal({ 'status' => 'rejected', 'action' => 'hide' }, asset['moderation'].slice('status', 'action'))
    assert_equal 403, mock.cdn.serve(asset_identifier: asset['id']).status
  end

  def test_retry_reprocesses_failed_assets_with_content
    mock = CalmLens::MockServerClient.new(analyzed_outcome: 'failed')
    failed = mock.assets.moderate(name: 'note.txt', content: { data: 'hello', type: 'text/plain' })
    assert_equal %w[failed pending temporary],
                 [failed.dig('processing', 'status'), failed.dig('moderation', 'status'), failed.dig('content', 'status')]
    retried = mock.assets.retry(asset_id: failed['id'])
    assert_equal %w[processing pending], [retried.dig('processing', 'status'), retried.dig('moderation', 'status')]
    assert_equal CalmLens::ErrorCodes::ASSET_NOT_RETRYABLE,
                 assert_raises(CalmLens::APIError) { mock.assets.retry(asset_id: failed['id']) }.code

    mock.state.assets[failed['id']]['processing']['status'] = 'failed'
    mock.assets.delete_content(asset_id: failed['id'])
    assert_equal CalmLens::ErrorCodes::ASSET_CONTENT_UNAVAILABLE,
                 assert_raises(CalmLens::APIError) { mock.assets.retry(asset_id: failed['id']) }.code
  end

  def test_cdn_serves_transformed_urls_and_signed_urls_carry_the_serialized_selector
    mock = CalmLens::MockServerClient.new
    asset = mock.assets.moderate(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' }, processing_options: KEEP)
    transform = { type: 'imageTransform', options: { width: 10, border: { color: '#fff' } } }
    assert_equal 'hello', mock.cdn.serve(asset_identifier: asset['id'], transform: transform).body
    assert_equal "/assets/project-1/#{asset['id']}/content/imageTransform[border%5Bcolor%5D=%23fff,width=10]", mock.requests.last.path
    signed = URI(mock.assets.create_signed_url(asset_id: asset['id'], transform: transform)['url'])
    assert_equal 'imageTransform[border%5Bcolor%5D=%23fff,width=10]', URI.decode_www_form(signed.query).to_h['transform']
  end

  def test_wait_for_decision_checks_the_mock_storage
    mock = CalmLens::MockServerClient.new
    asset = mock.assets.create(name: 'later.txt', content: { plain_text: 'x', type: 'text/plain' })
    error = assert_raises(CalmLens::TimeoutError) { mock.assets.wait_for_decision(asset_id: asset['id'], timeout: 0) }
    assert_equal ['sdk/timeout', { 'assetId' => asset['id'], 'processingStatus' => 'processing', 'moderationStatus' => 'pending' }],
                 [error.code, error.details]

    mock.assets.define_singleton_method(:sleep) { |_| mock.state.assets[asset['id']]['processing']['status'] = 'failed' }
    before = mock.requests.size
    failed = mock.assets.wait_for_decision(asset_id: asset['id'])
    assert_equal [asset['id'], 'failed'], [failed['id'], failed.dig('processing', 'status')]
    assert_equal([['GET', "/assets/#{asset['id']}"]] * 2, mock.requests.drop(before).map { |request| [request.method, request.path] })

    other = mock.assets.create(name: 'other.txt', content: { plain_text: 'x', type: 'text/plain' })
    mock.assets.define_singleton_method(:sleep) { |_| mock.state.assets[other['id']]['moderation']['status'] = 'approved' }
    before = mock.requests.size
    decided = mock.assets.wait_for_decision(asset_id: other['id'])
    assert_equal [other['id'], 'approved'], [decided['id'], decided.dig('moderation', 'status')]
    assert_equal([['GET', "/assets/#{other['id']}"]] * 2, mock.requests.drop(before).map { |request| [request.method, request.path] })

    error = assert_raises(CalmLens::NotFoundError) { mock.assets.wait_for_decision(asset_id: 'missing') }
    assert_equal CalmLens::ErrorCodes::ASSET_NOT_FOUND, error.code
  end

  def test_errors_use_the_api_status_for_each_code
    mock = CalmLens::MockServerClient.new
    folder = mock.folders.create(name: 'A')
    mock.assets.create(name: 'x', content: { plain_text: 'x', type: 'text/plain' }, folder_id: folder['id'])
    {
      -> { mock.folders.create(name: 'A') } => [CalmLens::ConflictError, 409, 'folder/duplicate-name'],
      -> { mock.folders.delete(folder_id: folder['id']) } => [CalmLens::ConflictError, 409, 'folder/not-empty'],
      -> { mock.folders.retrieve(folder_id: 'nope') } => [CalmLens::NotFoundError, 404, 'folder/not-found'],
      -> { mock.events.list(after: 'garbage') } => [CalmLens::BadRequestError, 400, 'events/invalid-cursor']
    }.each do |action, (klass, status, code)|
      error = assert_raises(klass) { action.call }
      assert_equal [status, code], [error.status, error.code]
    end
  end

  def test_filters_ordering_and_pagination_are_applied
    clock = 0
    mock = CalmLens::MockServerClient.new(now: -> { clock += 1 }, analyzed_outcome: lambda { |asset|
      asset['name'].start_with?('bad') ? 'rejected' : 'approved'
    })
    %w[good-b bad-a good-a good-c].each { |name| mock.assets.moderate(name: name, content: { plain_text: name, type: 'text/plain' }) }

    page = mock.assets.list(filter: 'moderation.status==approved', ordering: [{ field: 'createdAt', direction: 'ASC' }], page_size: 2)
    assert_equal [%w[good-b good-a], true], [page['items'].map { |asset| asset['name'] }, page['hasMore']]
    assert_equal(%w[good-c good-a bad-a good-b], mock.assets.each.map { |asset| asset['name'] })
    either = mock.assets.list(filter: 'moderation.status==rejected,name==good-c', ordering: [{ field: 'createdAt', direction: 'ASC' }])
    assert_equal(%w[bad-a good-c], either['items'].map { |asset| asset['name'] })
    ascending = mock.assets.each(filter: 'name==good-*;moderation.status!=rejected', page_size: 1,
                                 ordering: [{ field: 'createdAt', direction: 'ASC' }])
    assert_equal(%w[good-b good-a good-c], ascending.map { |asset| asset['name'] })
    error = assert_raises(CalmLens::InvalidArgumentError) { mock.assets.list(filter: 'createdAt=gt=5') }
    assert_equal 'sdk/invalid-argument', error.code
  end

  def test_search_matches_assets_and_reports_semantic_search_disabled
    mock = CalmLens::MockServerClient.new
    mock.assets.create(name: 'orchard.txt', content: { plain_text: 'x', type: 'text/plain' })
    mock.assets.create(name: 'other.txt', content: { plain_text: 'x', type: 'text/plain' })
    result = mock.assets.search(query: 'ORCHARD', mode: 'hybrid')
    assert_equal [['orchard.txt'], [['name']], 'disabled'],
                 [result['items'].map { |item| item['asset']['name'] }, result['items'].map do |item|
                   item['matchedFields']
                 end, result['semanticStatus']]
  end

  def test_events_are_enqueued_and_paged_with_cursors
    mock = CalmLens::MockServerClient.new
    start = mock.events.list
    assert_equal [], start['events']
    3.times { |index| mock.enqueue_event(type: 'asset.approved', asset_id: "asset-#{index}") }
    pages = mock.events.each_page(after: start['cursor'], limit: 2).to_a
    assert_equal([%w[asset-0 asset-1], %w[asset-2]], pages.map { |page| page['events'].map { |event| event['assetId'] } })
    assert_equal [], mock.events.list(after: pages.last['cursor'])['events']
    assert_equal(%w[asset-0 asset-1 asset-2], mock.events.each(after: start['cursor'], limit: 1).map { |event| event['assetId'] })
  end

  def test_multipart_upload_uses_queue_mode_saved_at_start
    mock = CalmLens::MockServerClient.new
    first = ('a' * (5 * 1024 * 1024)).b
    asset = mock.assets.create(name: 'big.txt', part: { data: first, type: 'text/plain' }, total_size_in_bytes: first.bytesize + 3)
    assert_equal ['uploading', 1], [asset.dig('processing', 'status'), asset.dig('processing', 'uploadPartsReceived')]
    done = mock.assets.upload_part(asset_id: asset['id'], part: { data: 'end', part_number: 2, is_final: true })
    assert_equal ['processing', 'pending', 2, first.bytesize + 3],
                 [done.dig('processing', 'status'), done.dig('moderation', 'status'), done.dig('processing', 'uploadPartsReceived'),
                  done.dig('content', 'sizeInBytes')]
    refute mock.requests.last.query.key?('queue')
    assert_equal 'upload/not-open', assert_raises(CalmLens::ConflictError) {
      mock.assets.upload_part(asset_id: asset['id'], part: { data: 'x', part_number: 3, is_final: true })
    }.code
  end

  def test_idempotent_uploads_replay_the_saved_response
    mock = CalmLens::MockServerClient.new
    options = { name: 'once.txt', content: { plain_text: 'x', type: 'text/plain' }, request_options: { idempotency_key: 'key-1' } }
    first = mock.assets.create(options)
    assert_equal first, mock.assets.create(options)
    assert_equal 1, mock.assets.list['items'].length
    error = assert_raises(CalmLens::ConflictError) { mock.assets.create(options.merge(name: 'other.txt')) }
    assert_equal 'idempotency/key-reused', error.code
  end

  def test_queued_responses_come_first_then_the_fake_answers
    mock = CalmLens::MockServerClient.new(max_retries: 0)
    mock.enqueue(status: 503, body: { code: 'server/unavailable', message: 'Busy' }, headers: { 'x-request-id' => 'req-1' })
    error = assert_raises(CalmLens::ServerError) { mock.assets.list }
    assert_equal ['server/unavailable', 503, 'req-1', '[calmlens] Busy'], [error.code, error.status, error.request_id, error.message]
    assert_equal 0, mock.assets.list['items'].length
  end

  def test_enqueued_errors_are_wrapped_like_network_failures
    mock = CalmLens::MockServerClient.new(max_retries: 0).enqueue_error(Net::ReadTimeout.new).enqueue_error(Errno::ECONNREFUSED.new)
    assert_equal 'sdk/timeout', assert_raises(CalmLens::TimeoutError) { mock.events.list }.code
    assert_equal 'sdk/transport-error', assert_raises(CalmLens::ConnectionError) { mock.events.list }.code
    assert_equal 2, mock.requests.size
  end

  def test_requests_are_snapshots
    mock = CalmLens::MockServerClient.new
    mock.assets.moderate(name: 'text', content: { plain_text: 'hi', type: 'text/plain' })
    mock.requests[0].body.replace('changed')
    assert_equal 'hi', mock.requests[0].body
    assert_empty CalmLens::MockServerClient.new.requests
  end
end
