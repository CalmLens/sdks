# frozen_string_literal: true

require 'securerandom'

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
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'assets'

    SUBMIT_QUERY_KEYS = %w[name description processingOptions visibility metadata authorId context externalId externalUrl
                           folderId uploadPresetId].freeze
    MAX_MULTIPART_IMAGE_BYTES = 20 * 1024 * 1024
    # The API's limits for one-request uploads: images up to 10 MiB (larger ones are uploaded in
    # parts), audio and video up to 50 MiB and other files up to 5,000 MiB.
    MAX_DIRECT_IMAGE_BYTES = 10 * 1024 * 1024
    MAX_MEDIA_BYTES = 50 * 1024 * 1024
    MAX_FILE_BYTES = 5000 * 1024 * 1024
    # Audio and video sent in parts can be up to 2 GiB; the API holds free uploads, made before
    # billing is set up, to MAX_MEDIA_BYTES itself.
    MAX_LONG_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
    # The longest `idempotency_key` of an upload sent in parts: each part's key adds `:part-<n>`.
    MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH = 240
    # The moderation status before a decision; {#wait_for_decision} returns once an asset has any
    # other, or once its classification status is in {FINISHED_PROCESSING_STATUSES}.
    PENDING_MODERATION_STATUS = 'pending'
    # Processing statuses after which no decision will arrive without a retry.
    FINISHED_PROCESSING_STATUSES = %w[failed].freeze
    DECISION_POLL_FIRST_DELAY = 0.5
    # Each wait between decision checks is this many times the one before, up to DECISION_POLL_MAX_DELAY.
    DECISION_POLL_FACTOR = 1.5
    DECISION_POLL_MAX_DELAY = 2.0
    DEFAULT_DECISION_TIMEOUT = 60
    # The lifetime of a signed URL when none is given: 15 minutes.
    DEFAULT_SIGNED_URL_SECONDS = 15 * 60
    # The longest signed URL lifetime the API accepts: 24 hours.
    MAX_SIGNED_URL_SECONDS = 24 * 60 * 60
    # The operations {#batch} runs: `delete` deletes each asset with its child assets and stored
    # content; `remove-content` removes its stored content and keeps the record.
    BATCH_OPERATIONS = %w[delete remove-content].freeze
    # The most assets one {#batch} request takes.
    MAX_BATCH_ASSETS = 500

    # Searches assets by meaning or keyword.
    # @option options [String] :query
    # @option options [String] :mode `hybrid`, `semantic` or `keyword`
    # @option options [Integer] :limit
    # @return [Hash] `{'query', 'items' => [{'asset', 'score', 'matchedFields'}], 'semanticStatus'}`
    def search(options = {})
      call(options, __method__) { |api, request| request('GET', project('assets/search'), query: api, request_options: request) }
    end

    # Lists one page of assets.
    # @option options [String] :cursor from the previous page
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :filter an RSQL filter such as `classification.moderation.status==allowed`
    # @option options [Array<Hash>] :ordering `[{field: 'createdAt', direction: 'desc'}]`
    # @return [Hash] a cursor page: items, nextCursor, hasMore, pageSize and ordering.
    def list(options = {})
      call(options, __method__) do |api, request|
        request('GET', project('assets'), query: api, request_options: request)
      end
    end

    # Iterates every asset matching the options, fetching pages as needed.
    # @param options [Hash] the options of {#list}; `cursor` sets the starting position.
    # @yieldparam asset [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      api, request = call(options, __method__) { |*split| split }
      listing = pages(api['cursor']) { |index| list(api.merge('cursor' => index, 'request_options' => request)) }
      listing.each { |page| page['items'].each(&block) }
      nil
    end

    # Lists one page of an asset's children, such as frames extracted from a video.
    # @option options [String] :asset_id
    # @return [Hash] a page like {#list}
    def list_children(options)
      call(options, __method__) do |api, request|
        query = without(api, 'assetId')
        request('GET', "/assets/#{Internal.segment(api['assetId'])}/children", query: query, request_options: request)
      end
    end

    # Lists one page of an audio or video asset's findings timeline, in time order.
    # `classification.moderation.timeline.segmentCount` says how many segments there are. Pass each
    # page's `nextCursor` back unchanged; cursors are opaque.
    # @option options [String] :asset_id
    # @option options [String] :cursor
    # @option options [Integer] :page_size
    # @return [Hash] a cursor page of timeline segments: items, nextCursor, hasMore, pageSize and ordering.
    def list_timeline(options)
      call(options, __method__) do |api, request|
        query = without(api, 'assetId')
        request('GET', project("assets/#{Internal.segment(api['assetId'])}/timeline"), query: query, request_options: request)
      end
    end

    # Iterates every child of an asset, fetching pages as needed.
    # @param options [Hash] the options of {#list_children}
    # @yieldparam asset [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each_child(options, &block)
      return enum_for(:each_child, options) unless block

      api, request = call(options, __method__) { |*split| split }
      listing = pages(api['cursor']) { |index| list_children(api.merge('cursor' => index, 'request_options' => request)) }
      listing.each { |page| page['items'].each(&block) }
      nil
    end

    # @option options [String] :asset_id
    # @return [Hash] the asset
    def retrieve(options)
      call(options, __method__) do |api, request|
        request('GET', "/assets/#{Internal.segment(api['assetId'])}", request_options: request)
      end
    end

    # Waits until an asset's `classification.moderation.status` is no longer `pending` (`allowed`,
    # `limited`, `age-restricted`, `blocked` or `purged`), or its `classification.status` is `failed`, and returns
    # the asset. It retrieves the asset, waiting 0.5 seconds before the second check and 1.5 times
    # longer each time after that, up to 2 seconds.
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
      call(options, __method__) do |api, request|
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
      call(options, __method__) do |api, request|
        request('PATCH', "/assets/#{Internal.segment(api['assetId'])}", body: without(api, 'assetId'),
                                                                        request_options: request)
      end
    end

    # Processes an asset whose `classification.status` is `failed` again.
    # @option options [String] :asset_id
    # @return [Hash] the asset
    def retry(options)
      call(options, __method__) do |api, request|
        request('POST', "/assets/#{Internal.segment(api['assetId'])}/retry", request_options: request)
      end
    end

    # Records a reviewer's decision, replacing the policy's: `classification.moderation.status`
    # becomes the decision, the decision and note join `classification.moderation.manualReviews` and
    # the matching `asset.<status>` event is sent with `decided-by: reviewer`. An asset still pending
    # moderation can only be blocked or purged. Purging needs `confirm_purge: true` and the
    # `assets:delete` permission, and permanently deletes the stored content. Not retried: it carries
    # no `Idempotency-Key`.
    # @option options [String] :asset_id
    # @option options [String] :decision `allowed`, `limited`, `age-restricted`, `blocked` or `purged`
    # @option options [String] :note why, 1 to 1499 characters
    # @option options [Boolean] :confirm_purge must be true to purge
    # @return [Hash] the asset
    def decide(options)
      call(options, __method__) do |api, request|
        request('POST', "/assets/#{Internal.segment(api['assetId'])}/decision", body: without(api, 'assetId'),
                                                                                request_options: request)
      end
    end

    # Completes the policy evidence behind a decided asset's moderation decision: the report's
    # `classification.moderation.explanationComplete` becomes `true` and every action stays as decided.
    # With `rerun: true` the asset is moderated again with the project's current policy and returns
    # in `processing`; use it when the policy changed since the decision (`asset/policy-changed`).
    # @option options [String] :asset_id
    # @option options [Boolean] :rerun
    # @return [Hash] the asset
    def explain(options)
      call(options, __method__) do |api, request|
        request('POST', "/assets/#{Internal.segment(api['assetId'])}/explain",
                body: api['rerun'] ? { 'rerun' => true } : {}, request_options: request)
      end
    end

    # Removes the stored content and returns the asset with `content.status` `removed` (reason
    # `requested`); the record and classification results are kept.
    # @option options [String] :asset_id
    # @return [Hash] the asset
    def delete_content(options)
      call(options, __method__) do |api, request|
        request('DELETE', "/assets/#{Internal.segment(api['assetId'])}/content", request_options: request)
      end
    end

    # Deletes the asset record and its stored content.
    # @option options [String] :asset_id
    # @return [nil]
    def delete(options)
      call(options, __method__) do |api, request|
        request('DELETE', "/assets/#{Internal.segment(api['assetId'])}", request_options: request)
        nil
      end
    end

    # Deletes up to 500 assets (`operation: 'delete'`) or removes their stored content
    # (`'remove-content'`) in one request. Every asset must exist in the project and the key needs
    # `assets:delete` for its folder, or nothing is queued. Returns once the operation is queued; the
    # work runs in the background and records `asset.deleted` or `asset.content-removed` for each
    # asset. Assets under a safety hold are skipped. Not retried: it carries no `Idempotency-Key`.
    # @option options [Array<String>] :asset_ids 1 to 500 asset IDs
    # @option options [String] :operation one of {BATCH_OPERATIONS}
    # @return [Hash] `{'queued' => true}`
    def batch(options)
      call(options, __method__) do |api, request|
        ids = api['assetIds']
        unless ids.is_a?(Array) && ids.size.between?(1, MAX_BATCH_ASSETS)
          raise Internal.invalid("asset_ids must list 1 to #{MAX_BATCH_ASSETS} asset IDs")
        end
        raise Internal.invalid('Every asset ID must be a non-empty string') unless ids.all? { |id| id.is_a?(String) && !id.empty? }
        raise Internal.invalid("operation must be one of #{BATCH_OPERATIONS.join(', ')}") unless BATCH_OPERATIONS.include?(api['operation'])

        request('POST', project('assets/batch'), body: { 'assetIds' => ids, 'operation' => api['operation'] },
                                                 request_options: request)
      end
    end

    # Moves an asset into a folder, or to the project root with `folder_id: nil`.
    # @option options [String] :asset_id
    # @option options [String, nil] :folder_id
    # @return [Hash] the asset
    def move(options)
      call(options, __method__) do |api, request|
        request('POST', "/assets/#{Internal.segment(api['assetId'])}/move",
                body: { 'folderId' => Internal.required(api, 'folderId') }, request_options: request)
      end
    end

    # Creates a time-limited URL that delivers private content without an API key.
    # @option options [String] :asset_id
    # @option options [String] :resource one of {CDN::SIGNED_RESOURCES}: `rendered` (the API's default),
    #   `original`, `preview`, `hls` (the HLS master playlist of audio or video; one signature covers every
    #   playlist and segment beneath `hls/`) or `embed` (the page that shows the asset in an iframe). `original`, `hls`
    #   and `embed` take no lens or transform
    # @option options [Integer] :expires_in_seconds default 900
    # @option options [String] :lens a lens identifier
    # @option options [String, Hash] :transform a selector String or structured options, as for
    #   {CDN#get_asset_url}; they replace the lens's options of the same name
    # @return [Hash] `{'url', 'expiresAt'}`
    def create_signed_url(options)
      call(options, __method__) do |api, request|
        path = "/assets/#{Internal.segment(api['assetId'])}/signed-url"
        body = { 'expiresInSeconds' => DEFAULT_SIGNED_URL_SECONDS }.merge(without(api, 'assetId'))
        check_signed_url(body)
        body['transform'] = Transforms.selector(body['transform']) if body.key?('transform')
        request('POST', path,
                body: body,
                request_options: request)
      end
    end

    # Uploads content and queues moderation; the call returns before classification finishes.
    # Watch for `asset.allowed`, `asset.limited`, `asset.age-restricted`, `asset.blocked` and
    # `asset.purged` events or retrieve the asset later.
    #
    # Give exactly one of `content:` (a whole file), `part:` (the first part of a multipart upload) or
    # `url:` (a web page or file to fetch). Content is `{type:, plain_text:}`, `{type:, base64:}` or
    # `{type:, data:}` where `data` is a binary String or an IO. An IO streams without being read into
    # memory; pass `size_in_bytes:` when its length is unknown (a pipe or socket).
    #
    # The request carries an `Idempotency-Key` (generated unless you pass
    # `request_options: {idempotency_key:}`), so a retried upload never creates a second asset.
    #
    # `content:` larger than the client's `part_size_bytes` (8 MiB by default) whose size is known and
    # that can be read again (a binary String, base64, or a File, StringIO or other seekable IO) is
    # sent as a multipart upload in parts of that size. Each part carries the key
    # `<idempotency_key>:part-<n>` and is retried on its own; calling again with the same
    # `idempotency_key` (at most 240 characters) resumes an interrupted upload. Pipes, sockets and
    # text are sent in one request.
    # @option options [String] :name
    # @option options [Hash] :content
    # @option options [Hash] :part `{type:, data:, is_final:}` for the first multipart part
    # @option options [Integer] :total_size_in_bytes the whole file's size, for multipart uploads
    # @option options [String] :url
    # @option options [String] :author_id your identifier for who wrote the content; CalmLens only
    #   compares it with the author IDs in `context`, to tell which posts share a speaker.
    # @option options [Hash] :context `{items: [{text:, author_id:}]}`, earlier posts in the
    #   conversation, oldest first. Only the posts CalmLens uses are sent: the most recent
    #   {ModerationContext::USED_ITEMS} that fit in {ModerationContext::USED_CHARACTERS} characters.
    # @return [Hash] the asset
    def create(options)
      call(options, __method__) { |api, request| submit(api, request, true) }
    end

    # Uploads content and waits for the moderation decision where the content type supports it.
    # Audio and video are always processed asynchronously. Takes the options of {#create}.
    # @return [Hash] the asset; show it to everyone only when `classification.moderation.status` is
    #   `allowed` or `limited` (reduce the reach of `limited` assets). Serve `age-restricted` assets
    #   only behind your own age check, through signed URLs.
    def classify(options)
      call(options, __method__) do |api, request|
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
      call(options, __method__) do |api, request|
        Internal.segment(api['assetId'])
        part = api['part']
        raise Internal.invalid('part is required') unless part.is_a?(Hash)

        number = part['partNumber']
        unless number.is_a?(Integer) && number.positive?
          raise Internal.invalid('partNumber must be a positive Integer',
                                 ErrorCodes::INVALID_UPLOAD_PART_NUMBER)
        end

        body = UploadBody.from(part, multipart: true, part_size: !@session.defer_upload_checks)
        send_part(api['assetId'], number, part.fetch('isFinal', false), body, api.fetch('queue', nil), request)
      end
    end

    private

    # Waits between decision checks; a mock client's waits take no real time.
    def sleep(seconds) = @session.pause(seconds)

    def poll_for_decision(asset_id, request_options, timeout)
      deadline = @session.monotonic + timeout
      delay = DECISION_POLL_FIRST_DELAY
      loop do
        asset = retrieve('assetId' => asset_id, 'request_options' => request_options)
        processing = asset.dig('classification', 'status')
        moderation = asset.dig('classification', 'moderation', 'status')
        return asset if moderation != PENDING_MODERATION_STATUS || FINISHED_PROCESSING_STATUSES.include?(processing)

        remaining = deadline - @session.monotonic
        unless remaining.positive?
          raise TimeoutError.new(SdkErrorCodes::TIMEOUT,
                                 "Asset #{asset['id']} had no moderation decision after #{timeout}s " \
                                 "(processing #{processing}, moderation #{moderation})",
                                 details: { 'assetId' => asset['id'], 'classificationStatus' => processing,
                                            'moderationStatus' => moderation })
        end

        sleep([delay, remaining].min)
        delay = [delay * DECISION_POLL_FACTOR, DECISION_POLL_MAX_DELAY].min
      end
    end

    def submit(options, request_options, queue)
      raise Internal.invalid('Asset name is required', ErrorCodes::INVALID_UPLOAD_PAYLOAD) if options['name'].to_s.empty?
      unless %w[content part url].one? { |key| options.key?(key) } && !options.key?('isFinal')
        raise Internal.invalid('Supply exactly one of content, part, or url; isFinal belongs in part',
                               ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end
      options = with_used_context(options)
      if options.key?('url')
        return expect_asset(request('POST', project('assets'), query: { 'queue' => queue }, body: options,
                                                               idempotent: true, request_options: request_options))
      end

      multipart = options.key?('part')
      content = options.fetch(multipart ? 'part' : 'content')
      raise Internal.invalid('Upload content must be a Hash', ErrorCodes::INVALID_UPLOAD_PAYLOAD) unless content.is_a?(Hash)

      mime = check_mime(content['type'])
      if multipart && content.fetch('partNumber', 1) != 1
        raise Internal.invalid('Use uploadPart for multipart upload parts after the first part', ErrorCodes::USE_UPLOAD_PART)
      end

      body = UploadBody.from(content, multipart: multipart, part_size: !@session.defer_upload_checks)
      return upload_in_parts(options, request_options, queue, mime, body) if !multipart && splits?(content, body)

      check_upload_size(mime, body.size) unless multipart || @session.defer_upload_checks
      query = options.slice(*SUBMIT_QUERY_KEYS).merge('queue' => queue, 'contentType' => content['type'],
                                                      'sizeInBytes' => body.size)
      query.merge!(first_part_query(options, content, mime, body)) if multipart
      expect_asset(request('POST', project('assets'),
                           query: query, raw: body, idempotent: true, request_options: request_options,
                           upload: !content.key?('plainText'),
                           headers: { 'Content-Type' => content['type'], 'X-CalmLens-Upload' => multipart ? 'part' : 'content' }))
    end

    # Whether content goes in parts: not text, of known size, readable again and larger than a part.
    def splits?(content, body)
      !content.key?('plainText') && !body.size.nil? && body.replayable? && body.size > @session.part_size_bytes
    end

    # Uploads `body` as a multipart upload of `part_size_bytes` parts and returns the final part's
    # asset. Part `n` after the first carries the key `<key>:part-<n>`, so repeating the call with
    # the same key replays the parts the API already has and sends the rest.
    def upload_in_parts(options, request_options, queue, mime, body)
      key = request_options[:idempotency_key] || SecureRandom.uuid
      if key.length > MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH
        raise Internal.invalid("idempotency_key can have at most #{MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH} characters " \
                               'for content uploaded in parts')
      end
      unless @session.defer_upload_checks
        mime.start_with?('image/') ? check_image_size(body.size) : check_upload_size(mime, body.size, in_parts: true)
      end

      total = body.size
      part_size = @session.part_size_bytes
      count = (total + part_size - 1) / part_size
      piece = ->(number) { body.slice((number - 1) * part_size, [part_size, total - ((number - 1) * part_size)].min) }
      first = piece.call(1)
      type = options.dig('content', 'type')
      query = options.slice(*SUBMIT_QUERY_KEYS).merge('queue' => queue, 'contentType' => type, 'sizeInBytes' => first.size,
                                                      'partNumber' => 1, 'isFinal' => false, 'totalSizeInBytes' => total)
      asset = expect_asset(request('POST', project('assets'),
                                   query: query, raw: first, idempotent: true, upload: true,
                                   request_options: request_options.merge(idempotency_key: key),
                                   headers: { 'Content-Type' => type, 'X-CalmLens-Upload' => 'part' }))
      send_remaining_parts(asset, count, piece, key, request_options)
    end

    # Sends parts 2 to `count`. A part the API already has (its response was lost) is skipped, and a
    # final part that finds the upload completed reads the asset back.
    def send_remaining_parts(asset, count, piece, key, request_options)
      id = asset['id']
      number = 2
      while number <= count
        final = number == count
        begin
          asset = send_part(id, number, final, piece.call(number), nil,
                            request_options.merge(idempotency_key: "#{key}:part-#{number}"))
        rescue Error => e
          expected = e.details.is_a?(Hash) ? e.details['expectedPartNumber'] : nil
          if e.code == ErrorCodes::INVALID_UPLOAD_PART_NUMBER && expected.is_a?(Integer) && expected > number && expected <= count
            number = expected
            next
          end
          if final && e.code == ErrorCodes::UPLOAD_NOT_OPEN
            return retrieve('assetId' => id, 'request_options' => request_options.except(:idempotency_key))
          end

          raise
        end
        number += 1
      end
      asset
    end

    def send_part(asset_id, number, final, body, queue, request_options)
      query = { 'partNumber' => number, 'isFinal' => final, 'sizeInBytes' => body.size }
      query['queue'] = queue unless queue.nil?
      headers = { 'Content-Type' => 'application/octet-stream', 'X-CalmLens-Upload' => 'part' }
      expect_asset(request('POST', "/assets/#{Internal.segment(asset_id)}/part", query: query, raw: body, idempotent: true,
                                                                                 request_options: request_options, upload: true,
                                                                                 headers: headers))
    end

    # Keeps only the earlier posts CalmLens uses, which keeps a raw upload's query short.
    def with_used_context(options)
      return options unless options.key?('context')

      context = options['context']
      raise Internal.invalid('context must be a Hash with items') unless context.is_a?(Hash) && context.key?('items')

      options.merge('context' => { 'items' => ModerationContext.select_items(context['items']) })
    end

    # The query of a first multipart part: its number, whether it is the last and the declared total.
    def first_part_query(options, content, mime, body)
      total = options['totalSizeInBytes']
      unless total.nil? || (total.is_a?(Integer) && total.positive?)
        raise Internal.invalid('totalSizeInBytes must be a positive Integer', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end

      final = content.fetch('isFinal', false)
      unless @session.defer_upload_checks
        # A declared whole-file size over the limit for parts can never finish.
        mime.start_with?('image/') ? check_image_size(total || body.size) : check_upload_size(mime, total, in_parts: true)
      end
      { 'partNumber' => 1, 'isFinal' => final, 'totalSizeInBytes' => total }
    end

    # Like the API's asset responses: an ID and string statuses for the upload, classification and moderation.
    def expect_asset(data)
      valid = data.is_a?(Hash) && data['id'].is_a?(String) && !data['id'].empty? &&
              data['upload'].is_a?(Hash) && data['upload']['status'].is_a?(String) &&
              data['classification'].is_a?(Hash) && data['classification']['status'].is_a?(String) &&
              data.dig('classification', 'moderation').is_a?(Hash) &&
              data.dig('classification', 'moderation', 'status').is_a?(String)
      return data if valid

      raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Expected an asset response', status: 200)
    end

    def check_signed_url(body)
      resource = body.fetch('resource', 'rendered')
      unless CDN::SIGNED_RESOURCES.include?(resource)
        raise Internal.invalid("A signed URL's resource must be one of #{CDN::SIGNED_RESOURCES.join(', ')}")
      end
      if Internal::UNSELECTABLE_CDN_RESOURCES.include?(resource) && (body.key?('lens') || body.key?('transform'))
        raise Internal.invalid("The #{resource} resource takes no lens or transform")
      end

      expires = body['expiresInSeconds']
      return if expires.is_a?(Integer) && expires.between?(1, MAX_SIGNED_URL_SECONDS)

      raise Internal.invalid('expires_in_seconds must be a whole number from 1 to 86400')
    end

    def check_mime(type)
      mime = type.to_s.split(';').first.to_s.strip.downcase
      unless Internal.accepted_upload_mime_type?(mime)
        raise InvalidArgumentError.new(ErrorCodes::INVALID_UPLOAD_MIME_TYPE,
                                       "#{mime} is not a valid upload file type. Uploads must use a concrete file MIME " \
                                       'type that CalmLens can store and process, such as image/png, image/jpeg, ' \
                                       'application/pdf, or text/plain.', details: { 'mimeType' => type })
      end
      raise Internal.invalid('Content type cannot contain line breaks') unless type.match?(Internal::HEADER_VALUE)

      mime
    end

    # Refuses content whose known size is over the API's limit for its type, before any of it is
    # sent: `in_parts` selects the limits for content sent in parts. Images in parts are checked by
    # {#check_image_size}.
    def check_upload_size(mime, size, in_parts: false)
      return if size.nil?

      limit, message = if mime.start_with?('image/')
                         [MAX_DIRECT_IMAGE_BYTES, 'Images uploaded in one request can be at most 10 MiB; upload larger images in parts']
                       elsif mime.start_with?('audio/', 'video/')
                         [in_parts ? MAX_LONG_MEDIA_BYTES : MAX_MEDIA_BYTES,
                          'Audio and video files can be at most 50 MiB in one request, or 2 GiB in parts']
                       else
                         [MAX_FILE_BYTES, 'Files can be at most 5,000 MiB']
                       end
      raise Internal.invalid(message, ErrorCodes::FILE_TOO_LARGE) if size > limit
    end

    # Images in parts total at most 20 MiB, at any size below that; a declared total is checked
    # from the start.
    def check_image_size(size)
      return unless size > MAX_MULTIPART_IMAGE_BYTES

      raise Internal.invalid('Multipart image uploads cannot exceed 20MB.', ErrorCodes::MULTIPART_IMAGE_TOO_LARGE)
    end
  end
end
