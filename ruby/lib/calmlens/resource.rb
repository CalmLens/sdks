# frozen_string_literal: true

require 'json'
require 'uri'

module CalmLens
  # Shared behaviour of the client's resource objects.
  class Resource
    # @api private
    def initialize(session)
      @session = session
    end

    def inspect = "#<#{self.class.name} project_id=#{@session.project_id.inspect}>"

    private

    # Runs a public method: splits options, and raises every argument problem as {InvalidArgumentError}.
    def call(options)
      api, request = Internal.options(options)
      yield api, request
    rescue Error
      raise
    rescue KeyError, TypeError, ArgumentError, JSON::GeneratorError, EncodingError, URI::Error, FloatDomainError => e
      raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, e.message), cause: e
    end

    def request(...) = @session.request(...)
    def project(path) = @session.project(path)

    def without(options, *keys) = options.except(*keys)

    # Fetches cursor pages lazily, from `start`, until a page has no next cursor, says there is no
    # more or is empty. A page with more to follow that hands back a cursor this iteration already
    # sent raises `sdk/invalid-response` rather than repeating pages forever.
    def pages(start, &fetch)
      Enumerator.new do |out|
        cursor = start
        sent = []
        loop do
          page = fetch.call(cursor)
          items = page.is_a?(Hash) ? page['items'] : nil
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Page has no items') unless items.is_a?(Array)

          following = page['nextCursor']
          more = following.is_a?(String) && !following.empty? && page['hasMore'] == true && !items.empty?
          new_cursor!(sent, following) if more
          out << page
          break unless more

          cursor = following
        end
      end
    end

    # Records a cursor an iteration sends, raising `sdk/invalid-response` (with `details['cursor']`)
    # when a page with more to follow hands back one it already sent, which would repeat pages forever.
    def new_cursor!(sent, cursor)
      if sent.include?(cursor)
        raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE,
                                       'The API returned a cursor it had already returned, with more pages to follow',
                                       details: { 'cursor' => cursor })
      end

      sent << cursor
    end
  end
end
