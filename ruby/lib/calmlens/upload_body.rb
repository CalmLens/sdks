# frozen_string_literal: true

module CalmLens
  # An upload payload: a binary String, or an IO streamed with an exact byte count (or, when its
  # length is unknown, until it ends, sent with chunked transfer encoding).
  # @api private
  class UploadBody
    PAYLOAD_KEYS = %w[plainText base64 data bytes].freeze
    MIN_PART_BYTES = 5 * 1024 * 1024

    attr_reader :size

    # Builds the body from upload content options (`plainText`, `base64`, or `data`/`bytes` as a
    # String or IO). IO input is streamed, never read into memory.
    # @param part_size [Boolean] check that a multipart part other than the last has 5 MiB.
    def self.from(content, multipart:, part_size: true)
      raise Internal.invalid('Upload content must be a Hash', ErrorCodes::INVALID_UPLOAD_PAYLOAD) unless content.is_a?(Hash)

      keys = PAYLOAD_KEYS.select { |key| content.key?(key) }
      raise Internal.invalid('Supply exactly one payload representation', ErrorCodes::INVALID_UPLOAD_PAYLOAD) unless keys.size == 1

      body = build(keys.first, content.fetch(keys.first), content['sizeInBytes'], multipart)
      if content.key?('sizeInBytes') && content['sizeInBytes'] != body.size
        raise Internal.invalid('sizeInBytes must match the payload byte length', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end
      if part_size && multipart && !content.fetch('isFinal', false) && body.size && body.size < MIN_PART_BYTES
        raise Internal.invalid('Multipart upload parts must be at least 5MiB except the final part.',
                               ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end
      body
    end

    def self.build(kind, value, declared, multipart)
      case kind
      when 'plainText'
        raise Internal.invalid('plainText must be a String', ErrorCodes::INVALID_UPLOAD_PAYLOAD) unless value.is_a?(String)

        new(value.encode(Encoding::UTF_8).b)
      when 'base64' then new(decode64(value, multipart))
      else
        return new(value.b) if value.is_a?(String)
        return new(IOReader.new(value, stream_size(value, declared))) if value.respond_to?(:read)

        raise Internal.invalid('Expected a binary String or IO', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end
    end

    def self.decode64(value, multipart)
      raise Internal.invalid('base64 must be a String', ErrorCodes::INVALID_UPLOAD_PAYLOAD) unless value.is_a?(String)

      raw = value.split(';base64,').last.to_s.gsub(/\s/, '')
      if multipart && raw.length % 4 != 0
        raise Internal.invalid('Split bytes before base64-encoding each part', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end

      (raw + ('=' * ((4 - (raw.length % 4)) % 4))).unpack1('m0')
    rescue ArgumentError
      raise Internal.invalid('Invalid base64', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
    end

    # The bytes left in a sized stream (a File, Tempfile or StringIO), the declared size, or nil when
    # the length is unknown (a pipe or socket).
    def self.stream_size(io, declared)
      return declared if declared.is_a?(Integer) && declared >= 0

      remaining = io.size - io.pos if io.respond_to?(:size) && io.respond_to?(:pos)
      remaining.is_a?(Integer) && remaining >= 0 ? remaining : nil
    rescue IOError, SystemCallError, NoMethodError
      nil
    end
    private_class_method :build, :decode64, :stream_size

    def initialize(source)
      @source = source
      @size = source.is_a?(String) ? source.bytesize : source.size
    end

    # @return [String, IOReader] what the transport sends.
    def content
      @source
    end

    # @return [Boolean] whether the body can be sent again for a retry.
    def replayable?
      @source.is_a?(String) || @source.rewindable?
    end

    # Prepares the body to be sent again.
    def rewind
      @source.rewind unless @source.is_a?(String)
    end

    # The bytes, read fully. Used only by the offline mock.
    def read_all
      return @source if @source.is_a?(String)

      @source.rewind if @source.rewindable?
      @source.read || ''.b
    end

    # Reads exactly `size` bytes from an IO and fails if it holds fewer or more; without a size, reads
    # until the IO ends.
    class IOReader
      attr_reader :size

      def initialize(io, size)
        @io = io
        @size = size
        @remaining = size
        @start = (io.pos if io.respond_to?(:pos) && io.respond_to?(:seek))
      rescue IOError, SystemCallError
        @start = nil
      end

      def rewindable? = !@start.nil?

      def rewind
        @io.seek(@start)
        @remaining = @size
      end

      def read(length = nil, buffer = nil)
        return (buffer ? buffer.replace(''.b) : ''.b) if length&.zero?
        return read_unsized(length, buffer) if @size.nil?

        if @remaining.zero?
          extra = @io.read(1)
          unless extra.nil? || extra.empty?
            raise Internal.invalid('The stream holds more bytes than sizeInBytes',
                                   ErrorCodes::INVALID_UPLOAD_PAYLOAD)
          end

          buffer&.clear
          return length.nil? || length.zero? ? ''.b : nil
        end
        chunk = @io.read([length || @remaining, @remaining].min)
        if chunk.nil? || chunk.empty?
          raise Internal.invalid('The stream ended before sizeInBytes bytes', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
        end

        @remaining -= chunk.bytesize
        chunk = chunk.b
        buffer ? buffer.replace(chunk) : chunk
      end

      def read_unsized(length, buffer)
        chunk = @io.read(*[length].compact)
        return buffer&.clear && nil if chunk.nil? || (length && chunk.empty?)

        chunk = chunk.b
        buffer ? buffer.replace(chunk) : chunk
      end

      def readpartial(length, buffer = nil)
        read(length, buffer) || raise(EOFError)
      end
    end
  end
  private_constant :UploadBody
end
