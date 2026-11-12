# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require 'pp'
require 'socket'
require 'stringio'
require 'timeout'

# Exercises the Net::HTTP transport against a local HTTP server.
class TransportTest < Minitest::Test
  # A minimal HTTP/1.1 server: each connection is served on its own thread, with keep-alive.
  class Server
    attr_reader :requests, :accepted

    def initialize(&respond)
      @server = TCPServer.new('127.0.0.1', 0)
      @respond = respond
      @requests = Queue.new
      @accepted = 0
      @threads = []
      @acceptor = Thread.new do
        loop { serve(@server.accept) }
      rescue StandardError
        IOError
      end
    end

    def url = "http://127.0.0.1:#{@server.addr[1]}"

    def close
      @server.close
      @acceptor.join(1)
      @threads.each(&:kill)
    end

    private

    def serve(socket)
      @accepted += 1
      @threads << Thread.new do
        while (line = socket.gets)
          headers = {}
          while (header = socket.gets) && header != "\r\n"
            name, value = header.split(':', 2)
            headers[name.downcase] = value.strip
          end
          body = headers['content-length'] ? socket.read(Integer(headers['content-length'])) : read_chunked(socket, headers)
          @requests << { line: line.strip, headers: headers, body: body }
          status, response_headers, response = @respond.call(line, headers, body)
          socket.write("HTTP/1.1 #{status} X\r\nContent-Length: #{response.bytesize}\r\n" \
                       "#{response_headers.map { |name, value| "#{name}: #{value}\r\n" }.join}\r\n#{response}")
        end
      rescue IOError, SystemCallError
        nil
      ensure
        socket.close
      end
    end

    def read_chunked(socket, headers)
      return nil unless headers['transfer-encoding'] == 'chunked'

      body = +''
      while (size = Integer(socket.gets.strip, 16)).positive?
        body << socket.read(size)
        socket.gets
      end
      socket.gets
      body
    end
  end

  ASSET = '{"id":"asset","upload":{"status":"completed"},"classification":{"status":"completed","moderation":{"decision":"allowed"}}}'

  def with_server(respond = ->(*) { [200, {}, ASSET] })
    server = Server.new(&respond)
    client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', base_url: server.url, cdn_base_url: server.url,
                                        retry_base_delay: 0)
    yield client, server
  ensure
    client&.close
    server&.close
  end

  def test_a_request_never_shows_its_headers_when_printed
    request = CalmLens::Transport::Request.new(method: 'GET', url: 'https://api.calmlens.invalid/v1',
                                               headers: { 'X-Api-Key' => 'secret-api-key' })
    [request.inspect, request.to_s, request.pretty_inspect].each { |text| refute_includes text, 'secret-api-key' }
  end

  def test_connections_are_reused_and_closed
    with_server do |client, server|
      2.times { client.assets.retrieve('asset') }
      assert_equal 1, server.accepted
      client.close
      error = assert_raises(CalmLens::ConnectionError) { client.assets.retrieve('asset') }
      assert_equal 'sdk/transport-error', error.code
    end
  end

  def test_requests_identify_the_sdk_and_runtime
    with_server do |client, server|
      client.assets.retrieve('asset')
      assert_equal "calmlens-ruby/#{CalmLens::VERSION} (ruby/#{RUBY_VERSION})", server.requests.pop[:headers]['user-agent']
    end
  end

  def test_uploads_stream_from_io_in_chunks_with_a_content_length
    reads = []
    io = StringIO.new('x' * 200_000)
    io.define_singleton_method(:read) do |length = nil, *rest|
      reads << length
      super(length, *rest)
    end
    with_server do |client, server|
      client.assets.create(name: 'big.txt', content: { data: io, type: 'text/plain' })
      request = server.requests.pop
      _, file = CalmLens::Testing::FakeAPI.upload_form(request[:body], request[:headers]['content-type'])
      assert_equal [request[:body].bytesize.to_s, 'x' * 200_000], [request[:headers]['content-length'], file]
      assert reads.none?(&:nil?), "the stream was read whole: #{reads.inspect}"
      assert_operator reads.size, :>, 1
    end
  end

  def test_a_stream_of_unknown_length_is_sent_chunked
    reader, writer = IO.pipe
    writer.write('piped content')
    writer.close
    with_server do |client, server|
      client.assets.create(name: 'pipe.txt', content: { data: reader, type: 'text/plain' })
      request = server.requests.pop
      _, file = CalmLens::Testing::FakeAPI.upload_form(request[:body], request[:headers]['content-type'])
      assert_equal ['chunked', nil, 'piped content'],
                   [request[:headers]['transfer-encoding'], request[:headers]['content-length'], file]
      refute_includes request[:line], 'sizeInBytes'
    end
  end

  def test_redirects_are_not_followed
    with_server(->(*) { [302, { 'Location' => 'https://elsewhere.example/steal' }, ''] }) do |client, server|
      error = assert_raises(CalmLens::APIError) { client.assets.retrieve('asset') }
      assert_equal ['sdk/http-error', 302, 1], [error.code, error.status, server.requests.size]
    end
  end

  def test_a_stream_shorter_than_its_declared_size_fails_without_hanging
    with_server do |client, _server|
      error = assert_raises(CalmLens::InvalidArgumentError) do
        Timeout.timeout(5) do
          client.assets.create(name: 'pipe.txt', content: { data: StringIO.new('abc'), size_in_bytes: 10, type: 'text/plain' })
        end
      end
      assert_equal 'upload-payload/invalid', error.code
    end
  end

  def test_cdn_serve_streams_into_a_block_and_returns_its_value
    headers = {
      'Content-Type' => 'image/png', 'X-Request-Id' => 'req-9',
      'X-CalmLens-Asset-Info' => 'width=80, description="sample, width=42", height=60'
    }
    with_server(->(*) { [200, headers, 'p' * 70_000] }) do |client, _server|
      chunks = []
      result = client.cdn.serve(asset_id: 'asset') do |response|
        assert_equal [200, 'image/png', 'req-9'], [response.status, response.content_type, response.request_id]
        assert_equal CalmLens::ServedAssetInfo.new(width: 80, height: 60), response.get_asset_info
        response.each_chunk { |chunk| chunks << chunk }
        :done
      end
      assert_equal [:done, 70_000], [result, chunks.sum(&:bytesize)]
      assert_equal 70_000, client.cdn.serve(asset_id: 'asset').body.bytesize
    end
  end

  def test_cdn_lens_and_transform_reach_the_server_as_one_path_segment
    with_server(->(*) { [200, {}, 'png'] }) do |client, server|
      assert_equal 200, client.cdn.serve(asset_id: 'asset', lens: 'thumb', transform: 'border.color=fff,width=10').status
      assert_equal 'GET /assets/project/asset/rendered/@thumb,border.color=fff,width=10 HTTP/1.1', server.requests.pop[:line]
    end
  end

  def test_errors_raised_in_the_serve_block_pass_through_unchanged
    with_server(->(*) { [200, {}, 'body'] }) do |client, _server|
      error = assert_raises(IOError) do
        client.cdn.serve(asset_id: 'asset') do |response|
          response.each_chunk { |_chunk| raise IOError, 'disk full' } # rubocop:disable Lint/UnreachableLoop
        end
      end
      assert_equal 'disk full', error.message
    end
  end

  def test_a_forked_child_opens_its_own_connection
    skip 'fork is unavailable' unless Process.respond_to?(:fork)

    with_server do |client, server|
      client.assets.retrieve('asset')
      pid = fork do
        client.assets.retrieve('asset')
        exit!(0)
      rescue StandardError
        exit!(1)
      end
      _, status = Process.wait2(pid)
      assert status.success?
      # Without the PID check the child would reuse the parent's pooled socket.
      assert_equal [2, 2], [server.accepted, server.requests.size]
      client.assets.retrieve('asset')
      assert_equal 3, server.requests.size
    end
  end
end
