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

    # Fetches numbered pages lazily, from `start` until `hasMore` is false.
    def pages(start, &fetch)
      Enumerator.new do |out|
        index = start
        loop do
          page = fetch.call(index)
          items = page.is_a?(Hash) ? page['items'] : nil
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Page has no items') unless items.is_a?(Array)

          out << page
          break unless page['hasMore'] == true && !items.empty?

          index = page['nextCursor']
          break unless index
        end
      end
    end
  end
end
