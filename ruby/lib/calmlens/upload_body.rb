# frozen_string_literal: true

require 'securerandom'

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

    # `length` bytes from `offset` as a body of their own, read again from the source for each
    # attempt. Only for a {#replayable?} body of known size: an IO is positioned at the slice.
    def slice(offset, length)
      return UploadBody.new(@source.byteslice(offset, length)) if @source.is_a?(String)

      UploadBody.new(@source.slice(offset, length))
    end

    # This body as the `file` part of an upload form, after an `options` part holding
    # `options_json`: `multipart/form-data` with a random boundary. A stream stays a stream, read
    # as the form is sent, and the form can be sent again whenever this body can.
    # @return [Array(UploadBody, String)] the form and its Content-Type.
    def to_form(options_json, type)
      boundary = "calmlens-#{SecureRandom.uuid}"
      head = "--#{boundary}\r\nContent-Disposition: form-data; name=\"options\"\r\nContent-Type: application/json\r\n\r\n".b +
             options_json.b + "\r\n--#{boundary}\r\nContent-Disposition: form-data; name=\"file\"\r\n".b +
             "Content-Type: #{type.delete("\r\n")}\r\n\r\n".b
      tail = "\r\n--#{boundary}--\r\n".b
      source = @source.is_a?(String) ? head + @source + tail : FormReader.new(head, @source, tail)
      [UploadBody.new(source), "multipart/form-data; boundary=#{boundary}"]
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

      # @param bounded [Boolean] the stream goes on after `size` bytes (a slice of a larger file), so
      #   reading stops there without checking for more.
      def initialize(io, size, bounded: false)
        @io = io
        @size = size
        @bounded = bounded
        @remaining = size
        @start = (io.pos if io.respond_to?(:pos) && io.respond_to?(:seek))
      rescue IOError, SystemCallError
        @start = nil
      end

      def rewindable? = !@start.nil?

      # A reader of `length` bytes from `offset` of this rewindable stream, positioned there.
      def slice(offset, length)
        @io.seek(@start + offset)
        IOReader.new(@io, length, bounded: true)
      end

      def rewind
        @io.seek(@start)
        @remaining = @size
      end

      def read(length = nil, buffer = nil)
        return (buffer ? buffer.replace(''.b) : ''.b) if length&.zero?
        return read_unsized(length, buffer) if @size.nil?

        if @remaining.zero?
          return length.nil? ? ''.b : buffer&.clear && nil if @bounded

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

    # An upload form around a streamed file: the form's head, the file's bytes as an {IOReader}
    # reads them, then its closing boundary.
    class FormReader
      def initialize(head, file, tail)
        @head = head
        @file = file
        @tail = tail
        @size = file.size && (head.bytesize + file.size + tail.bytesize)
        rewind_pieces
      end

      attr_reader :size

      def rewindable? = @file.rewindable?

      def rewind
        @file.rewind
        rewind_pieces
      end

      # Reads like IO#read: everything left without a length, else up to `length` bytes, nil at the end.
      def read(length = nil, buffer = nil)
        return (buffer ? buffer.replace(''.b) : ''.b) if length&.zero?

        output = ''.b
        until @pieces.empty? || (length && output.bytesize >= length)
          chunk = read_piece(length && (length - output.bytesize))
          chunk.nil? || chunk.empty? ? next_piece : output << chunk
        end
        return buffer&.clear && nil if output.empty? && length

        buffer ? buffer.replace(output) : output
      end

      def readpartial(length, buffer = nil)
        read(length, buffer) || raise(EOFError)
      end

      private

      def rewind_pieces
        @pieces = %i[head file tail]
        @offset = 0
      end

      def next_piece
        @pieces.shift
        @offset = 0
      end

      # Up to `length` bytes (all, without one) of the current piece; empty or nil once it is used up.
      def read_piece(length)
        piece = @pieces.first
        return @file.read(length) if piece == :file

        text = piece == :head ? @head : @tail
        chunk = text.byteslice(@offset, length || text.bytesize).to_s
        @offset += chunk.bytesize
        chunk
      end
    end
  end
  private_constant :UploadBody
end
