# frozen_string_literal: true

require 'net/http'
require 'openssl'
require 'uri'
require 'zlib'

module CalmLens
  # The HTTP layer. Pass a custom transport to {ServerClient#initialize} to route requests elsewhere;
  # it receives a {Transport::Request} and either returns a {Response} or yields one to the block
  # it is given (and returns the block's result), which lets the body stream.
  module Transport
    # One outgoing HTTP request.
    #
    # @!attribute method [String] the HTTP method.
    # @!attribute url [String] the absolute URL.
    # @!attribute headers [Hash{String => String}]
    # @!attribute body [String, #read, nil] the request body. A streamed body has a `Content-Length` header.
    # @!attribute open_timeout [Numeric] seconds allowed to open a connection.
    # @!attribute timeout [Numeric] seconds allowed for each read or write; not a whole-transfer deadline.
    Request = Struct.new(:method, :url, :headers, :body, :open_timeout, :timeout, keyword_init: true) do
      def inspect = "#<#{self.class.name} #{method} #{url}>"
    end

    # Exceptions that mean the connection failed before a complete response arrived.
    ERRORS = [IOError, SystemCallError, SocketError, OpenSSL::SSL::SSLError, Net::ProtocolError,
              Net::HTTPBadResponse, Net::HTTPHeaderSyntaxError, Zlib::Error].freeze

    # The default transport: Net::HTTP with a small per-origin pool of keep-alive connections.
    # Redirects are never followed, so credentials never reach another host. After `fork`, the
    # child process discards the inherited connections and opens its own.
    class NetHTTP
      MAX_IDLE_PER_ORIGIN = 8

      def initialize
        @lock = Mutex.new
        @idle = {}
        @closed = false
        @pid = Process.pid
      end

      # @param request [Request]
      # @yieldparam response [Response] a response whose body streams from the socket.
      def call(request)
        uri, target = Internal.split_url(request.url)
        origin = [uri.scheme, uri.host, uri.port]
        connection = checkout(origin)
        reusable = false
        begin
          connection ||= connect(uri, request.open_timeout)
          connection.read_timeout = connection.write_timeout = request.timeout
          result = nil
          connection.request(build(target, request)) do |net|
            response = Response.new(status: net.code, headers: net.to_hash) { |&chunk| net.read_body(&chunk) }
            result = yield response
            reusable = !net['connection'].to_s.casecmp?('close')
          end
          result
        ensure
          checkin(origin, connection, reusable) if connection
        end
      end

      # Closes idle connections. Later requests fail.
      def close
        @lock.synchronize do
          @closed = true
          @idle.each_value { |connections| connections.each { |connection| finish(connection) } }
          @idle.clear
        end
      end

      def inspect = "#<#{self.class.name}>"

      private

      def build(target, request)
        net = Net::HTTPGenericRequest.new(request.method, !request.body.nil?, request.method != 'HEAD',
                                          target, request.headers)
        if request.body.respond_to?(:read)
          net.body_stream = request.body
        elsif request.body
          net.body = request.body
        end
        net
      end

      def connect(uri, open_timeout)
        connection = Net::HTTP.new(uri.host, uri.port)
        connection.use_ssl = uri.scheme == 'https'
        connection.open_timeout = open_timeout
        # Retries are decided by the client, which knows which requests are safe to repeat.
        connection.max_retries = 0
        connection.start
        connection
      end

      def checkout(origin)
        @lock.synchronize do
          raise ConnectionError.new(SdkErrorCodes::TRANSPORT_ERROR, 'Client is closed') if @closed

          # Sockets inherited across fork are shared with the parent: drop them without closing.
          if @pid != Process.pid
            @idle = {}
            @pid = Process.pid
          end
          (@idle[origin] ||= []).pop
        end
      end

      def checkin(origin, connection, reusable)
        kept = @lock.synchronize do
          idle = (@idle[origin] ||= [])
          if reusable && !@closed && @pid == Process.pid && idle.size < MAX_IDLE_PER_ORIGIN
            idle << connection
            true
          end
        end
        finish(connection) unless kept
      end

      def finish(connection)
        connection.finish if connection.started?
      rescue IOError, SystemCallError
        nil
      end
    end
  end
end
