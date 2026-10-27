# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens/testing'

class MockTest < Minitest::Test
  KEEP = { keep_content_after_processing: true }.freeze
  # A key that may read private content from the CDN; the default key may not.
  DOWNLOAD = CalmLens::MockServerClient.create_api_key([{ actions: ['assets:download'], folder_id: nil, include_subfolders: true }])

  def test_blocked_assets_keep_content_but_are_not_served
    mock = CalmLens::MockServerClient.new(analyzed_outcome: { 'classification' => { 'moderation' => { 'status' => 'blocked' } } })
    asset = mock.assets.classify(name: 'note.txt', content: { data: 'hello', type: 'text/plain' }, processing_options: KEEP)
    assert_equal %w[completed blocked stored],
                 [asset.dig('classification', 'status'), asset.dig('classification', 'moderation', 'status'),
                  asset.dig('content', 'status')]
    assert_equal 403, mock.cdn.serve(asset_identifier: asset['id']).status
    assert mock.state.content.key?(asset['id'])
  end

  def test_cdn_serves_transformed_urls_and_signed_urls_carry_the_serialized_selector
    mock = CalmLens::MockServerClient.new(api_key: DOWNLOAD)
    asset = mock.assets.classify(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' }, processing_options: KEEP)
    transform = { type: 'imageTransform', options: { width: 10, border: { color: '#fff' } } }
    assert_equal 'hello', mock.cdn.serve(asset_identifier: asset['id'], transform: transform).body
    assert_equal "/assets/project-1/#{asset['id']}/rendered/border.color=fff,width=10", mock.requests.last.path
    signed = URI(mock.assets.create_signed_url(asset_id: asset['id'], transform: transform)['url'])
    assert_equal 'border.color=fff,width=10', URI.decode_www_form(signed.query).to_h['transform']
  end

  def test_cdn_serve_passes_the_age_restricted_parameter_and_rejects_non_booleans
    mock = CalmLens::MockServerClient.new(api_key: DOWNLOAD)
    asset = mock.assets.classify(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' }, processing_options: KEEP)
    served = mock.cdn.serve(asset_identifier: asset['id'], lens: 'thumb', age_confirmed: true)
    request = mock.requests.last
    assert_equal ["/assets/project-1/#{asset['id']}/rendered/@thumb", { 'ageConfirmed' => 'true' }], [request.path, request.query]
    assert_equal 200, served.status
    error = assert_raises(CalmLens::InvalidArgumentError) { mock.cdn.get_asset_url(asset_identifier: asset['id'], age_confirmed: 'yes') }
    assert_equal 'sdk/invalid-argument', error.code
  end

  def test_hash_list_entries_take_an_assets_hash_and_go_with_their_list
    mock = CalmLens::MockServerClient.new
    list = mock.hash_lists.create(name: 'Removed images', action: 'flag')
    asset = mock.assets.classify(name: 'note.txt', content: { plain_text: 'hello', type: 'text/plain' })
    error = assert_raises(CalmLens::APIError) { mock.hash_lists.add_entry(hash_list_id: list['id'], asset_id: asset['id']) }
    assert_equal ['hash-list/asset-not-hashed', 409], [error.code, error.status]

    mock.state.assets[asset['id']]['content']['image'] = { 'perceptualHash' => 'ab' * 32, 'perceptualHashQuality' => 80 }
    entry = mock.hash_lists.add_entry(hash_list_id: list['id'], asset_id: asset['id'], label: 'Report 1042')
    assert_equal ['ab' * 32, 80, asset['id'], 'Report 1042'], entry.values_at('hash', 'quality', 'sourceAssetId', 'label')
    again = mock.hash_lists.add_entry(hash_list_id: list['id'], hash: 'AB' * 32)
    assert_equal [entry['id'], 1], [again['id'], mock.state.hash_list_entries.size]

    mock.hash_lists.delete(hash_list_id: list['id'])
    assert_empty mock.state.hash_list_entries
    error = assert_raises(CalmLens::APIError) { mock.hash_lists.remove_entry(entry_id: entry['id']) }
    assert_equal ['hash-list/entry-not-found', 404], [error.code, error.status]
    error = assert_raises(CalmLens::APIError) { mock.hash_lists.list_entries(hash_list_id: list['id']) }
    assert_equal 'hash-list/not-found', error.code
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
    on_pause = -> { mock.state.assets[other['id']]['classification']['moderation']['status'] = 'age-restricted' }
    before = mock.requests.size
    decided = mock.assets.wait_for_decision(asset_id: other['id'])
    assert_equal [other['id'], 'age-restricted'], [decided['id'], decided.dig('classification', 'moderation', 'status')]
    assert_equal([['GET', "/assets/#{other['id']}"]] * 2, mock.requests.drop(before).map { |request| [request.method, request.path] })

    error = assert_raises(CalmLens::NotFoundError) { mock.assets.wait_for_decision(asset_id: 'missing') }
    assert_equal CalmLens::ErrorCodes::ASSET_NOT_FOUND, error.code
  end

  def test_filters_ordering_and_pagination_are_applied
    clock = 0
    mock = CalmLens::MockServerClient.new(now: -> { clock += 1 }, analyzed_outcome: lambda { |asset|
      asset['name'].start_with?('bad') ? 'blocked' : 'allowed'
    })
    %w[good-b bad-a good-a good-c].each { |name| mock.assets.classify(name: name, content: { plain_text: name, type: 'text/plain' }) }

    page = mock.assets.list(filter: 'classification.moderation.status==allowed', ordering: [{ field: 'createdAt', direction: 'ASC' }],
                            page_size: 2)
    assert_equal [%w[good-b good-a], true], [page['items'].map { |asset| asset['name'] }, page['hasMore']]
    assert_equal(%w[good-c good-a bad-a good-b], mock.assets.each.map { |asset| asset['name'] })
    either = mock.assets.list(filter: 'classification.moderation.status==blocked,name==good-c',
                              ordering: [{ field: 'createdAt', direction: 'ASC' }])
    assert_equal(%w[bad-a good-c], either['items'].map { |asset| asset['name'] })
    ascending = mock.assets.each(filter: 'name==good-*;classification.moderation.status!=blocked', page_size: 1,
                                 ordering: [{ field: 'createdAt', direction: 'ASC' }])
    assert_equal(%w[good-b good-a good-c], ascending.map { |asset| asset['name'] })
    by_name = lambda do |filter|
      mock.assets.each(filter: filter, ordering: [{ field: 'createdAt', direction: 'ASC' }]).map { |asset| asset['name'] }
    end
    created = mock.assets.each.to_h { |asset| [asset['name'], asset['createdAt']] }
    assert_equal %w[bad-a good-c], by_name.call("name=in=(bad-a,\"good-c\");createdAt=gt=#{created['good-b']}")
    assert_equal %w[good-b good-a], by_name.call('name=out=(bad-a,good-c)')
    assert_equal %w[good-b bad-a], by_name.call("createdAt=le=#{created['bad-a']}")
    error = assert_raises(CalmLens::InvalidArgumentError) { mock.assets.list(filter: 'name=like=good') }
    assert_equal 'sdk/invalid-argument', error.code
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
    mock.assets.classify(name: 'text', content: { plain_text: 'hi', type: 'text/plain' })
    mock.requests[0].body.replace('changed')
    assert_equal 'hi', mock.requests[0].body
    assert_empty CalmLens::MockServerClient.new.requests
  end
end
