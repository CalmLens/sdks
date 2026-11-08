# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'
require 'json'
require 'stringio'
require 'uri'

# Content larger than part_size_bytes is uploaded in parts by assets.create and assets.classify.
class AutomaticMultipartTest < Minitest::Test
  MIB = 1024 * 1024

  # `body` is the file's bytes: an upload form's file part, a text upload's text or a later part.
  Sent = Struct.new(:verb, :path, :query, :key, :options, :body, keyword_init: true)

  # Distinct bytes, so a part sent from the wrong offset shows.
  PERIOD = Array.new(251) { |index| (index * 7) % 251 }.pack('C*').freeze
  def file_of(length) = (PERIOD * ((length / PERIOD.bytesize) + 1)).byteslice(0, length)

  def asset(status, parts_received)
    JSON.generate('id' => 'asset-1', 'upload' => { 'status' => status, 'partsReceived' => parts_received },
                  'classification' => { 'status' => 'pending', 'moderation' => { 'status' => 'pending' } })
  end

  def api_error(code, status, details = {}) = [status, JSON.generate('code' => code, 'message' => code, 'details' => details)]

  # Answers each part like the API: uploading until the final part.
  def upload_response(sent)
    final = sent.query['isFinal'] == 'true'
    [200, final ? asset('completed', nil) : asset('uploading', sent.query['partNumber'].to_i)]
  end

  # A transport that records each request and answers with `respond.call(sent, index)`.
  def scripted(respond = method(:upload_response).to_proc, **options)
    sent = []
    transport = lambda do |request|
      uri = URI(request.url)
      body = request.body.respond_to?(:read) ? request.body.read.to_s : request.body.to_s
      type = request.headers['Content-Type'].to_s
      fields = nil
      if type.start_with?('multipart/form-data')
        text, body = CalmLens::Testing::FakeAPI.upload_form(body, type)
        fields = JSON.parse(text)
      elsif type == 'application/json'
        fields = JSON.parse(body)
        body = fields.delete('content')['plainText']
      end
      record = Sent.new(verb: request.method, path: uri.path, query: URI.decode_www_form(uri.query.to_s).to_h,
                        key: request.headers['Idempotency-Key'], options: fields, body: body.b)
      sent << record
      answer = respond.arity == 1 ? respond.call(record) : respond.call(record, sent.size - 1)
      raise answer if answer.is_a?(Exception)

      CalmLens::Response.new(status: answer[0], body: answer[1], headers: {})
    end
    [CalmLens::ServerClient.new(api_key: 'key', project_id: 'project-1', transport: transport, retry_base_delay: 0, **options), sent]
  end

  def test_content_larger_than_a_part_is_sent_in_parts_with_derived_keys
    client, sent = scripted(part_size_bytes: 5 * MIB)
    file = file_of(11 * MIB)
    result = client.assets.classify(name: 'clip.mp4', content: { data: file, type: 'video/mp4' }, author_id: 'pupil-7',
                                    request_options: { idempotency_key: 'upload-1' })

    assert_equal 'completed', result.dig('upload', 'status')
    assert_equal ['/v1/projects/project-1/assets', '/v1/assets/asset-1/part', '/v1/assets/asset-1/part'], sent.map(&:path)
    assert_equal %w[upload-1 upload-1:part-2 upload-1:part-3], sent.map(&:key)
    assert_equal(%w[1 2 3], sent.map { |request| request.query['partNumber'] })
    assert_equal(%w[false false true], sent.map { |request| request.query['isFinal'] })
    assert_equal([5 * MIB, 5 * MIB, MIB].map(&:to_s), sent.map { |request| request.query['sizeInBytes'] })
    assert_equal (11 * MIB).to_s, sent[0].query['totalSizeInBytes']
    # Whether to wait goes with the first part, which saves it for the upload.
    assert_equal(['true', nil, nil], sent.map { |request| request.query['wait'] })
    # The first part's form carries the asset's fields; the URL never does.
    assert_equal [{ 'name' => 'clip.mp4', 'authorId' => 'pupil-7' }, nil, nil], sent.map(&:options)
    assert_equal(%w[contentType isFinal partNumber sizeInBytes totalSizeInBytes wait], sent[0].query.keys.sort)
    assert_equal file, sent.map(&:body).join
  end

  def test_a_seekable_io_is_split_from_its_position
    client, sent = scripted(part_size_bytes: 5 * MIB)
    file = file_of(12 * MIB)
    io = StringIO.new("skip#{file}")
    io.read(4)
    client.assets.create(name: 'report.pdf', content: { data: io, type: 'application/pdf' })

    assert_equal([5 * MIB, 5 * MIB, 2 * MIB], sent.map { |request| request.body.bytesize })
    assert_equal file, sent.map(&:body).join
    assert_equal "#{sent[0].key}:part-2", sent[1].key
  end

  def test_content_of_one_part_streams_and_text_go_in_one_request
    client, sent = scripted(->(_) { [200, asset('completed', nil)] })
    client.assets.create(name: 'exact.pdf', content: { data: file_of(8 * MIB), type: 'application/pdf' })
    reader, writer = IO.pipe
    writer.binmode
    feeder = Thread.new do
      writer.write(file_of(9 * MIB))
      writer.close
    end
    client.assets.create(name: 'stream.pdf', content: { data: reader, type: 'application/pdf', size_in_bytes: 9 * MIB })
    feeder.join
    client.assets.create(name: 'long.txt', content: { plain_text: 'a' * (9 * MIB), type: 'text/plain' })

    assert_equal([nil, nil, nil], sent.map { |request| request.query['partNumber'] })
    assert_equal([8 * MIB, 9 * MIB, 9 * MIB], sent.map { |request| request.body.bytesize })
  end

  def test_a_dropped_part_is_retried_with_its_key_and_a_part_the_api_has_is_skipped
    client, sent = scripted(lambda do |request, index|
      next Errno::ECONNRESET.new if index == 1
      # Part 3's response was lost before: the API asks for part 4.
      if request.query['partNumber'] == '3'
        next api_error('upload-part/invalid-number', 409, 'expectedPartNumber' => 4, 'receivedPartNumber' => 3)
      end

      upload_response(request)
    end, part_size_bytes: 5 * MIB, max_retries: 1)
    result = client.assets.create(name: 'report.pdf', content: { data: file_of(16 * MIB), type: 'application/pdf' },
                                  request_options: { idempotency_key: 'upload-2' })

    assert_equal 'completed', result.dig('upload', 'status')
    assert_equal %w[upload-2 upload-2:part-2 upload-2:part-2 upload-2:part-3 upload-2:part-4], sent.map(&:key)
    assert_equal sent[1].body, sent[2].body
    assert_equal file_of(16 * MIB).byteslice(15 * MIB, MIB), sent[4].body
    assert_equal 'true', sent[4].query['isFinal']
  end

  def test_a_final_part_that_finds_the_upload_completed_reads_the_asset_back
    client, sent = scripted(lambda do |request|
      next api_error('upload/not-open', 409) if request.path.end_with?('/part')

      request.verb == 'GET' ? [200, asset('completed', nil)] : upload_response(request)
    end)
    result = client.assets.create(name: 'clip.mp4', content: { base64: [file_of(9 * MIB)].pack('m0'), type: 'video/mp4' })

    assert_equal 'completed', result.dig('upload', 'status')
    assert_equal ['/v1/projects/project-1/assets', '/v1/assets/asset-1/part', '/v1/assets/asset-1'], sent.map(&:path)
    assert_nil sent[2].key
  end

  def test_refuses_a_bad_part_size_an_over_long_key_and_an_image_over_20_mib
    [(5 * MIB) - 1, (64 * MIB) + 1, 6.0 * MIB].each do |size|
      error = assert_raises(CalmLens::ConfigurationError) { CalmLens::ServerClient.new(api_key: 'key', project_id: 'p', part_size_bytes: size) }
      assert_equal CalmLens::SdkErrorCodes::INVALID_CONFIG, error.code
    end
    client, sent = scripted
    error = assert_raises(CalmLens::InvalidArgumentError) do
      client.assets.create(name: 'clip.mp4', content: { data: file_of(9 * MIB), type: 'video/mp4' },
                           request_options: { idempotency_key: 'k' * 241 })
    end
    assert_equal CalmLens::SdkErrorCodes::INVALID_ARGUMENT, error.code
    error = assert_raises(CalmLens::InvalidArgumentError) do
      client.assets.create(name: 'huge.png', content: { data: file_of(21 * MIB), type: 'image/png' })
    end
    assert_equal [CalmLens::ErrorCodes::UPLOAD_TOO_LARGE, { 'limitBytes' => 20 * MIB, 'source' => 'plan' }], [error.code, error.details]
    assert_empty sent
  end

  def test_the_mock_joins_the_parts_and_resumes_with_the_same_key_after_a_failed_part
    moderated = []
    client = CalmLens::MockServerClient.new(part_size_bytes: 5 * MIB, moderate: lambda do |input|
      moderated << input.content.bytes.bytesize
      'allowed'
    end)
    file = file_of(12 * MIB)
    options = { name: 'report.pdf', content: { data: file, type: 'application/pdf' },
                processing_options: { keep_content_after_processing: true }, request_options: { idempotency_key: 'upload-3' } }
    client.fail_next_request('transport-error', operation: 'assets.upload_part')
    error = assert_raises(CalmLens::ConnectionError) { client.assets.classify(options) }
    assert_equal CalmLens::SdkErrorCodes::TRANSPORT_ERROR, error.code

    finished = client.assets.classify(options)
    assert_equal 'completed', finished.dig('upload', 'status')
    assert_equal 12 * MIB, finished.dig('content', 'sizeInBytes')
    assert_equal([finished['id']], client.assets.list['items'].map { |item| item['id'] })
    assert_equal file, client.state.content[finished['id']]['parts'].sort.map(&:last).join
    assert_equal [12 * MIB], moderated
  end

  def test_the_mock_takes_an_image_in_parts
    client = CalmLens::MockServerClient.new(part_size_bytes: 5 * MIB)
    image = file_of(6 * MIB)
    asset = client.assets.create(name: 'photo.png', content: { data: image, type: 'image/png' },
                                 processing_options: { keep_content_after_processing: true })
    assert_equal 'image', asset['type']
    assert_equal 'completed', asset.dig('upload', 'status')
    assert_equal image, client.state.content[asset['id']]['parts'].sort.map(&:last).join
    assert_equal(%w[1 2], client.requests.map { |request| request.query['partNumber'] })
  end
end
