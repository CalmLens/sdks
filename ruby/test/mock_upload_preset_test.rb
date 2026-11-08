# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'

# API-key uploads through a preset on the paths the shared scenarios don't reach: parts and URLs.
class MockUploadPresetTest < Minitest::Test
  def test_a_first_part_keeps_to_its_upload_preset_and_takes_its_visibility
    mock = CalmLens::MockServerClient.new(part_size_bytes: 5 * 1024 * 1024)
    presets = mock.upload_presets.ensure(upload_presets: [{ key: 'open', name: 'Open', visibility: 'public' },
                                                          { key: 'small', name: 'Small', max_size_in_bytes: 5_500_000 }])['uploadPresets']
    size = 6 * 1024 * 1024
    [{ data: 'x'.b * size, type: 'video/mp4' }, { plain_text: 'x' * size, type: 'text/plain' }].each do |content|
      asset = mock.assets.create(name: 'big', content: content, upload_preset_id: presets[0]['id'])
      assert_equal ['public', presets[0]['id']], asset.values_at('visibility', 'uploadPresetId')
      error = assert_raises(CalmLens::Error) { mock.assets.create(name: 'big', content: content, upload_preset_id: presets[1]['id']) }
      assert_equal ['upload/too-large', { 'limitBytes' => 5_500_000, 'source' => 'preset' }], [error.code, error.details]
    end
  end

  def test_a_url_upload_takes_its_upload_preset_and_an_unknown_one_is_refused
    mock = CalmLens::MockServerClient.new
    preset = mock.upload_presets.ensure(upload_presets: [{ key: 'open', name: 'Open', visibility: 'public' }])['uploadPresets'][0]
    asset = mock.assets.create(name: 'site', url: 'https://example.com/page', upload_preset_id: preset['id'])
    assert_equal 'public', asset['visibility']
    error = assert_raises(CalmLens::NotFoundError) { mock.assets.create(name: 'site', url: 'https://example.com/page', upload_preset_id: 'preset_missing') }
    assert_equal 'upload-preset/not-found', error.code
  end
end
