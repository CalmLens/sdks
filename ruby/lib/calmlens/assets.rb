# frozen_string_literal: true

require 'securerandom'

module CalmLens
  # Uploads, moderation and management of assets. Reach it through {ServerClient#assets}.
  #
  # Methods take an asset's ID as their first argument and options as snake_case keywords; keys
  # inside `metadata` are sent unchanged. Any method also accepts
  # `request_options: { idempotency_key:, timeout:, open_timeout:, max_retries: }`.
  # Results are {Asset} models. Enum values added to the API later appear as they are, so compare
  # `classification.moderation.decision` and similar values with known strings and treat anything
  # else as not ready.
  class Assets < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'assets'

    # The asset fields an upload carries in its body: the JSON body for text, the `options` part of
    # an upload form for files. They never go in the URL, which proxies and servers log, and the
    # API refuses them there.
    UPLOAD_OPTION_KEYS = %w[name description processingOptions visibility metadata tags authorId context externalId
                            externalUrl folderId uploadPresetId].freeze
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
    # The classification statuses of a settled asset: `completed` (with its decision in
    # `classification.moderation.decision`) or `failed`. {#wait_for_decision} returns at the first.
    SETTLED_STATUSES = %w[completed failed].freeze
    DECISION_POLL_FIRST_DELAY = 0.5
    # Each wait between decision checks is this many times the one before, up to DECISION_POLL_MAX_DELAY.
    DECISION_POLL_FACTOR = 1.5
    DECISION_POLL_MAX_DELAY = 2.0
    DEFAULT_DECISION_TIMEOUT = 60
    # The operations {#batch} runs: `delete` deletes each asset with its child assets and stored
    # content; `remove-content` removes its stored content and keeps the record.
    BATCH_OPERATIONS = %w[delete remove-content].freeze
    # The most assets one {#batch} request takes.
    MAX_BATCH_ASSETS = 500

    # Searches assets by meaning or keyword.
    # @option options [String] :query
    # @option options [String] :mode `hybrid`, `semantic` or `keyword`
    # @option options [Integer] :page_size how many results, 1 to 20 (default 10)
    # @return [AssetSearchResult] `query`, `items` (each with `asset`, `score` and `matched_fields`) and
    #   `semantic_status`
    def search(**options)
      call(options, __method__) do |api, request|
        build(AssetSearchResult, request('GET', project('assets/search'), query: api, request_options: request))
      end
    end

    # Lists one page of assets, newest first unless `sort` says otherwise.
    # @option options [String] :cursor from the previous page
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String, nil] :filter an RSQL filter such as `classification.moderation.decision==allowed`;
    #   `folderId==fldr_…` lists one folder's assets and `folderId==null` the project root's
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`, such as `-createdAt,id`; `-createdAt` by default
    # @return [AssetPage] {Page#auto_paging_each} fetches the rest.
    def list(**options)
      call(options, __method__) do |api, request|
        page(AssetPage, request('GET', project('assets'), query: api, request_options: request), options) { list(**_1) }
      end
    end

    # Lists one page of an asset's children, such as frames extracted from a video.
    # @param asset_id [String]
    # @option options [String] :cursor
    # @option options [Integer] :page_size
    # @option options [String] :sort as for {#list}
    # @return [AssetPage] {Page#auto_paging_each} fetches the rest.
    def list_children(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        response = request('GET', "#{asset_path(api)}/children", query: without(api, 'assetId'), request_options: request)
        page(AssetPage, response, options) { list_children(asset_id, **_1) }
      end
    end

    # Lists one page of an audio or video asset's findings timeline, in time order.
    # `classification.moderation.timeline.segmentCount` says how many segments there are. Pass each
    # page's `next_cursor` back unchanged; cursors are opaque.
    # @param asset_id [String]
    # @option options [String] :cursor
    # @option options [Integer] :page_size
    # @return [AssetTimelinePage] {Page#auto_paging_each} fetches the rest.
    def list_timeline(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        response = request('GET', project("assets/#{Internal.segment(api['assetId'])}/timeline"), query: without(api, 'assetId'),
                                                                                                  request_options: request)
        page(AssetTimelinePage, response, options) { list_timeline(asset_id, **_1) }
      end
    end

    # @param asset_id [String]
    # @return [Asset]
    def retrieve(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) { |api, request| get_asset(api['assetId'], request) }
    end

    # Waits until an asset is settled, its `classification.status` `completed` (with its decision in
    # `classification.moderation.decision`) or `failed`, and returns the asset. A `queued` or `processing`
    # asset is still waiting, even when a reviewer has already decided it. It retrieves the asset,
    # waiting 0.5 seconds before the second check and 1.5 times longer each time after that, up to 2
    # seconds.
    # Webhooks report decisions without polling.
    #
    # `timeout:` is the whole wait in seconds; `request_options: {timeout:}` still limits each request.
    # To stop waiting early, run the call in a thread you can stop: it only sleeps and sends requests.
    # @param asset_id [String]
    # @option options [Numeric] :timeout seconds to wait for a decision (default 60)
    # @return [Asset] the settled asset
    # @raise [TimeoutError] `sdk/timeout` when the asset isn't settled in time; `details` holds
    #   `'assetId'` and the last `'classificationStatus'` and `'moderationDecision'`.
    def wait_for_decision(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        timeout = api.fetch('timeout', DEFAULT_DECISION_TIMEOUT)
        unless timeout.is_a?(Numeric) && timeout.real? && timeout.to_f.finite? && !timeout.negative?
          raise Internal.invalid('timeout must be a non-negative number of seconds')
        end

        poll_for_decision(api['assetId'], request, timeout)
      end
    end

    # Updates an asset's name, description, tags, visibility, metadata and similar fields.
    # @param asset_id [String]
    # @return [Asset] the updated asset
    def update(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        build(Asset, request('PATCH', asset_path(api), body: without(api, 'assetId'), request_options: request))
      end
    end

    # Processes an asset whose `classification.status` is `failed` again.
    # @param asset_id [String]
    # @return [Asset]
    def retry(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        build(Asset, request('POST', "#{asset_path(api)}/retry", request_options: request))
      end
    end

    # Records a reviewer's decision, replacing the policy's: `classification.moderation.decision`
    # becomes the decision, the decision and note join `classification.moderation.manualReviews` and
    # the matching `asset.<status>` event is sent with the API key as its `actor`. An asset still pending
    # moderation can only be blocked or purged. Purging needs `confirm_purge: true` and the
    # `assets:delete` permission, and permanently deletes the stored content. Not retried: it carries
    # no `Idempotency-Key`.
    # @param asset_id [String]
    # @option options [String] :decision `allowed`, `limited`, `age-restricted`, `blocked` or `purged`
    # @option options [String] :note why, 1 to 1499 characters
    # @option options [Boolean] :confirm_purge must be true to purge
    # @return [Asset]
    def decide(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        build(Asset, request('POST', "#{asset_path(api)}/decision", body: without(api, 'assetId'), request_options: request))
      end
    end

    # Completes the policy evidence behind a decided asset's moderation decision: the report's
    # `classification.moderation.explanationComplete` becomes `true` and every action stays as decided.
    # With `rerun: true` the asset is moderated again with the project's current policy and an
    # `asset.rerun-requested` event is recorded; use it when the policy changed since the decision
    # (`asset/policy-changed`). The asset returns unchanged: it keeps its decision until the re-run's
    # is stored, reported by `asset.classified` and `asset.<status>` events, and a failed re-run keeps
    # it. A reviewed asset raises `asset/reviewed`, and one whose content is gone
    # `asset/content-unavailable`.
    # @param asset_id [String]
    # @option options [Boolean] :rerun
    # @return [Asset]
    def explain(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        build(Asset, request('POST', "#{asset_path(api)}/explain", body: api['rerun'] ? { 'rerun' => true } : {},
                                                                   request_options: request))
      end
    end

    # Removes the stored content and returns the asset with `content.status` `removed` (reason
    # `requested`); the record and classification results are kept.
    # @param asset_id [String]
    # @return [Asset]
    def remove_content(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        build(Asset, request('DELETE', "#{asset_path(api)}/content", request_options: request))
      end
    end

    # Deletes the asset record and its stored content. An asset extracted from another (one with a
    # `parentId`) raises `asset/child-not-deletable`: delete its parent instead.
    # @param asset_id [String]
    # @return [nil]
    def delete(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        request('DELETE', asset_path(api), request_options: request)
        nil
      end
    end

    # Deletes up to 500 assets (`operation: 'delete'`) or removes their stored content
    # (`'remove-content'`) in one request. Every asset must exist in the project and the key needs
    # `assets:delete` for its folder, and a deletion can't name an asset extracted from another
    # (`asset/child-not-deletable`), or nothing is queued. Returns once the operation is queued; the
    # work runs in the background and records `asset.deleted` or `asset.content-removed` for each
    # asset, with a `batch-id` fact naming `batchId`. Assets under a safety hold are skipped. Not
    # retried: it carries no `Idempotency-Key`.
    # @option options [Array<String>] :asset_ids 1 to 500 asset IDs
    # @option options [String] :operation one of {BATCH_OPERATIONS}
    # @return [AssetBatch] `batch_id`, `status` (`queued`) and `asset_count`
    def batch(**options)
      call(options, __method__) do |api, request|
        ids = api['assetIds']
        unless ids.is_a?(Array) && ids.size.between?(1, MAX_BATCH_ASSETS)
          raise Internal.invalid("asset_ids must list 1 to #{MAX_BATCH_ASSETS} asset IDs")
        end
        raise Internal.invalid('Every asset ID must be a non-empty string') unless ids.all? { |id| id.is_a?(String) && !id.empty? }
        raise Internal.invalid("operation must be one of #{BATCH_OPERATIONS.join(', ')}") unless BATCH_OPERATIONS.include?(api['operation'])

        build(AssetBatch, request('POST', project('assets/batch'), body: { 'assetIds' => ids, 'operation' => api['operation'] },
                                                                   request_options: request))
      end
    end

    # Moves an asset into a folder, or to the project root with `folder_id: nil`.
    # @param asset_id [String]
    # @option options [String, nil] :folder_id
    # @return [Asset]
    def move(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        build(Asset, request('POST', "#{asset_path(api)}/move", body: { 'folderId' => Internal.required(api, 'folderId') },
                                                                request_options: request))
      end
    end

    # Uploads content and returns without waiting for its decision (`wait=false`), with
    # `classification.status` `queued`.
    # Watch for `asset.allowed`, `asset.limited`, `asset.age-restricted`, `asset.blocked` and
    # `asset.purged` events or retrieve the asset later.
    #
    # Give exactly one of `content:` (a whole file), `part:` (the first part of a multipart upload) or
    # `url:` (a web page or file to fetch). Content is `{type:, plain_text:}`, `{type:, base64:}` or
    # `{type:, data:}` where `data` is a binary String or an IO. An IO streams without being read into
    # memory; pass `size_in_bytes:` when its length is unknown (a pipe or socket).
    #
    # Text is sent as a JSON body. Other content is sent as `multipart/form-data`: the asset's fields
    # (name, description, metadata, author ID, context and so on) in its `options` part, then the
    # file. The URL carries only transport values (`wait`, the content type and sizes), never the
    # asset's fields.
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
    # @option options [Array<String>] :tags tags for the asset, such as `['catalogue', 'backpacks']`
    # @option options [String] :author_id your identifier for who wrote the content; CalmLens only
    #   compares it with the author IDs in `context`, to tell which posts share a speaker.
    # @option options [Hash] :context `{items: [{text:, author_id:}]}`, earlier posts in the
    #   conversation, oldest first. Only the posts CalmLens uses are sent: the most recent
    #   {ModerationContext::USED_ITEMS} that fit in {ModerationContext::USED_CHARACTERS} characters.
    # @return [Asset]
    def create(**options)
      call(options, __method__) { |api, request| submit(api, request, false) }
    end

    # Uploads content and waits for the moderation decision where the content type supports it.
    # Documents, websites, audio, video and files over 20 MiB sent in parts always finish in the
    # background and return `pending`. Takes the options of {#create}.
    # @return [Asset] show it to everyone only when `classification.moderation.decision` is
    #   `allowed` or `limited` (reduce the reach of `limited` assets). Serve `age-restricted` assets
    #   only behind your own age check, through signed URLs.
    def classify(**options)
      call(options, __method__) do |api, request|
        content = api['content']
        if content.is_a?(Hash) && content.key?('plainText') && (!content['plainText'].is_a?(String) || content['plainText'].strip.empty?)
          raise Internal.invalid('Text to classify must be a non-empty string', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
        end

        submit(api, request, true)
      end
    end

    # Uploads a later part of a multipart upload started with {#create} or {#classify} and `part:`.
    # Whether the final part waits for the decision was chosen when the upload started; pass `wait:`
    # only to override it.
    # @param asset_id [String]
    # @option options [Hash] :part `{data:, part_number:, is_final:}`; part numbers start at 2.
    # @option options [Boolean] :wait `true` to wait for the decision, `false` to return with the
    #   asset `queued`
    # @return [Asset] `classification.status` stays `uploading` until the final part.
    def upload_part(asset_id, **options)
      call(with_ids(options, asset_id: asset_id), __method__) do |api, request|
        Internal.segment(api['assetId'])
        part = api['part']
        raise Internal.invalid('part is required') unless part.is_a?(Hash)

        number = part['partNumber']
        unless number.is_a?(Integer) && number.positive?
          raise Internal.invalid('partNumber must be a positive Integer',
                                 ErrorCodes::INVALID_UPLOAD_PART_NUMBER)
        end

        body = UploadBody.from(part, multipart: true, part_size: !@session.defer_upload_checks)
        send_part(api['assetId'], number, part.fetch('isFinal', false), body, api.fetch('wait', nil), request)
      end
    end

    private

    # Waits between decision checks; a mock client's waits take no real time.
    def sleep(seconds) = @session.pause(seconds)

    def asset_path(api) = "/assets/#{Internal.segment(api['assetId'])}"

    def get_asset(asset_id, request_options)
      build(Asset, request('GET', "/assets/#{Internal.segment(asset_id)}", request_options: request_options))
    end

    def poll_for_decision(asset_id, request_options, timeout)
      deadline = @session.monotonic + timeout
      delay = DECISION_POLL_FIRST_DELAY
      processing = moderation = nil
      loop do
        remaining = deadline - @session.monotonic
        break if timeout.positive? && !remaining.positive?

        # The outer deadline covers transport retries and the entire response read.
        asset = ::Timeout.timeout(timeout.zero? ? nil : remaining) do
          get_asset(asset_id, request_options)
        end
        remaining = deadline - @session.monotonic
        break if timeout.positive? && !remaining.positive?

        processing = asset.classification&.status
        moderation = asset.classification&.moderation&.decision
        return asset if SETTLED_STATUSES.include?(processing)
        break unless remaining.positive?

        sleep([delay, remaining].min)
        delay = [delay * DECISION_POLL_FACTOR, DECISION_POLL_MAX_DELAY].min
      end
      raise ::Timeout::Error
    rescue ::Timeout::Error
      raise TimeoutError.new(SdkErrorCodes::TIMEOUT, "Asset #{asset_id} was not settled after #{timeout}s",
                             details: { 'assetId' => asset_id, 'classificationStatus' => processing,
                                        'moderationDecision' => moderation })
    end

    def submit(options, request_options, wait)
      raise Internal.invalid('Asset name is required', ErrorCodes::INVALID_UPLOAD_PAYLOAD) if options['name'].to_s.empty?
      unless %w[content part url].one? { |key| options.key?(key) } && !options.key?('isFinal')
        raise Internal.invalid('Supply exactly one of content, part, or url; isFinal belongs in part',
                               ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end
      options = with_used_context(options)
      if options.key?('url')
        return expect_asset(request('POST', project('assets'), query: { 'wait' => wait }, body: options,
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
      return upload_in_parts(options, request_options, wait, mime, body) if !multipart && splits?(content, body)

      check_upload_size(mime, body.size) unless multipart || @session.defer_upload_checks
      part_query = first_part_query(options, content, mime, body) if multipart
      if content.key?('plainText')
        return expect_asset(request('POST', project('assets'), query: { 'wait' => wait },
                                                               body: text_body(options, content, multipart),
                                                               idempotent: true, request_options: request_options))
      end

      query = { 'wait' => wait, 'contentType' => content['type'], 'sizeInBytes' => body.size }
      send_form(query.merge(part_query || {}), upload_fields(options), content['type'], body, multipart, request_options)
    end

    # The asset fields an upload sends, without unset values.
    def upload_fields(options) = options.slice(*UPLOAD_OPTION_KEYS).compact

    # The JSON body of a text upload: its fields and `content`, or a first `part` with the sizes.
    def text_body(options, content, multipart)
      text = content.except('sizeInBytes')
      return upload_fields(options).merge('content' => text) unless multipart

      sizes = { 'sizeInBytes' => options['sizeInBytes'] || content['sizeInBytes'],
                'totalSizeInBytes' => options['totalSizeInBytes'] }.compact
      upload_fields(options).merge('part' => text, **sizes)
    end

    # Sends file content, or a first part, as an upload form: the fields in its `options` part and
    # the bytes in its `file` part. The query holds only transport values.
    def send_form(query, fields, type, body, multipart, request_options)
      form, form_type = body.to_form(JSON.generate(fields), type)
      expect_asset(request('POST', project('assets'),
                           query: query, raw: form, idempotent: true, request_options: request_options, upload: true,
                           headers: { 'Content-Type' => form_type, 'X-CalmLens-Upload' => multipart ? 'part' : 'content' }))
    end

    # Whether content goes in parts: not text, of known size, readable again and larger than a part.
    def splits?(content, body)
      !content.key?('plainText') && !body.size.nil? && body.replayable? && body.size > @session.part_size_bytes
    end

    # Uploads `body` as a multipart upload of `part_size_bytes` parts and returns the final part's
    # asset. Part `n` after the first carries the key `<key>:part-<n>`, so repeating the call with
    # the same key replays the parts the API already has and sends the rest.
    def upload_in_parts(options, request_options, wait, mime, body)
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
      query = { 'wait' => wait, 'contentType' => type, 'sizeInBytes' => first.size, 'partNumber' => 1, 'isFinal' => false,
                'totalSizeInBytes' => total }
      asset = send_form(query, upload_fields(options), type, first, true, request_options.merge(idempotency_key: key))
      send_remaining_parts(asset, count, piece, key, request_options)
    end

    # Sends parts 2 to `count`. A part the API already has (its response was lost) is skipped, and a
    # final part that finds the upload completed reads the asset back.
    def send_remaining_parts(asset, count, piece, key, request_options)
      id = asset.id
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
          return get_asset(id, request_options.except(:idempotency_key)) if final && e.code == ErrorCodes::UPLOAD_NOT_OPEN

          raise
        end
        number += 1
      end
      asset
    end

    def send_part(asset_id, number, final, body, wait, request_options)
      query = { 'partNumber' => number, 'isFinal' => final, 'sizeInBytes' => body.size }
      query['wait'] = wait unless wait.nil?
      headers = { 'Content-Type' => 'application/octet-stream', 'X-CalmLens-Upload' => 'part' }
      expect_asset(request('POST', "/assets/#{Internal.segment(asset_id)}/part", query: query, raw: body, idempotent: true,
                                                                                 request_options: request_options, upload: true,
                                                                                 headers: headers))
    end

    # Keeps only the earlier posts CalmLens uses, which keeps an upload's body short.
    def with_used_context(options)
      return options unless options.key?('context')

      context = options['context']
      raise Internal.invalid('context must be a Hash with items') unless context.is_a?(Hash) && context.key?('items')

      options.merge('context' => { 'items' => ModerationContext.select_items(context['items']) })
    end

    # The transport values of a first multipart part: its number, whether it is the last and the
    # declared total.
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

    # Like the API's asset responses: an ID, string statuses for the upload and classification, and a
    # moderation decision, null until moderation decides.
    def expect_asset(data)
      valid = data.is_a?(Hash) && data['id'].is_a?(String) && !data['id'].empty? &&
              data['upload'].is_a?(Hash) && data['upload']['status'].is_a?(String) &&
              data['classification'].is_a?(Hash) && data['classification']['status'].is_a?(String) &&
              data.dig('classification', 'moderation').is_a?(Hash) &&
              data.dig('classification', 'moderation').key?('decision') &&
              [String, NilClass].include?(data.dig('classification', 'moderation', 'decision').class)
      return build(Asset, data) if valid

      raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Expected an asset response', status: 200)
    end

    def check_mime(type)
      mime = type.to_s.split(';').first.to_s.strip.downcase
      unless Internal.accepted_upload_mime_type?(mime)
        raise InvalidArgumentError.new(ErrorCodes::UNSUPPORTED_UPLOAD_TYPE,
                                       "#{mime} is not a valid upload file type. Uploads must use a concrete file MIME " \
                                       'type that CalmLens can store and process, such as image/png, image/jpeg, ' \
                                       'application/pdf, or text/plain.', details: { 'mimeType' => type, 'source' => 'calmlens' })
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
      raise too_large(message, limit) if size > limit
    end

    # Images in parts total at most 20 MiB, at any size below that; a declared total is checked
    # from the start.
    def check_image_size(size)
      return unless size > MAX_MULTIPART_IMAGE_BYTES

      raise too_large('Multipart image uploads cannot exceed 20 MiB.', MAX_MULTIPART_IMAGE_BYTES)
    end

    # `upload/too-large` for content over the plan's `limit` bytes, as the API answers it.
    def too_large(message, limit)
      InvalidArgumentError.new(ErrorCodes::UPLOAD_TOO_LARGE, message, details: { 'limitBytes' => limit, 'source' => 'plan' })
    end
  end
end
