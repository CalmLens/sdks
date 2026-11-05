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

  # A verified webhook delivery. The body has the shape of an {Events#list} item:
  # `{id, projectId, actor, type, severity, title, description, assetId, assetSequence, asset, facts, createdAt}`.
  # Fields CalmLens adds later are kept in {#payload}, as are unknown asset and fact fields.
  #
  # @!attribute id [String] the event ID.
  # @!attribute project_id [String]
  # @!attribute actor [Hash, nil] who caused the event: `{'type', 'id'}`, with `type` `user`, `api-key`,
  #   `automated` or `system`, and `id` the user's or API key's ID, or nil when it was not recorded.
  # @!attribute type [String] such as `asset.allowed`. New types may appear: ignore unknown ones.
  # @!attribute severity [String, nil] `low` or `high`.
  # @!attribute title [String, nil]
  # @!attribute description [String, nil]
  # @!attribute asset_id [String, nil]
  # @!attribute asset_sequence [Integer, nil] increases with each event about the same asset; nil for
  #   events not about an asset. Deliveries can arrive out of order: see {#newer_than?}.
  # @!attribute asset [Hash, nil] the asset's status when the event was created.
  # @!attribute facts [Array<Hash>] `{'key', 'value', 'url'?}` entries registered for the event type.
  # @!attribute created_at [Integer] milliseconds since the epoch.
  # @!attribute payload [Hash{String => Object}] the delivery body as received, with every field.
  WebhookEvent = Struct.new(:id, :project_id, :actor, :type, :severity, :title, :description, :asset_id, :asset_sequence, :asset,
                            :facts, :created_at, :payload, keyword_init: true) do
    # @return [Boolean] true for a test send from the portal or CLI.
    def test? = Webhooks.test_event?(self)

    # @param last_sequence [Integer, nil] the highest `assetSequence` applied for this event's asset
    # @return [Boolean] whether to apply this event after it.
    # @see Webhooks.newer_asset_event?
    def newer_than?(last_sequence) = Webhooks.newer_asset_event?(self, last_sequence)

    # @return [Hash{String => Object}] the delivery body as received, with every field.
    def to_payload = payload
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

    # The headers of one signed delivery of a body, as CalmLens sends them, to test a receiver.
    # @param payload [String] the raw body
    # @param delivery_id [String] the `x-calmlens-delivery` value
    # @param secret [String]
    # @param timestamp [Integer] Unix seconds
    # @return [Hash{String => String}]
    def headers(payload:, delivery_id:, secret:, timestamp: Time.now.to_i)
      {
        'content-type' => 'application/json',
        WEBHOOK_DELIVERY_HEADER => delivery_id.to_s,
        WEBHOOK_TIMESTAMP_HEADER => timestamp.to_s,
        WEBHOOK_SIGNATURE_HEADER => signature_header(payload: payload, timestamp: timestamp, secret: secret)
      }
    end

    # Whether an event is a test send from the portal or the CLI rather than a real event: its
    # `facts` hold the registered `{ key: "test", value: true }` fact.
    # @param event [WebhookEvent, Hash] a parsed delivery, or a delivery body with string keys
    # @return [Boolean]
    def test_event?(event)
      facts = event.is_a?(Hash) ? event['facts'] : event.facts
      facts.is_a?(Array) && facts.any? { |fact| fact.is_a?(Hash) && fact['key'] == 'test' && fact['value'] == true }
    end

    # Whether to apply `event` after `last_sequence`, the highest `assetSequence` you have applied
    # for its asset (nil when none). Deliveries can arrive out of order: an event about an asset is
    # newer only with a higher `assetSequence`, so a retried or repeated delivery of an earlier one
    # returns false. Events that aren't about an asset have no sequence and are always new. Store
    # the highest `assetSequence` applied per `assetId` and ignore lower ones.
    # @param event [WebhookEvent, Hash] a parsed delivery, or a delivery body with string keys
    # @param last_sequence [Integer, nil]
    # @return [Boolean]
    def newer_asset_event?(event, last_sequence)
      sequence = event.is_a?(Hash) ? event['assetSequence'] : event.asset_sequence
      sequence.nil? || last_sequence.nil? || sequence > last_sequence
    end

    # Converts an event from {Events#list} to the JSON body of its webhook delivery, which has the
    # same fields: `description`, `assetId`, `assetSequence` and `asset` are nil when absent, and
    # `actor` is left out when the event has none.
    # @param event [Hash] an event with string keys, as {Events#list} returns it
    # @return [Hash] `{ 'id', 'projectId', 'actor', 'type', 'severity', 'title', 'description', 'assetId',
    #   'assetSequence', 'asset', 'facts', 'createdAt' }`
    def to_payload(event)
      raise Internal.invalid('event must be a Hash') unless event.is_a?(Hash)

      payload = { 'id' => event['id'], 'projectId' => event['projectId'] }
      payload['actor'] = event['actor'] if event.key?('actor')
      payload.merge('type' => event['type'], 'severity' => event['severity'], 'title' => event['title'],
                    'description' => event['description'], 'assetId' => event['assetId'],
                    'assetSequence' => event['assetSequence'], 'asset' => event['asset'], 'facts' => event['facts'],
                    'createdAt' => event['createdAt'])
    end

    # Checks a delivery's signature and freshness in constant time. Pass the `signature` and
    # `timestamp` header values, or the request's `headers` to read them from.
    # @param payload [String] the raw request body, exactly as received
    # @param signature [String, nil] the `x-calmlens-signature` header
    # @param timestamp [String, nil] the `x-calmlens-timestamp` header
    # @param headers [Hash, #to_hash, nil] request headers, as a Hash whose names may have any case
    #   and whose values are Strings or Arrays of repeated values (`Net::HTTPHeader#to_hash`), or a
    #   Rack env (`HTTP_X_CALMLENS_SIGNATURE`). Repeated values are joined with `,`.
    # @param secret [String] the webhook's signing secret
    # @param tolerance_seconds [Integer]
    # @param now [Integer] Unix seconds
    # @return [Boolean]
    # @raise [InvalidArgumentError] when payload is not a String, such as an already parsed Hash.
    def verify(payload:, secret:, signature: nil, timestamp: nil, headers: nil,
               tolerance_seconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, now: Time.now.to_i)
      raw = raw_body(payload)
      signature = header(headers, WEBHOOK_SIGNATURE_HEADER) if signature.nil?
      timestamp = header(headers, WEBHOOK_TIMESTAMP_HEADER) if timestamp.nil?
      stamp = timestamp.to_s.strip
      return false if !secret.is_a?(String) || secret.empty? || signature.to_s.empty? || !stamp.match?(/\A[0-9]+\z/)
      return false if (now.floor - Integer(stamp, 10)).abs > tolerance_seconds

      candidates = signature.to_s.split(',').map(&:strip).select { |entry| entry.start_with?('v1=') }
      return false if candidates.empty?

      expected = OpenSSL::HMAC.hexdigest('SHA256', secret, "#{stamp}.".b + raw)
      # Every candidate is compared, so the time taken does not depend on which one matches.
      candidates.map { |entry| entry.delete_prefix('v1=').downcase }.reduce(false) do |matched, candidate|
        (candidate.bytesize == expected.bytesize && OpenSSL.fixed_length_secure_compare(candidate, expected)) || matched
      end
    end

    # Verifies a delivery from its request headers. See {verify}.
    # @return [Boolean]
    def verify_request(payload:, headers:, secret:, tolerance_seconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
                       now: Time.now.to_i)
      verify(payload: payload, headers: headers, secret: secret, tolerance_seconds: tolerance_seconds, now: now)
    end

    # Verifies a delivery, then parses it. Takes the options of {verify}.
    # @return [WebhookEvent]
    # @raise [WebhookVerificationError] `sdk/invalid-webhook-signature` when verification fails, or
    #   `sdk/invalid-webhook-payload` when the verified body is not an event.
    def parse_event(payload:, secret:, signature: nil, timestamp: nil, headers: nil,
                    tolerance_seconds: WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, now: Time.now.to_i)
      unless verify(payload: payload, signature: signature, timestamp: timestamp, headers: headers, secret: secret,
                    tolerance_seconds: tolerance_seconds, now: now)
        raise WebhookVerificationError.new(SdkErrorCodes::INVALID_WEBHOOK_SIGNATURE,
                                           'Webhook signature or timestamp did not verify')
      end

      decode_event(payload)
    end

    def decode_event(payload)
      body = JSON.parse(payload.dup.force_encoding(Encoding::UTF_8))
      raise WebhookVerificationError.new(SdkErrorCodes::INVALID_WEBHOOK_PAYLOAD, 'Webhook body is not a CalmLens event') unless event?(body)

      WebhookEvent.new(id: body['id'], project_id: body['projectId'], actor: body['actor'], type: body['type'], severity: body['severity'],
                       title: body['title'], description: body['description'], asset_id: body['assetId'],
                       asset_sequence: body['assetSequence'], asset: body['asset'], facts: body.fetch('facts', []),
                       created_at: body['createdAt'], payload: body)
    rescue JSON::ParserError, EncodingError => e
      raise WebhookVerificationError.new(SdkErrorCodes::INVALID_WEBHOOK_PAYLOAD, 'Webhook body is not JSON'), cause: e
    end

    # The API's rules for a received body: the fields CalmLens always sends, and the types of the
    # other known fields when present. Unknown fields are accepted.
    def event?(body)
      return false unless body.is_a?(Hash) && body['id'].is_a?(String) && body['type'].is_a?(String) &&
                          body['projectId'].is_a?(String) && body['createdAt'].is_a?(Numeric)

      optional = ->(key, *types) { !body.key?(key) || types.any? { |type| type.nil? ? body[key].nil? : body[key].is_a?(type) } }
      optional.call('severity', String) && optional.call('title', String) && optional.call('description', String, nil) &&
        optional.call('assetId', String, nil) && optional.call('assetSequence', Numeric, nil) && nested?(body)
    end

    # The nested fields, when present: `actor` is `{type, id}` with a String type and a String or null
    # ID, `asset` has a String `id` and `facts` lists `{key, value, url?}` entries.
    def nested?(body)
      actor = body.fetch('actor', { 'type' => '' })
      asset = body['asset']
      actor.is_a?(Hash) && actor['type'].is_a?(String) && (actor['id'].nil? || actor['id'].is_a?(String)) &&
        (asset.nil? || (asset.is_a?(Hash) && asset['id'].is_a?(String))) &&
        (!body.key?('facts') || (body['facts'].is_a?(Array) && body['facts'].all? { |fact| fact?(fact) }))
    end

    def fact?(fact)
      fact.is_a?(Hash) && fact['key'].is_a?(String) && fact.key?('value') && (!fact.key?('url') || fact['url'].is_a?(String))
    end

    # A header's value, found case-insensitively; repeated values are joined with `,`.
    def header(headers, name)
      return nil if headers.nil?

      pairs = headers.respond_to?(:to_hash) ? headers.to_hash : headers.to_h
      rack = "HTTP_#{name.upcase.tr('-', '_')}"
      found = pairs.select { |key, _| key.to_s.casecmp?(name) || key.to_s == rack }.values
      return nil if found.empty?

      found.flat_map { |value| Array(value) }.join(',')
    end

    def raw_body(payload)
      return payload.b if payload.is_a?(String)

      raise Internal.invalid("Webhook payload must be the raw body String, not a #{payload.class}. " \
                             'Read request.raw_post (Rails) or request.body.read (Rack, Sinatra) before parsing.')
    end
    private_class_method :decode_event, :event?, :nested?, :fact?, :header, :raw_body
  end

  # @see Webhooks.signature_header
  def self.create_webhook_signature_header(...) = Webhooks.signature_header(...)

  # @see Webhooks.headers
  def self.create_webhook_headers(...) = Webhooks.headers(...)

  # @see Webhooks.to_payload
  def self.to_webhook_event_payload(...) = Webhooks.to_payload(...)

  # @see Webhooks.verify
  def self.verify_webhook_signature(...) = Webhooks.verify(...)

  # @see Webhooks.verify_request
  def self.verify_webhook_request(...) = Webhooks.verify_request(...)

  # @see Webhooks.parse_event
  def self.parse_webhook_event(...) = Webhooks.parse_event(...)

  # @see Webhooks.test_event?
  def self.test_webhook_event?(...) = Webhooks.test_event?(...)

  # @see Webhooks.newer_asset_event?
  def self.newer_asset_event?(...) = Webhooks.newer_asset_event?(...)
end
