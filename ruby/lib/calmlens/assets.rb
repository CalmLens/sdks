# frozen_string_literal: true

module CalmLens
  # Uploads, moderation and management of assets. Reach it through {ServerClient#assets}.
  #
  # Every method takes an options Hash (or keyword arguments) whose names may be snake_case
  # (`asset_id:`) or the API's camelCase (`'assetId'`); keys inside `metadata` are sent unchanged.
  # Any method also accepts `request_options: { idempotency_key:, timeout:, open_timeout:, max_retries: }`.
  # Results are Hashes with the API's camelCase string keys. Fields and enum values added to the API
  # later appear as they are, so compare `classification.moderation.status` and similar values with known strings
  # and treat anything else as not ready.
  class Assets < Resource
    SUBMIT_QUERY_KEYS = %w[name description processingOptions visibility metadata externalId externalUrl
                           folderId uploadPresetId].freeze
    MIN_MULTIPART_IMAGE_BYTES = 10 * 1024 * 1024
    MAX_MULTIPART_IMAGE_BYTES = 20 * 1024 * 1024
    # The moderation status before a decision; {#wait_for_decision} returns once an asset has any
    # other, or once its classification status is in {FINISHED_PROCESSING_STATUSES}.
    PENDING_MODERATION_STATUS = 'pending'
    # Processing statuses after which no decision will arrive without a retry.
    FINISHED_PROCESSING_STATUSES = %w[failed].freeze
    DECISION_POLL_FIRST_DELAY = 0.5
    DECISION_POLL_MAX_DELAY = 5.0
    DEFAULT_DECISION_TIMEOUT = 60

    # Searches assets by meaning or keyword.
    # @option options [String] :query
    # @option options [String] :mode `hybrid`, `semantic` or `keyword`
    # @option options [Integer] :limit
    # @return [Hash] `{'query', 'items' => [{'asset', 'score', 'matchedFields'}], 'semanticStatus'}`
    def search(options = {})
      call(options) { |api, request| request('GET', project('assets/search'), query: api, request_options: request) }
    end

    # Lists one page of assets.
    # @option options [String] :cursor from the previous page
    # @option options [Integer] :page_size
    # @option options [String] :filter an RSQL filter such as `classification.moderation.status==allowed`
    # @option options [Array<Hash>] :ordering `[{field: 'createdAt', direction: 'DESC'}]`
    # @return [Hash] `{'items', 'total', 'hasMore', 'cursor', 'pageSize'}`
    def list(options = {})
      call(options) do |api, request|
        request('GET', project('assets/page'), query: api, request_options: request)
      end
    end

    # Iterates every asset matching the options, fetching pages as needed.
    # @param options [Hash] the options of {#list}; `cursor` sets the starting position.
    # @yieldparam asset [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      api, request = call(options) { |*split| split }
      listing = pages(api['cursor']) { |index| list(api.merge('cursor' => index, 'request_options' => request)) }
      listing.each { |page| page['items'].each(&block) }
      nil
    end

    # Lists one page of an asset's children, such as frames extracted from a video.
    # @option options [String] :asset_id
    # @return [Hash] a page like {#list}
    def list_children(options)
      call(options) do |api, request|
        query = without(api, 'assetId')
        request('GET', "/assets/#{Internal.segment(api['assetId'])}/children", query: query, request_options: request)
      end
    end

    # Iterates every child of an asset, fetching pages as needed.
    # @param options [Hash] the options of {#list_children}
    # @yieldparam asset [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each_child(options, &block)
      return enum_for(:each_child, options) unless block

      api, request = call(options) { |*split| split }
      listing = pages(api['cursor']) { |index| list_children(api.merge('cursor' => index, 'request_options' => request)) }
      listing.each { |page| page['items'].each(&block) }
      nil
    end

    # @option options [String] :asset_id
    # @return [Hash] the asset
    def retrieve(options)
      call(options) do |api, request|
        request('GET', "/assets/#{Internal.segment(api['assetId'])}", request_options: request)
      end
    end

    # Waits until an asset's `classification.moderation.status` is no longer `pending` (`allowed`,
    # `age-restricted`, `blocked` or `purged`), or its `classification.status` is `failed`, and returns
    # the asset. It retrieves the asset, waiting 0.5 seconds before the second check and 1.5 times
    # longer each time after that, up to 5 seconds.
    # Webhooks report decisions without polling.
    #
    # `timeout:` is the whole wait in seconds; `request_options: {timeout:}` still limits each request.
    # To stop waiting early, run the call in a thread you can stop: it only sleeps and sends requests.
    # @option options [String] :asset_id
    # @option options [Numeric] :timeout seconds to wait for a decision (default 60)
    # @return [Hash] the decided asset
    # @raise [TimeoutError] `sdk/timeout` when no decision arrives in time; `details` holds
    #   `'assetId'` and the last `'classificationStatus'` and `'moderationStatus'`.
    def wait_for_decision(options)
      call(options) do |api, request|
        timeout = api.fetch('timeout', DEFAULT_DECISION_TIMEOUT)
        unless timeout.is_a?(Numeric) && timeout.real? && timeout.to_f.finite? && !timeout.negative?
          raise Internal.invalid('timeout must be a non-negative number of seconds')
        end

        poll_for_decision(api['assetId'], request, timeout)
      end
    end

    # Updates an asset's name, description, tags, visibility, metadata and similar fields.
    # @option options [String] :asset_id
    # @return [Hash] the updated asset
    def update(options)
      call(options) do |api, request|
        request('PATCH', "/assets/#{Internal.segment(api['assetId'])}", body: without(api, 'assetId'),
                                                                        request_options: request)
      end
    end

    # Processes an asset whose `classification.status` is `failed` again.
    # @option options [String] :asset_id
    # @return [Hash] the asset
    def retry(options)
      call(options) do |api, request|
        request('POST', "/assets/#{Internal.segment(api['assetId'])}/retry", request_options: request)
      end
    end

    # Removes the stored content and returns the asset with `content.status` `removed` (reason
    # `requested`); the record and classification results are kept.
    # @option options [String] :asset_id
    # @return [Hash] the asset
    def delete_content(options)
      call(options) do |api, request|
        request('DELETE', "/assets/#{Internal.segment(api['assetId'])}/content", request_options: request)
      end
    end

    # Deletes the asset record and its stored content.
    # @option options [String] :asset_id
    # @return [nil]
    def delete(options)
      call(options) do |api, request|
        request('DELETE', "/assets/#{Internal.segment(api['assetId'])}", request_options: request)
        nil
      end
    end

    # Moves an asset into a folder, or to the project root with `folder_id: nil`.
    # @option options [String] :asset_id
    # @option options [String, nil] :folder_id
    # @return [Hash] the asset
    def move(options)
      call(options) do |api, request|
        request('POST', "/assets/#{Internal.segment(api['assetId'])}/move",
                body: { 'folderId' => Internal.required(api, 'folderId') }, request_options: request)
      end
    end

    # Creates a time-limited URL that delivers private content without an API key.
    # @option options [String] :asset_id
    # @option options [String] :resource `rendered` (the API's default) or `original`, which takes no lens or transform
    # @option options [Integer] :expires_in_seconds default 900
    # @option options [String] :lens a lens identifier
    # @option options [String, Hash, Array<Hash>] :transform a selector String or structured steps,
    #   as for {CDN#get_asset_url}; a lens runs before any additional transforms
    # @return [Hash] `{'url', 'expiresAt'}`
    def create_signed_url(options)
      call(options) do |api, request|
        body = without(api, 'assetId')
        body['transform'] = Transforms.selector(body['transform']) if body.key?('transform')
        request('POST', "/assets/#{Internal.segment(api['assetId'])}/signed-url",
                body: { 'expiresInSeconds' => 900 }.merge(body),
                request_options: request)
      end
    end

    # Uploads content and queues moderation; the call returns before classification finishes.
    # Watch for `asset.allowed`, `asset.age-restricted`, `asset.blocked` and `asset.purged` events or
    # retrieve the asset later.
    #
    # Give exactly one of `content:` (a whole file), `part:` (the first part of a multipart upload) or
    # `url:` (a web page or file to fetch). Content is `{type:, plain_text:}`, `{type:, base64:}` or
    # `{type:, data:}` where `data` is a binary String or an IO. An IO streams without being read into
    # memory; pass `size_in_bytes:` when its length is unknown (a pipe or socket).
    #
    # The request carries an `Idempotency-Key` (generated unless you pass
    # `request_options: {idempotency_key:}`), so a retried upload never creates a second asset.
    # @option options [String] :name
    # @option options [Hash] :content
    # @option options [Hash] :part `{type:, data:, is_final:}` for the first multipart part
    # @option options [Integer] :total_size_in_bytes the whole file's size, for multipart uploads
    # @option options [String] :url
    # @return [Hash] the asset
    def create(options)
      call(options) { |api, request| submit(api, request, true) }
    end

    # Uploads content and waits for the moderation decision where the content type supports it.
    # Audio and video are always processed asynchronously. Takes the options of {#create}.
    # @return [Hash] the asset; show it to everyone only when `classification.moderation.status` is
    #   `allowed`. Serve `age-restricted` assets only behind your own age check, through signed URLs.
    def classify(options)
      call(options) do |api, request|
        content = api['content']
        if content.is_a?(Hash) && content.key?('plainText') && (!content['plainText'].is_a?(String) || content['plainText'].strip.empty?)
          raise Internal.invalid('Text to classify must be a non-empty string', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
        end

        submit(api, request, false)
      end
    end

    # Uploads a later part of a multipart upload started with {#create} or {#classify} and `part:`.
    # The queue mode chosen at the start applies; pass `queue:` only to override it.
    # @option options [String] :asset_id
    # @option options [Hash] :part `{data:, part_number:, is_final:}`; part numbers start at 2.
    # @option options [Boolean] :queue
    # @return [Hash] the asset; `classification.status` stays `uploading` until the final part.
    def upload_part(options)
      call(options) do |api, request|
        path = "/assets/#{Internal.segment(api['assetId'])}/part"
        part = api['part']
        raise Internal.invalid('part is required') unless part.is_a?(Hash)

        number = part['partNumber']
        unless number.is_a?(Integer) && number.positive?
          raise Internal.invalid('partNumber must be a positive Integer',
                                 ErrorCodes::INVALID_UPLOAD_PART_NUMBER)
        end

        body = UploadBody.from(part, multipart: true)
        query = { 'partNumber' => number, 'isFinal' => part.fetch('isFinal', false), 'sizeInBytes' => body.size }
        query['queue'] = api['queue'] if api.key?('queue')
        request('POST', path, query: query, raw: body, idempotent: true, request_options: request,
                              headers: { 'Content-Type' => 'application/octet-stream', 'X-CalmLens-Upload' => 'part' })
      end
    end

    private

    def poll_for_decision(asset_id, request_options, timeout)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
      delay = DECISION_POLL_FIRST_DELAY
      loop do
        asset = retrieve('assetId' => asset_id, 'request_options' => request_options)
        processing = asset.dig('classification', 'status')
        moderation = asset.dig('classification', 'moderation', 'status')
        return asset if moderation != PENDING_MODERATION_STATUS || FINISHED_PROCESSING_STATUSES.include?(processing)

        remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
        unless remaining.positive?
          raise TimeoutError.new(SdkErrorCodes::TIMEOUT,
                                 "Asset #{asset['id']} had no moderation decision after #{timeout}s " \
                                 "(processing #{processing}, moderation #{moderation})",
                                 details: { 'assetId' => asset['id'], 'classificationStatus' => processing,
                                            'moderationStatus' => moderation })
        end

        sleep([delay, remaining].min)
        delay = [delay * 1.5, DECISION_POLL_MAX_DELAY].min
      end
    end

    def submit(options, request_options, queue)
      raise Internal.invalid('Asset name is required', ErrorCodes::INVALID_UPLOAD_PAYLOAD) if options['name'].to_s.empty?
      unless %w[content part url].one? { |key| options.key?(key) } && !options.key?('isFinal')
        raise Internal.invalid('Supply exactly one of content, part, or url; isFinal belongs in part',
                               ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end
      if options.key?('url')
        return request('POST', project('assets'), query: { 'queue' => queue }, body: options, idempotent: true,
                                                  request_options: request_options)
      end

      multipart = options.key?('part')
      content = options.fetch(multipart ? 'part' : 'content')
      raise Internal.invalid('Upload content must be a Hash', ErrorCodes::INVALID_UPLOAD_PAYLOAD) unless content.is_a?(Hash)

      mime = check_mime(content['type'])
      if multipart && content.fetch('partNumber', 1) != 1
        raise Internal.invalid('Use uploadPart for multipart upload parts after the first part', ErrorCodes::USE_UPLOAD_PART)
      end

      body = UploadBody.from(content, multipart: multipart)
      query = options.slice(*SUBMIT_QUERY_KEYS).merge('queue' => queue, 'contentType' => content['type'],
                                                      'sizeInBytes' => body.size)
      if multipart
        total = options['totalSizeInBytes']
        unless total.nil? || (total.is_a?(Integer) && total.positive?)
          raise Internal.invalid('totalSizeInBytes must be a positive Integer', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
        end

        check_image_size(total || body.size, total || content.fetch('isFinal', false)) if mime.start_with?('image/')
        query.merge!('partNumber' => 1, 'isFinal' => content.fetch('isFinal', false), 'totalSizeInBytes' => total)
      end
      request('POST', project('assets'),
              query: query, raw: body, idempotent: true, request_options: request_options,
              headers: { 'Content-Type' => content['type'], 'X-CalmLens-Upload' => multipart ? 'part' : 'content' })
    end

    def check_mime(type)
      mime = type.to_s.split(';').first.to_s.strip.downcase
      if mime.empty? || mime == 'application/octet-stream' || mime.start_with?('multipart/')
        raise Internal.invalid("#{mime} is not a valid upload file type. Uploads must use a concrete file MIME type " \
                               'that CalmLens can store and process, such as image/png, image/jpeg, ' \
                               'application/pdf, or text/plain.', ErrorCodes::INVALID_UPLOAD_MIME_TYPE)
      end
      raise Internal.invalid('Content type cannot contain line breaks') unless type.match?(Internal::HEADER_VALUE)

      mime
    end

    # Multipart images total 10MB to 20MB. With a declared total both bounds apply from the start.
    def check_image_size(size, complete)
      if size > MAX_MULTIPART_IMAGE_BYTES
        raise Internal.invalid('Multipart image uploads cannot exceed 20MB.',
                               ErrorCodes::MULTIPART_IMAGE_TOO_LARGE)
      end
      return unless complete && size < MIN_MULTIPART_IMAGE_BYTES

      raise Internal.invalid('Multipart image uploads must total at least 10MB.', ErrorCodes::MULTIPART_IMAGE_TOO_SMALL)
    end
  end
end
