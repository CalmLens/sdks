# frozen_string_literal: true

require 'json'
require 'openssl'

# Webhook header names, signature tolerance, event type and verification helpers.
module CalmLens
  # Header carrying the delivery ID. Retries of one delivery repeat it: use it to skip duplicates.
  WEBHOOK_DELIVERY_HEADER = 'x-calmlens-delivery'
  # Header carrying the Unix time (seconds) the delivery was signed.
  WEBHOOK_TIMESTAMP_HEADER = 'x-calmlens-timestamp'
  # Header carrying `v1=<hex HMAC-SHA256>` signatures, comma-separated.
  WEBHOOK_SIGNATURE_HEADER = 'x-calmlens-signature'
  # Deliveries whose timestamp is further than this from the receiver's clock are rejected.
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300

  # A verified webhook delivery: `{id, type, createdAt, projectId, data}`, where `data` holds the
  # event's `severity`, `title`, `description`, `assetId`, `asset` and `facts`.
  #
  # @!attribute id [String] the event ID.
  # @!attribute type [String] such as `asset.approved`. New types may appear: ignore unknown ones.
  # @!attribute created_at [Integer] milliseconds since the epoch.
  # @!attribute project_id [String]
  # @!attribute data [Hash{String => Object}] the event fields, with the API's camelCase keys.
  WebhookEvent = Struct.new(:id, :type, :created_at, :project_id, :data, keyword_init: true) do
    # @return [String, nil]
    def asset_id = data['assetId']

    # @return [Array<Hash>] `{'key', 'value', 'url'?}` entries registered for the event type.
    def facts = data['facts'].is_a?(Array) ? data['facts'] : []

    # @return [Boolean] true for a test send from the portal or CLI.
    def test? = facts.any? { |fact| fact.is_a?(Hash) && fact['key'] == 'test' && fact['value'] == true }
  end

  # Webhook signing and verification. Always verify the exact bytes received: read the raw body
  # (`request.raw_post` in Rails, `request.body.read` in Rack and Sinatra) before parsing it.
  module Webhooks
    module_function

    # Builds the `x-calmlens-signature` value for a body, for example to test your receiver.
    # @param payload [String] the raw body
    # @param timestamp [String, Integer] Unix seconds
    # @param secret [String]
    # @return [String] `v1=<hex>`
    def signature_header(payload:, timestamp:, secret:)
      raw = raw_body(payload)
      raise Internal.invalid('secret must be a non-empty String') unless secret.is_a?(String) && !secret.empty?

      "v1=#{OpenSSL::HMAC.hexdigest('SHA256', secret, "#{timestamp.to_s.b}.".b + raw)}"
    end

    # Checks a delivery's signature and freshness in constant time.
    # @param payload [String] the raw request body, exactly as received
    # @param signature [String, nil] the `x-calmlens-signature` header
    # @param timestamp [String, nil] the `x-calmlens-timestamp` header
    # @param secret [String] the webhook's signing secret
    # @param tolerance_seconds [Integer]
    # @param now [Integer] Unix seconds
    # @return [Boolean]
    # @raise [InvalidArgumentError] when payload is not a String, such as an already parsed Hash.
    def verify(payload:, signature:, timestamp:, secret:, tolerance_seconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
               now: Time.now.to_i)
      raw = raw_body(payload)
      stamp = timestamp.to_s.strip
      return false if !secret.is_a?(String) || secret.empty? || signature.to_s.empty? || !stamp.match?(/\A[0-9]+\z/)
      return false if (now.floor - stamp.to_i).abs > tolerance_seconds

      expected = signature_header(payload: raw, timestamp: stamp, secret: secret).delete_prefix('v1=')
      signature.to_s.split(',').map(&:strip).select { |entry| entry.start_with?('v1=') }.any? do |entry|
        candidate = entry.delete_prefix('v1=').downcase
        candidate.bytesize == expected.bytesize && OpenSSL.fixed_length_secure_compare(candidate, expected)
      end
    end

    # Verifies a delivery, then parses it.
    # @param (see #verify)
    # @return [WebhookEvent]
    # @raise [WebhookVerificationError] `sdk/invalid-webhook-signature` when verification fails, or
    #   `sdk/invalid-webhook-payload` when the verified body is not an event.
    def parse_event(payload:, signature:, timestamp:, secret:,
                    tolerance_seconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, now: Time.now.to_i)
      unless verify(payload: payload, signature: signature, timestamp: timestamp, secret: secret,
                    tolerance_seconds: tolerance_seconds, now: now)
        raise WebhookVerificationError.new(SdkErrorCodes::INVALID_WEBHOOK_SIGNATURE,
                                           'Webhook signature or timestamp did not verify')
      end

      decode_event(payload)
    end

    def decode_event(payload)
      body = JSON.parse(payload.dup.force_encoding(Encoding::UTF_8))
      unless body.is_a?(Hash) && body['id'].is_a?(String) && body['type'].is_a?(String) && body['createdAt'].is_a?(Integer) &&
             body['projectId'].is_a?(String) && body['data'].is_a?(Hash)
        raise WebhookVerificationError.new(SdkErrorCodes::INVALID_WEBHOOK_PAYLOAD, 'Webhook body is not a CalmLens event')
      end

      WebhookEvent.new(id: body['id'], type: body['type'], created_at: body['createdAt'],
                       project_id: body['projectId'], data: body['data'])
    rescue JSON::ParserError, EncodingError => e
      raise WebhookVerificationError.new(SdkErrorCodes::INVALID_WEBHOOK_PAYLOAD, 'Webhook body is not JSON'), cause: e
    end

    def raw_body(payload)
      return payload.b if payload.is_a?(String)

      raise Internal.invalid("Webhook payload must be the raw body String, not a #{payload.class}. " \
                             'Read request.raw_post (Rails) or request.body.read (Rack, Sinatra) before parsing.')
    end
    private_class_method :decode_event, :raw_body
  end

  # @see Webhooks.signature_header
  def self.create_webhook_signature_header(...) = Webhooks.signature_header(...)

  # @see Webhooks.verify
  def self.verify_webhook_signature(...) = Webhooks.verify(...)

  # @see Webhooks.parse_event
  def self.parse_webhook_event(...) = Webhooks.parse_event(...)
end
