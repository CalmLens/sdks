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

  def test_signs_a_token_the_backend_can_verify_against_the_keys_hash
    before = (Time.now.to_f * 1000).to_i
    signed = client.upload_tokens.sign(upload_preset_id: 'preset-1', external_id: 'post-42', expires_in_seconds: 120)
    claims, body, sent = decode(signed['token'])
    assert_equal({ 'v' => 1, 'u' => 'preset-1', 'x' => 'post-42', 'k' => 'clsk_use_abcd', 'e' => signed['expiresAt'] },
                 claims.except('n'))
    assert_operator signed['expiresAt'] - before, :>=, 120_000
    assert_operator signed['expiresAt'] - before, :<, 121_000
    assert_equal signature(body, API_KEY), sent
    refute_equal signature(body, 'other'), sent
  end

  def test_every_token_has_its_own_nonce_and_other_keys_use_an_eight_character_prefix
    short = client('legacykey-1234').upload_tokens
    first = decode(short.sign('uploadPresetId' => 'p1')['token']).first
    second = decode(short.sign(upload_preset_id: 'p1')['token']).first
    refute_equal first['n'], second['n']
    assert_equal 'legacyke', first['k']
    refute first.key?('x')
  end

  def test_rejects_invalid_options
    [{}, { upload_preset_id: 'p', expires_in_seconds: 3601 }, { upload_preset_id: 'p', expires_in_seconds: 0 },
     { upload_preset_id: 'p', expires_in_seconds: 1.5 }, { upload_preset_id: 'p', external_id: '' }].each do |options|
      error = assert_raises(CalmLens::InvalidArgumentError) { client.upload_tokens.sign(options) }
      assert_equal CalmLens::SdkErrorCodes::INVALID_ARGUMENT, error.code
    end
  end

  def test_the_mock_signs_tokens_with_its_key_without_a_request
    key = CalmLens::MockServerClient.create_api_key
    mock = CalmLens::MockServerClient.new(api_key: key)
    _, body, sent = decode(mock.upload_tokens.sign(upload_preset_id: 'preset-1')['token'])
    assert_equal signature(body, key), sent
    assert_empty mock.requests
  end

  def test_upload_preset_id_is_sent_as_a_query_parameter
    mock = CalmLens::MockServerClient.new
    mock.assets.create(name: 'n', upload_preset_id: 'preset-1', content: { plain_text: 'hi', type: 'text/plain' })
    assert_equal 'preset-1', mock.requests.last.query['uploadPresetId']
  end
end
