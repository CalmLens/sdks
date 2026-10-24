# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens/testing'

class UploadTokensTest < Minitest::Test
  API_KEY = 'clsk_use_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHabcdef'

  def client(api_key = API_KEY)
    CalmLens::ServerClient.new(api_key: api_key, project_id: 'project', transport: ->(_) { flunk 'sent a request' })
  end

  def decode(token)
    assert token.start_with?('clut_')
    body, signature = token.delete_prefix('clut_').split('.')
    [JSON.parse(body.tr('-_', '+/').unpack1('m')), body, signature]
  end

  def signature(body, api_key)
    OpenSSL::HMAC.hexdigest('SHA256', Digest::SHA256.hexdigest(api_key), "calmlens-upload-token:v1:#{body}")
  end

  def test_the_mock_signs_tokens_with_its_key_without_a_request
    key = CalmLens::MockServerClient.create_api_key
    mock = CalmLens::MockServerClient.new(api_key: key)
    _, body, sent = decode(mock.upload_tokens.sign(upload_preset_id: 'preset-1')['token'])
    assert_equal signature(body, key), sent
    assert_empty mock.requests
  end
end
