# frozen_string_literal: true

require 'digest'
require 'json'
require 'openssl'
require 'securerandom'

module CalmLens
  # Signs upload tokens, which let a browser upload through an upload preset. Reach it through
  # {ServerClient#upload_tokens}. Signing happens locally with the API key; no request is made.
  class UploadTokens < Resource
    TOKEN_PREFIX = 'clut_'
    SIGNING_CONTEXT = 'calmlens-upload-token:v1:'
    DEFAULT_TTL_SECONDS = 600
    MAX_TTL_SECONDS = 3600

    # @api private
    def initialize(session, api_key)
      super(session)
      @api_key = api_key
    end

    # Signs a single-use token. Hand it to the browser as its bearer token; give each upload its own.
    # @option options [String] :upload_preset_id the preset the token may upload through
    # @option options [String] :external_id the external ID the uploaded asset gets (not empty)
    # @option options [Integer] :expires_in_seconds lifetime, 1 to 3600 (default 600)
    # @return [Hash] `{'token' => String, 'expiresAt' => Integer}` (milliseconds since the Unix epoch)
    def sign(options)
      api, = call(options) { |*split| split }
      preset_id = api['uploadPresetId']
      Internal.segment(preset_id)
      ttl = api.fetch('expiresInSeconds', DEFAULT_TTL_SECONDS)
      unless ttl.is_a?(Integer) && ttl.between?(1, MAX_TTL_SECONDS)
        raise Internal.invalid("expiresInSeconds must be a whole number from 1 to #{MAX_TTL_SECONDS}")
      end

      external_id = api['externalId']
      if api.key?('externalId') && !(external_id.is_a?(String) && !external_id.empty?)
        raise Internal.invalid('externalId must be a non-empty string')
      end

      expires_at = (Time.now.to_f * 1000).to_i + (ttl * 1000)
      claims = { 'v' => 1, 'u' => preset_id, 'k' => @api_key[0, @api_key.start_with?('clsk_') ? 13 : 8],
                 'e' => expires_at, 'n' => SecureRandom.uuid }
      claims['x'] = external_id if external_id
      body = [JSON.generate(claims)].pack('m0').tr('+/', '-_').delete('=')
      secret = Digest::SHA256.hexdigest(@api_key)
      signature = OpenSSL::HMAC.hexdigest('SHA256', secret, SIGNING_CONTEXT + body)
      { 'token' => "#{TOKEN_PREFIX}#{body}.#{signature}", 'expiresAt' => expires_at }
    end
  end
end
