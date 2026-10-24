# frozen_string_literal: true

require 'time'

module CalmLens
  # Codes for errors the SDK raises itself, before or instead of an API response.
  module SdkErrorCodes
    # A method received a missing, malformed or conflicting argument.
    INVALID_ARGUMENT = 'sdk/invalid-argument'
    # The client was constructed with an invalid configuration.
    INVALID_CONFIG = 'sdk/invalid-config'
    # The connection failed or broke before a complete response arrived.
    TRANSPORT_ERROR = 'sdk/transport-error'
    # Connecting, sending or receiving took longer than the configured timeout.
    TIMEOUT = 'sdk/timeout'
    # A successful response could not be read: malformed JSON, or not what the API returns.
    INVALID_RESPONSE = 'sdk/invalid-response'
    # A response body was larger than the client's `max_response_bytes` (32 MiB by default).
    RESPONSE_TOO_LARGE = 'sdk/response-too-large'
    # An error response did not carry a CalmLens error code, or the API answered with a redirect,
    # which the SDK never follows.
    HTTP_ERROR = 'sdk/http-error'
    # A webhook signature or timestamp did not verify.
    INVALID_WEBHOOK_SIGNATURE = 'sdk/invalid-webhook-signature'
    # A verified webhook body was not a CalmLens event payload.
    INVALID_WEBHOOK_PAYLOAD = 'sdk/invalid-webhook-payload'
  end

  # Base class of every error the SDK raises. Rescue it to handle any CalmLens failure.
  #
  # @!attribute [r] code
  #   @return [String] a stable identifier such as `asset/not-found` or `sdk/timeout`.
  #     Compare it with {ErrorCodes} or {SdkErrorCodes}, never with the message.
  # @!attribute [r] details
  #   @return [Hash{String => Object}, nil] the API's details, with its `"traceId"` when there is one;
  #     nil when the error has none.
  # @!attribute [r] status
  #   @return [Integer, nil] the HTTP status, or nil when no response was received.
  # @!attribute [r] request_id
  #   @return [String, nil] the `X-Request-Id` response header. Include it when contacting support.
  # @!attribute [r] headers
  #   @return [Hash{String => String}] response headers with lowercase names (empty without a response).
  class Error < StandardError
    attr_reader :code, :details, :status, :request_id, :headers

    # @param code [String]
    # @param message [String, nil] defaults to the code.
    def initialize(code, message = nil, details: nil, status: nil, headers: {}, request_id: nil)
      super("[calmlens] #{message || code}")
      @code = code
      @details = details
      @status = status
      @headers = headers.freeze
      @request_id = request_id || headers['x-request-id']
    end

    # @return [Integer, nil] whole seconds to wait before retrying, from the `Retry-After` header
    #   (seconds, or an HTTP date counted from now).
    def retry_after
      Error.parse_retry_after(headers['retry-after'])
    end

    # @return [Boolean] true when the resource does not exist.
    def not_found?
      status == 404 || code.end_with?('/not-found')
    end

    # Codes that may succeed when the same request is repeated, whatever the status.
    RETRYABLE_CODES = [SdkErrorCodes::TRANSPORT_ERROR, SdkErrorCodes::TIMEOUT,
                       ErrorCodes::IDEMPOTENT_REQUEST_IN_PROGRESS].freeze
    # HTTP statuses that may succeed when the same request is repeated.
    RETRYABLE_STATUSES = [429, 502, 503, 504].freeze
    private_constant :RETRYABLE_CODES, :RETRYABLE_STATUSES

    # @return [Boolean] true when repeating the same request may succeed: connection failures
    #   (`sdk/transport-error`), timeouts (`sdk/timeout`, including {Assets#wait_for_decision}),
    #   `idempotency/request-in-progress`, throttling (429) and 502/503/504. Everything else,
    #   including other 5xx statuses, is false. Repeat a write only with the same idempotency key.
    def retryable?
      RETRYABLE_CODES.include?(code) || RETRYABLE_STATUSES.include?(status)
    end

    # Builds the most specific error class for a code and HTTP status.
    # @return [Error]
    def self.build(code, message = nil, status: nil, **options)
      klass = if status then APIError.class_for(status)
              elsif code == SdkErrorCodes::TIMEOUT then TimeoutError
              elsif code == SdkErrorCodes::TRANSPORT_ERROR then ConnectionError
              elsif code == SdkErrorCodes::INVALID_RESPONSE then InvalidResponseError
              elsif code == SdkErrorCodes::INVALID_CONFIG then ConfigurationError
              else InvalidArgumentError
              end
      klass.new(code, message, status: status, **options)
    end

    # @api private
    def self.parse_retry_after(value)
      return nil if value.nil? || value.to_s.strip.empty?

      text = value.to_s.strip
      return Integer(text, 10) if text.match?(/\A\d+\z/)

      [(Time.httpdate(text) - Time.now).ceil, 0].max
    rescue ArgumentError
      nil
    end
  end

  # The API answered with an error status. {#status} is always set.
  class APIError < Error
    # @api private
    def self.class_for(status)
      case status
      when 400 then BadRequestError
      when 401 then AuthenticationError
      when 403 then PermissionDeniedError
      when 404 then NotFoundError
      when 409 then ConflictError
      when 429 then RateLimitError
      when 500..599 then ServerError
      else APIError
      end
    end
  end

  # HTTP 400: the request was rejected as invalid.
  class BadRequestError < APIError; end
  # HTTP 401: the API key is missing, invalid, revoked or expired.
  class AuthenticationError < APIError; end
  # HTTP 403: the API key may not perform this action.
  class PermissionDeniedError < APIError; end
  # HTTP 404: the resource does not exist in this project.
  class NotFoundError < APIError; end
  # HTTP 409: the request conflicts with the resource's current state.
  class ConflictError < APIError; end
  # HTTP 429: the request was throttled. See {Error#retry_after}.
  class RateLimitError < APIError; end
  # HTTP 5xx: CalmLens failed to handle the request.
  class ServerError < APIError; end

  # No complete response arrived (`sdk/transport-error`). The original exception is in `cause`.
  class ConnectionError < Error; end

  # Connecting, sending or receiving exceeded its timeout, or {Assets#wait_for_decision} had no
  # decision in time (`sdk/timeout`).
  class TimeoutError < ConnectionError; end

  # A successful response could not be read (`sdk/invalid-response`) or was too large
  # (`sdk/response-too-large`).
  class InvalidResponseError < Error; end

  # A method argument was rejected before any request was sent. The code is
  # `sdk/invalid-argument` or, for upload payload checks shared with the API, an `upload/*` code.
  class InvalidArgumentError < Error; end

  # The client configuration is invalid (`sdk/invalid-config`).
  class ConfigurationError < InvalidArgumentError; end

  # A webhook delivery failed verification (`sdk/invalid-webhook-signature`) or was not an
  # event payload (`sdk/invalid-webhook-payload`). Respond with 400 and do not process it.
  class WebhookVerificationError < Error; end
end
