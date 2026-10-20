# frozen_string_literal: true

module CalmLens
  # An HTTP response. {CDN#serve} returns one; custom transports and the mock produce them.
  #
  # The body is read at most once: either stream it with {#each_chunk} or read it with {#body}.
  class Response
    # @return [Integer] the HTTP status code.
    attr_reader :status
    # @return [Hash{String => String}] headers with lowercase names.
    attr_reader :headers

    # @param status [Integer]
    # @param headers [Hash{String => String}]
    # @param body [String, nil] a complete body. Give a block instead to stream chunks.
    # @yield [chunk] a block that yields each body chunk to its block argument.
    def initialize(status:, headers: {}, body: nil, &reader)
      @status = Integer(status)
      @headers = headers.to_h { |name, value| [name.to_s.downcase, value.is_a?(Array) ? value.join(', ') : value.to_s] }.freeze
      @body = body&.b
      @reader = reader
      @consumed = false
    end

    # @return [String, nil] the `X-Request-Id` header.
    def request_id = headers['x-request-id']
    # @return [String, nil] the `Content-Type` header.
    def content_type = headers['content-type']

    # @return [Integer, nil] the `Content-Length` header.
    def content_length
      Integer(headers['content-length'], 10, exception: false)
    end

    # @return [Boolean] true for a 2xx status.
    def success? = status.between?(200, 299)

    # Streams the body in chunks without holding it in memory.
    # @yieldparam chunk [String] binary bytes
    # @return [void]
    def each_chunk(&block)
      return enum_for(:each_chunk) unless block

      if @body
        block.call(@body) unless @body.empty?
      else
        raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, 'The response body was already read') if @consumed

        @reader&.call(&block)
      end
      @consumed = true
      nil
    end

    # Reads the whole body into memory.
    # @param limit [Integer, nil] maximum bytes; a longer body raises {InvalidResponseError}.
    # @return [String] binary bytes
    def body(limit: nil)
      if @body
        too_large!(limit) if limit && @body.bytesize > limit
        return @body
      end

      buffer = String.new(capacity: [content_length || 0, 1 << 20].min, encoding: Encoding::BINARY)
      each_chunk do |chunk|
        buffer << chunk
        too_large!(limit) if limit && buffer.bytesize > limit
      end
      @body = buffer
    end

    # @return [String]
    def inspect = "#<#{self.class.name} status=#{status} content_type=#{content_type.inspect}>"

    private

    def too_large!(limit)
      raise InvalidResponseError.new(SdkErrorCodes::RESPONSE_TOO_LARGE, "Response body exceeds #{limit} bytes",
                                     headers: headers)
    end
  end
end
