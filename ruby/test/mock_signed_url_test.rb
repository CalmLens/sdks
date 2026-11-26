# frozen_string_literal: true

require 'json'
require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'

# Signed asset URLs: each is signed for a resource and ends in it.
class MockSignedUrlTest < Minitest::Test
  def test_only_a_url_signed_for_the_original_serves_it
    mock = CalmLens::MockServerClient.new
    asset = mock.assets.classify(name: 'photo.png', content: { data: 'hello', type: 'image/png' },
                                 processing_options: { retain_content: true })
    original = mock.cdn.sign_asset_url(asset_id: asset['id'], resource: 'original')['url']
    assert_match %r{/original\z}, original
    assert_equal [200, 'hello'], [mock.fetch_cdn(original).status, mock.fetch_cdn(original).body]
    rendered = mock.cdn.sign_asset_url(asset_id: asset['id'], resource: 'rendered')['url']
    refused = mock.fetch_cdn("#{rendered.delete_suffix('/rendered')}/original")
    assert_equal [403, 'signed-url/original-not-granted'], [refused.status, JSON.parse(refused.body)['code']]
    # A URL ending in a resource reads the same info as its asset URL.
    assert_equal asset['id'], mock.cdn.get_asset_info(original)['id']
    assert_raises(CalmLens::InvalidArgumentError) { mock.cdn.sign_asset_url(asset_id: asset['id'], original: true) }
  end
end
