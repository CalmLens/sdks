# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens/testing'

# What the shared contract fixtures don't reach: Ruby's snake_case definitions, and the in-memory
# API's replace, ordering and revision rules for project configuration.
class ProjectConfigurationTest < Minitest::Test
  # Snake_case option names reach the API inside each definition, and a conflict names the stored revision.
  def test_upload_presets_take_snake_case_definitions_and_iterate_oldest_first
    clock = 0
    mock = CalmLens::MockServerClient.new(now: -> { clock += 1 })
    stored = mock.upload_presets.ensure(upload_presets: [{ key: 'a', name: 'A', allowed_content_types: %w[image/* image/*],
                                                           daily_upload_limit: 5, access: 'anyone' }])
    first = stored['uploadPresets'].first
    assert_equal [%w[image/*], 5, 'anyone'], first.values_at('allowedContentTypes', 'dailyUploadLimit', 'access')

    mock.upload_presets.ensure(upload_presets: [{ key: 'b', name: 'B' }])
    assert_equal(%w[a b], mock.upload_presets.each.map { |item| item['key'] })
    assert_equal(%w[b a], mock.upload_presets.list(sort: '-createdAt')['items'].map { |item| item['key'] })

    conflict = assert_raises(CalmLens::Error) { mock.upload_presets.ensure(upload_presets: [{ key: 'a', name: 'A', revision: 0 }]) }
    assert_equal({ 'key' => 'a', 'revision' => 1 }, conflict.details)
    # A failed batch saves nothing, and a replacement resets what it leaves out.
    assert_raises(CalmLens::Error) do
      mock.upload_presets.ensure(upload_presets: [{ key: 'c', name: 'C' }, { key: 'a', name: 'A', revision: 9 }])
    end
    assert_equal(%w[a b], mock.upload_presets.each.map { |item| item['key'] })
    replaced = mock.upload_presets.ensure(upload_presets: [{ key: 'a', name: 'A' }])['uploadPresets'].first
    assert_equal [first['id'], 2, nil, 'token'], replaced.values_at('id', 'revision', 'allowedContentTypes', 'access')
  end

  # Settings and metadata fields share one revision, which only a real change moves.
  def test_settings_and_metadata_fields_share_a_revision_moved_only_by_a_change
    mock = CalmLens::MockServerClient.new
    changed = mock.project_settings.update(settings: { block_unmoderated_assets: false, human_review: { allowed_sample_percent: 5 } })
    assert_equal [2, false, 5, 0], [changed['revision'], changed.dig('settings', 'blockUnmoderatedAssets'),
                                    changed.dig('settings', 'humanReview', 'allowedSamplePercent'),
                                    changed.dig('settings', 'humanReview', 'restrictedSamplePercent')]
    same = mock.project_settings.update(settings: { block_unmoderated_assets: false, human_review: { allowed_sample_percent: 5 } })
    assert_equal 2, same['revision']
    # Settings left out return to their defaults.
    defaults = mock.project_settings.update(settings: {})
    assert_equal [3, true], [defaults['revision'], defaults.dig('settings', 'blockUnmoderatedAssets')]

    user = { id: 'userId', title: 'User', type: 'string', icon: 'user', color: '#2563eb' }
    order = { id: 'orderId', title: 'Order', type: 'string', icon: 'tag', color: '#16a34a' }
    assert_equal 4, mock.metadata_fields.ensure(fields: [user, order])['revision']
    assert_equal 4, mock.metadata_fields.ensure(fields: [order])['revision']
    renamed = mock.metadata_fields.ensure(revision: 4, fields: [user.merge(title: 'Account')])
    assert_equal [5, %w[userId orderId], 'Account'],
                 [renamed['revision'], renamed['fields'].map { |field| field['id'] }, renamed['fields'].first['title']]

    stale = assert_raises(CalmLens::Error) { mock.metadata_fields.delete(field_id: 'orderId', revision: 4) }
    assert_equal CalmLens::ErrorCodes::PROJECT_SETTINGS_REVISION_CONFLICT, stale.code
    assert_nil mock.metadata_fields.delete(field_id: 'orderId', revision: 5)
    left = mock.metadata_fields.list
    assert_equal [6, %w[userId]], [left['revision'], left['fields'].map { |field| field['id'] }]
  end
end
