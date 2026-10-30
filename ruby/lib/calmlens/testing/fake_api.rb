# frozen_string_literal: true

require 'digest'
require 'json'
require 'securerandom'
require 'uri'
require_relative 'placeholder'

module CalmLens
  module Testing
    # Raised inside the fake API to answer with a CalmLens error response.
    # @api private
    class Failure < StandardError
      attr_reader :code, :details, :status

      def initialize(code, message = nil, details: nil, status: nil)
        super(message || code)
        @code = code
        @details = details
        @status = status
      end
    end

    # In-memory records behind {MockServerClient}. Change them to arrange a test, such as setting an
    # asset's `classification.moderation.status`.
    #
    # @!attribute assets [Hash{String => Hash}] assets by ID, with API field names.
    # @!attribute folders [Hash{String => Hash}] folders by ID.
    # @!attribute content [Hash{String => Hash}] stored bytes by asset ID: `{'type', 'parts' => {n => bytes}}`.
    # @!attribute events [Array<Hash>] the events feed, oldest first.
    # @!attribute lenses [Hash{String => Hash}] lenses by identifier.
    # @!attribute hash_lists [Hash{String => Hash}] hash lists by ID.
    # @!attribute hash_list_entries [Hash{String => Hash}] hash list entries by ID.
    State = Struct.new(:assets, :folders, :content, :events, :lenses, :uploads, :idempotency, :hash_lists,
                       :hash_list_entries, keyword_init: true)

    # A stateful stand-in for the CalmLens API and CDN. It stores assets and folders, applies
    # filters and ordering, serves stored bytes, and answers errors with the API's codes, statuses,
    # details and body shape, checking requests in the API's order. It does not classify content,
    # run transforms or index for semantic search.
    # @api private
    class FakeAPI
      JSON_QUERY = %w[queue isFinal sizeInBytes totalSizeInBytes partNumber pageSize searchAll resolveOnly limit
                      processingOptions metadata context].freeze
      # Keyword search fields, in the order matches are reported, and where each value sits in the asset.
      SEARCH_FIELDS = { 'name' => %w[name], 'id' => %w[id], 'externalId' => %w[externalId],
                        'description' => %w[description], 'tags' => %w[tags], 'type' => %w[type],
                        'content.format' => %w[content format], 'content.extension' => %w[content extension],
                        'classification.moderation.status' => %w[classification moderation status] }.freeze
      MAX_SEARCH_TOKENS = 8
      MAX_SEARCH_LIMIT = 20
      MAX_SEARCH_QUERY_LENGTH = 200
      DEFAULT_EVENTS_PAGE_SIZE = 50
      DEFAULT_PAGE_SIZE = 10
      MAX_PAGE_SIZE = 100
      REVIEW_DECISIONS = %w[allowed limited age-restricted blocked purged].freeze
      MAX_DECISION_NOTE_LENGTH = 1499
      RESOURCES = %w[original rendered placeholder].freeze
      MIN_PART = 5 * 1024 * 1024
      MIN_MULTIPART_IMAGE = 10 * 1024 * 1024
      MAX_MULTIPART_IMAGE = 20 * 1024 * 1024
      # The ThumbHash the mock gives every classified image, standing in for one computed from its
      # pixels. The `placeholder` resource serves it as a PNG, like the CDN.
      THUMBHASH = '1QcSHQRnh493V4dIh4eXh1h4kJUI'
      # Like the API: 1 to 255 printable ASCII characters, without a space at either end.
      IDEMPOTENCY_KEY = /\A[\x21-\x7e](?:[\x20-\x7e]{0,253}[\x21-\x7e])?\z/
      # Content a browser could run as a document, which the CDN serves as a download.
      ACTIVE_TYPES = %w[image/svg+xml application/xhtml+xml text/html application/xml text/xml].freeze

      attr_reader :state
      # The mock API key's `{ 'actions', 'folderId', 'includeSubfolders' }` grants.
      attr_accessor :grants

      def initialize(project_id:, base_url:, cdn_base_url:, now:, create_id:, queued_outcome:, analyzed_outcome:, grants:)
        @project_id = project_id
        @base_url = base_url
        @cdn_base_url = cdn_base_url
        @now = now
        @create_id = create_id
        @queued_outcome = queued_outcome
        @analyzed_outcome = analyzed_outcome
        @grants = grants
        @state = State.new(assets: {}, folders: {}, content: {}, events: [], lenses: {}, uploads: {}, idempotency: {},
                           hash_lists: {}, hash_list_entries: {})
        @request_count = 0
      end

      # Adds an event to the feed, filling the fields the API always sets.
      def add_event(event)
        time = @now.call
        record = { 'id' => @create_id.call('evt'), 'projectId' => @project_id, 'severity' => 'low', 'facts' => [],
                   'createdAt' => time, 'updatedAt' => time }.merge(event)
        record['title'] ||= record['type']
        @state.events << record
        record
      end

      # Applies a reviewer's decision, adds the matching events and returns the asset, or nil when
      # there is no such asset. A purge removes the content with reason `requested`.
      def decide(asset_id, decision)
        unless REVIEW_DECISIONS.include?(decision)
          raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT,
                                         "Review decisions are #{REVIEW_DECISIONS.join(', ')} (got #{decision.inspect})")
        end
        item = @state.assets[asset_id]
        return unless item && item['projectId'] == @project_id

        record_decision(item, decision, nil, nil)
        deep_copy(item)
      end

      # @return [Response]
      def handle(method, url, headers, body)
        if url.start_with?("#{@cdn_base_url}/")
          serve(method, url.delete_prefix(@cdn_base_url))
        else
          api(method, url.delete_prefix(@base_url), headers, body)
        end
      rescue Failure => e
        error(e.code, e.message, details: e.details, status: e.status)
      end

      # An API error response, as the API sends it: the code's status, message and details.
      def error(code, message = nil, details: nil, status: nil)
        body = { 'code' => code, 'message' => message || code }
        body['details'] = details if details
        respond(status || ErrorCodes::STATUSES.fetch(code, 400), body)
      end

      private

      def respond(status, data, headers = {})
        Response.new(status: status, body: data.nil? ? '' : JSON.generate(data),
                     headers: { 'content-type' => 'application/json', 'x-request-id' => request_id }.merge(headers))
      end

      def request_id = "mock-request-#{@request_count += 1}"

      # Applies a reviewer's decision like `decideAssetManually` in the API: the status and the review,
      # then (for `purged`) the content removal and its event, then `asset.<decision>`.
      def record_decision(item, decision, note, reviewer_name)
        apply_outcome(item, decision, 'requested')
        review = { 'id' => @create_id.call('rev'), 'decision' => decision, 'note' => note, 'reviewerUserId' => nil,
                   'reviewedAt' => @now.call, 'appliedToAsset' => true }
        reviewer_facts = []
        if reviewer_name
          review.merge!('reviewerName' => reviewer_name, 'reviewerEmail' => nil)
          reviewer_facts = [{ 'key' => 'reviewer-user-id', 'value' => nil }, { 'key' => 'reviewer-name', 'value' => reviewer_name }]
        end
        item['classification']['moderation']['manualReviews'] << review
        lifecycle_event('asset.content-removed', item) if decision == 'purged'
        # Like the event catalog: only allowing and limiting are low severity.
        add_event('type' => "asset.#{decision}", 'severity' => %w[allowed limited].include?(decision) ? 'low' : 'high',
                  'title' => "asset.#{decision}", 'assetId' => item['id'], 'asset' => snapshot(item),
                  'facts' => [{ 'key' => 'decided-by', 'value' => 'reviewer' }, { 'key' => 'asset-type', 'value' => item['type'] },
                              { 'key' => 'asset-name', 'value' => item['name'], 'url' => "https://calmlens.com/go/asset/#{item['id']}" },
                              *reviewer_facts, { 'key' => 'note', 'value' => note }])
      end

      # `POST /assets/:id/decision` as the API validates and applies it. The mock's key is unnamed, so the
      # review and its event name the reviewer `An API key`. An asset still uploading or processing is
      # refused with `asset/processing`.
      def decide_request(item, json)
        decision = json['decision']
        invalid!('validation/invalid-union', 'decision') unless REVIEW_DECISIONS.include?(decision)
        note = json['note']
        invalid!('validation/invalid-type', 'note') unless note.is_a?(String)
        note = note.strip
        invalid!('validation/too-small', 'note') if note.empty?
        invalid!('validation/too-big', 'note') if note.length > MAX_DECISION_NOTE_LENGTH
        invalid!('validation/invalid-value', 'confirmPurge') if decision == 'purged' && json['confirmPurge'] != true
        processing = item['upload']['status'] == 'uploading' || item['classification']['status'] == 'processing'
        fail!(ErrorCodes::ASSET_PROCESSING) if processing
        status = item['classification']['moderation']['status']
        fail!(ErrorCodes::ASSET_DECISION_NOT_ALLOWED) if status == 'pending' && !%w[blocked purged].include?(decision)
        fail!(ErrorCodes::ASSET_DECISION_UNCHANGED) if status == decision
        fail!(ErrorCodes::ASSET_CONTENT_PURGED) if status == 'purged' && decision != 'blocked'

        record_decision(item, decision, note, 'An API key')
        item
      end

      # The asset summary events carry.
      def snapshot(item)
        { 'id' => item['id'], 'externalId' => item['externalId'], 'uploadPresetId' => item['uploadPresetId'],
          'upload' => { 'status' => item['upload']['status'] },
          'classification' => { 'status' => item['classification']['status'],
                                'moderation' => { 'status' => item['classification']['moderation']['status'] } },
          'content' => { 'status' => item['content']['status'] } }
      end

      # The `asset.deleted`, `asset.content-removed` and `asset.retried` events the API records.
      def lifecycle_event(type, item)
        name = { 'key' => 'asset-name', 'value' => item['name'] }
        # A deleted asset has no portal page to link to.
        name['url'] = "https://calmlens.com/go/asset/#{item['id']}" unless type == 'asset.deleted'
        add_event('type' => type, 'severity' => 'low', 'assetId' => item['id'], 'asset' => snapshot(item),
                  'facts' => [name, { 'key' => 'asset-type', 'value' => item['type'] }])
      end

      def fail!(code, message = nil, details: nil) = raise(Failure.new(code, message, details: details))

      # A request the API's schema refuses: `validation/<issue>` with HTTP 400 and the field.
      def invalid!(code, path) = raise(Failure.new(code, "Invalid #{path}", details: { 'path' => path }, status: 400))

      # Like the API's query schema: an integer from 1 to `max`.
      def check_range(value, path, max)
        invalid!('validation/too-small', path) if !value.is_a?(Numeric) || value < 1
        invalid!('validation/too-big', path) if value > max
        invalid!('validation/invalid-type', path) unless value.is_a?(Integer)
        value
      end

      def api(method, relative, headers, body)
        uri = URI.parse(relative)
        parts = uri.path.split('/').reject(&:empty?).map { |part| URI.decode_www_form_component(part) }
        query = URI.decode_www_form(uri.query.to_s).to_h.to_h { |key, value| [key, query_value(key, value)] }
        selected_ids = query.keys.grep(/\Aids\[\d+\]\z/).sort_by { |key| key[/\d+/].to_i }
        query['ids'] = selected_ids.map { |key| query.delete(key) } unless selected_ids.empty?
        content_type = header(headers, 'Content-Type')
        json = content_type == 'application/json' && body ? JSON.parse(body) : {}
        # HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
        key = header(headers, 'Idempotency-Key')&.to_s&.gsub(/\A[ \t\r\n]+|[ \t\r\n]+\z/, '')
        upload = header(headers, 'X-CalmLens-Upload')
        return dispatch(method, parts, query, json, body, upload) unless key && method == 'POST'

        fail!(ErrorCodes::INVALID_IDEMPOTENCY_KEY) unless key.match?(IDEMPOTENCY_KEY)
        # Like the API: a successful response is saved and replayed for the same key and request;
        # a failed one frees the key.
        fingerprint = [method, relative, content_type, Digest::SHA256.hexdigest(body.to_s)]
        saved = @state.idempotency[key]
        if saved
          fail!(ErrorCodes::IDEMPOTENCY_KEY_REUSED) unless saved[:fingerprint] == fingerprint
          return Response.new(status: saved[:status], body: saved[:body],
                              headers: saved[:headers].merge('idempotent-replayed' => 'true', 'x-request-id' => request_id))
        end
        response = dispatch(method, parts, query, json, body, upload)
        if response.success?
          @state.idempotency[key] = { fingerprint: fingerprint, status: response.status, body: response.body,
                                      headers: response.headers }
        end
        response
      end

      def header(headers, name) = headers.find { |key, _| key.to_s.casecmp?(name) }&.last

      def query_value(key, value)
        return value unless JSON_QUERY.include?(key)

        JSON.parse(value)
      rescue JSON::ParserError
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, "#{key} is not valid JSON")
      end

      def dispatch(method, parts, query, json, body, upload)
        data = case parts.first
               when 'projects' then project(method, parts, query, json, body, upload)
               when 'assets' then asset(method, parts, query, json, body)
               when 'folders' then folder(method, parts, json)
               when 'hash-lists' then hash_list(method, parts, query, json)
               when 'hash-list-entries' then remove_hash_list_entry(method, parts)
               else fail!(ErrorCodes::ASSET_NOT_FOUND, 'Not found')
               end
        data.is_a?(Response) ? data : respond(200, deep_copy(data))
      end

      def deep_copy(value) = JSON.parse(JSON.generate(value))

      # `upload` is the X-CalmLens-Upload header, which picks how POST .../assets reads the
      # request: absent is a JSON body, 'content' raw file content and 'part' a raw first part.
      def project(method, parts, query, json, body, upload)
        fail!(ErrorCodes::API_KEY_PROJECT_MISMATCH) unless parts[1] == @project_id
        case [method, parts[2..], upload]
        in ['GET', ['events'], _] then events(query)
        in ['PUT', ['lenses'], _] then lenses(json.fetch('lenses', []))
        in ['GET', ['folders'], _] then folder_page(query)
        in ['POST', ['folders'], _] then create_folder(json)
        in ['GET', ['hash-lists'], _] then page(project_hash_lists, query, JSON.generate([@project_id]))
        in ['POST', ['hash-lists'], _] then create_hash_list(json)
        in ['GET', ['assets', 'page'], _] then list(query)
        in ['GET', ['assets', 'search'], _] then search(query)
        in ['POST', ['assets', 'batch'], _] then batch(json)
        in ['POST', ['assets'], nil] then create_asset(json, query['queue'] == true, url: json['url'])
        in ['POST', ['assets'], 'content'] then create_asset(query, query['queue'] == true, data: body)
        in ['POST', ['assets'], 'part'] then start_multipart(query, body)
        else fail!(ErrorCodes::ASSET_NOT_FOUND, 'Not found')
        end
      end

      def project_assets = @state.assets.values.select { |item| item['projectId'] == @project_id }

      # An asset ID as the API's schema accepts it: `asset_` and 20 base62 characters.
      ASSET_ID_PATTERN = /\Aasset_[0-9A-Za-z]{20}\z/
      private_constant :ASSET_ID_PATTERN

      # POST /projects/:id/assets/batch: like the API, every ID must be an asset ID
      # (`validation/invalid-format` at `assetIds.<index>`) and every asset must exist
      # (`asset/not-found`) before anything happens. The operation then runs at once, in request
      # order, rather than in the background: `delete` deletes each asset with its stored child
      # assets and records `asset.deleted` with the asset as it was; `remove-content` removes the
      # content like DELETE /assets/:id/content. Mock assets carry no safety holds.
      def batch(json)
        ids = json['assetIds']
        invalid!('validation/invalid-type', 'assetIds') unless ids.is_a?(Array)
        invalid!('validation/too-small', 'assetIds') if ids.empty?
        invalid!('validation/too-big', 'assetIds') if ids.size > 500
        ids.each_with_index do |id, index|
          invalid!('validation/invalid-format', "assetIds.#{index}") unless id.is_a?(String) && id.match?(ASSET_ID_PATTERN)
        end
        invalid!('validation/invalid-value', 'operation') unless %w[delete remove-content].include?(json['operation'])
        items = ids.uniq.map do |id|
          item = @state.assets[id]
          fail!(ErrorCodes::ASSET_NOT_FOUND) unless item && item['projectId'] == @project_id
          item
        end
        items.each do |item|
          if json['operation'] == 'delete'
            delete_tree(item)
            lifecycle_event('asset.deleted', item)
          else
            delete_content(item)
          end
        end
        respond(202, { 'queued' => true })
      end

      # Deletes an asset, its stored child assets and their content.
      def delete_tree(item)
        deleting = [item['id']]
        loop do
          added = project_assets.select { |other| deleting.include?(other['parentId']) && !deleting.include?(other['id']) }
          break if added.empty?

          deleting.concat(added.map { |other| other['id'] })
        end
        deleting.each do |id|
          @state.assets.delete(id)
          @state.content.delete(id)
        end
      end

      def list(query)
        items = project_assets.reject { |item| item['parentId'] }
        items = items.select { |item| item['folderId'] == query['folderId'] } if query.key?('folderId')
        page(RSQL.filter(items, query['filter']), query, JSON.generate([@project_id, query['filter'], query['folderId']]))
      end

      # Like the API: one keyset page of child folders (or search matches), by `name` ascending unless
      # `ordering` (one entry, `name` or `createdAt`) says otherwise, with an `id` tie-breaker, and the
      # ancestors of the listed and requested folders. Names compare by code point, so case matters.
      def folder_page(query)
        found = project_folders.select do |f|
          in_scope = (query['searchAll'] && query['search']) || f['parentId'] == query['parentId']
          in_scope && (!query['search'] || f['name'].downcase.include?(query['search'].downcase))
        end
        invalid!('validation/too-big', 'ordering') if ordering(query, nil).size > 1
        scope = JSON.generate([@project_id, query['parentId'], query['search'], query['searchAll'] == true])
        result = page(found, { 'pageSize' => MAX_PAGE_SIZE }.merge(query), scope,
                      fields: %w[name createdAt], default: { 'field' => 'name', 'direction' => 'ASC' })
        result.merge!('items' => [], 'nextCursor' => nil, 'hasMore' => false) if query['resolveOnly']
        page = result['items']
        ids = (Array(query['ids']) + [query['parentId']] + page.map { |f| f['id'] }).compact.uniq
        queue = ids.dup
        until queue.empty?
          parent = @state.folders.dig(queue.pop, 'parentId')
          if parent && !ids.include?(parent)
            ids << parent
            queue << parent
          end
        end
        result.merge('ancestors' => project_folders.select { |f| ids.include?(f['id']) && !page.include?(f) })
      end

      def project_folders = @state.folders.values.select { |item| item['projectId'] == @project_id }

      # Like the API: without a cursor, no events and a `nextCursor` for now; with one, up to `pageSize`
      # events added since, oldest first. `nextCursor` is never nil.
      def events(query)
        size = check_range(query.fetch('pageSize', DEFAULT_EVENTS_PAGE_SIZE), 'pageSize', MAX_PAGE_SIZE)
        feed = @state.events
        return { 'items' => [], 'nextCursor' => "mock_#{feed.size}", 'hasMore' => false } unless query['cursor']

        match = query['cursor'].to_s.match(/\Amock_(\d+)\z/)
        position = match && Integer(match[1], 10)
        fail!(ErrorCodes::INVALID_CURSOR) unless position && position <= feed.size

        taken = feed[position, size]
        following = position + taken.size
        { 'items' => taken, 'nextCursor' => "mock_#{following}", 'hasMore' => following < feed.size }
      end

      # Saves lenses in order, like the API: an unchanged definition returns the stored lens, a
      # change needs a greater version, and lenses before a conflict stay saved.
      def lenses(definitions)
        { 'lenses' => definitions.map { |definition| save_lens(definition) } }
      end

      def save_lens(definition)
        now = @now.call
        old = @state.lenses[definition['identifier']]
        unless old
          lens = { 'id' => @create_id.call('lens'), 'projectId' => @project_id, 'userId' => nil }.merge(definition)
          return @state.lenses[definition['identifier']] = lens.merge('createdAt' => now, 'updatedAt' => now)
        end

        same = %w[name type active].all? { |key| old[key] == definition[key] } &&
               old['description'] == definition['description'] && canonical(old['transforms']) == canonical(definition['transforms'])
        return old if same && old['version'] == definition['version']
        if definition['version'].to_i > old['version'].to_i
          return @state.lenses[old['identifier']] =
                   old.merge(definition).merge('updatedAt' => now)
        end

        fail!(ErrorCodes::LENS_VERSION_CONFLICT, details: { 'currentVersion' => old['version'], 'minimumVersion' => old['version'] + 1,
                                                            'requestedVersion' => definition['version'] })
      end

      def canonical(value)
        case value
        when Hash then value.sort_by { |key, _| key }.to_h { |key, item| [key, canonical(item)] }
        when Array then value.map { |item| canonical(item) }
        else value
        end
      end

      # Keyword search like the API: every whitespace-separated token (case-insensitive, at most 8
      # distinct) must appear in some field. Results rank by the API's score, then newest first.
      def search(query)
        text = query['query'].to_s.strip
        invalid!('validation/too-small', 'query') if text.empty?
        invalid!('validation/too-big', 'query') if text.length > MAX_SEARCH_QUERY_LENGTH
        limit = check_range(query.fetch('limit', 10), 'limit', MAX_SEARCH_LIMIT)
        normalized = text.downcase
        tokens = normalized.split(/\s+/).uniq.first(MAX_SEARCH_TOKENS)
        items = project_assets.filter_map do |item|
          values = SEARCH_FIELDS.transform_values { |path| Array(item.dig(*path)).join(' ').downcase }
          next unless tokens.all? { |token| values.each_value.any? { |value| value.include?(token) } }

          fields = values.filter_map { |field, value| field if tokens.any? { |token| value.include?(token) } }
          { 'asset' => item, 'score' => search_score(values, normalized), 'matchedFields' => fields }
        end
        items = items.each_with_index.sort_by { |result, index| [-result['score'], -result['asset']['createdAt'].to_i, index] }
                     .map(&:first)
        { 'query' => text, 'items' => items.first(limit), 'semanticStatus' => 'disabled' }
      end

      # The API's keyword score for the whole normalized query.
      def search_score(values, query)
        id, external_id, name = values.values_at('id', 'externalId', 'name')
        if id == query then 1000
        elsif external_id == query then 950
        elsif name == query then 900
        elsif id.start_with?(query) then 800
        elsif external_id.start_with?(query) then 750
        elsif name.start_with?(query) then 700
        elsif name.include?(query) then 600
        elsif values['tags'].include?(query) then 500
        else 100
        end
      end

      def kind(mime, url)
        return 'website' if url
        return mime.split('/').first if mime.start_with?('image/', 'video/', 'audio/')
        return 'plaintext-document' if mime.start_with?('text/')
        return 'multimedia-document' if mime.include?('pdf') || mime.include?('document')

        'file'
      end

      def create_asset(options, queue, url: nil, data: nil, open: false)
        check_folder(options['folderId']) if options['folderId']
        if options['externalId'] && project_assets.any? { |item| item['externalId'] == options['externalId'] }
          fail!(ErrorCodes::DUPLICATE_EXTERNAL_ID)
        end
        now = @now.call
        mime = options['contentType'].to_s
        processing = options['processingOptions'] || { 'keepContentAfterProcessing' => false }
        keep = processing.is_a?(Hash) && processing['keepContentAfterProcessing'] == true
        context = options['context'].is_a?(Hash) ? ModerationContext.select_items(options['context'].fetch('items', [])) : []
        # Fields the API returns as null when they are not set.
        asset = { 'id' => @create_id.call('asset'), 'projectId' => @project_id, 'userId' => nil, 'parentId' => nil,
                  'folderId' => options['folderId'], 'uploadPresetId' => options['uploadPresetId'],
                  'createdAt' => now, 'updatedAt' => now, 'name' => options['name'], 'description' => options['description'],
                  'externalId' => options['externalId'], 'externalUrl' => url || options['externalUrl'],
                  'type' => kind(mime, url), 'metadata' => options['metadata'], 'authorId' => options['authorId'],
                  # Like the API, only the posts CalmLens uses are kept, and only while the content is held.
                  'context' => context.empty? ? nil : { 'items' => context }, 'tags' => nil,
                  'processingOptions' => processing, 'visibility' => options.fetch('visibility', 'private'),
                  **sections(now: now, open: open, keep: keep, format: mime, size: data&.bytesize) }
        @state.assets[asset['id']] = asset
        @state.content[asset['id']] = { 'type' => mime, 'parts' => { 1 => data } } if data
        open ? asset : apply_outcome(asset, outcome_for(asset, queue))
      end

      def sections(now:, open:, keep:, format:, size:)
        {
          'content' => { 'status' => keep ? 'stored' : 'temporary', 'removalReason' => nil, 'updatedAt' => now,
                         'safetyHold' => nil, 'format' => format.empty? ? nil : format, 'extension' => nil,
                         'sizeInBytes' => size, 'checksums' => nil, 'image' => nil, 'extractedText' => nil },
          # Like the API, only an open upload counts the parts received.
          'upload' => { 'status' => open ? 'uploading' : 'completed', 'updatedAt' => now, 'partsReceived' => open ? 1 : nil },
          'classification' => { 'status' => open ? 'pending' : 'processing', 'updatedAt' => now, 'completedAt' => nil,
                                'moderation' => { 'status' => 'pending', 'manualReviews' => [] } }
        }
      end

      # Like the API: image uploads in parts total 10 MiB (checked at the last part) to 20 MiB.
      def image_size_error(type, size, final)
        return unless type == 'image'
        return ErrorCodes::MULTIPART_IMAGE_TOO_LARGE if size > MAX_MULTIPART_IMAGE

        ErrorCodes::MULTIPART_IMAGE_TOO_SMALL if final && size < MIN_MULTIPART_IMAGE
      end

      # Like the API: the parts may not overshoot a declared total, and must reach it at the end.
      def total_size_error(total, received, final)
        return if total.nil?

        ErrorCodes::UPLOAD_SIZE_MISMATCH if received > total || (final && received != total)
      end

      def check_part_size(size, final)
        return if final || size >= MIN_PART

        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'Multipart upload parts must be at least 5MiB except the final part.')
      end

      # In the API's order: a declared total, then a single final part as the whole upload, then the
      # part itself. The queue mode and declared total are saved with an open upload.
      def start_multipart(query, data)
        total = query['totalSizeInBytes']
        type = kind(query['contentType'].to_s, nil)
        final = query['isFinal'] == true
        size = data.to_s.bytesize
        code = (total && image_size_error(type, total, true)) ||
               (final ? total_size_error(total, size, true) || image_size_error(type, size, true) : nil)
        fail!(code) if code
        check_part_size(size, final)
        fail!(total_size_error(total, size, false)) if !final && total_size_error(total, size, false)

        asset = create_asset(query, query['queue'] == true, data: data, open: !final)
        @state.uploads[asset['id']] = { 'queue' => query['queue'] == true, 'total' => total } unless final
        asset
      end

      def outcome_for(asset, queue)
        outcome = queue ? @queued_outcome : @analyzed_outcome
        outcome = outcome.call(deep_copy(asset)) if outcome.respond_to?(:call)
        outcome
      end

      # Moves an asset to an outcome like the pipeline would: a decision finishes processing, `purged`
      # deletes the content (with `purge_reason`, `policy` for the pipeline), and finished processing
      # removes content kept only temporarily. A classified image gets a ThumbHash for its
      # placeholder, which goes with its content. `outcome` may also be fields to deep-merge.
      def apply_outcome(asset, outcome, purge_reason = 'policy')
        fields = nil
        if outcome.is_a?(Hash)
          fields = deep_copy(outcome)
          outcome = AssetRecord.outcome_of(fields)
        end
        processing, moderation = AssetRecord.statuses(outcome)
        now = @now.call
        decided = processing == 'completed'
        purge = moderation == 'purged' && asset['content']['status'] != 'removed'
        remove = purge || (decided && asset['content']['status'] == 'temporary')
        image = asset['content']['image']
        if decided && asset['type'] == 'image' && asset['content']['status'] != 'removed' && !purge
          image = { 'width' => nil, 'height' => nil, 'perceptualHash' => nil }.merge(image || {})
                                                                              .merge('thumbhash' => THUMBHASH,
                                                                                     'averageColor' => image&.fetch('averageColor',
                                                                                                                    nil) || '#7f7f7f')
        elsif moderation == 'purged'
          image = without_placeholder(image)
        end
        asset['content']['image'] = image
        if remove
          forget_content(asset)
          asset['content'].merge!('status' => 'removed', 'removalReason' => purge ? purge_reason : 'retention', 'updatedAt' => now,
                                  'extractedText' => nil, 'image' => without_placeholder(image))
        end
        asset['upload'].merge!('status' => 'completed', 'updatedAt' => now)
        asset['classification'].merge!('status' => processing, 'updatedAt' => now, 'completedAt' => decided ? now : nil)
        asset['classification']['moderation']['status'] = moderation
        asset['updatedAt'] = now
        fields ? AssetRecord.deep_merge!(asset, fields) : asset
      end

      # Like the API, the earlier posts CalmLens used go with the stored content.
      def forget_content(item)
        @state.content.delete(item['id'])
        item['context'] = nil
      end

      # Removing content removes the placeholder and average colour with it.
      def without_placeholder(image) = image&.merge('thumbhash' => nil, 'averageColor' => nil)

      def asset(method, parts, query, json, body)
        id = parts[1]
        item = @state.assets[id]
        fail!(ErrorCodes::ASSET_NOT_FOUND) unless item && item['projectId'] == @project_id
        case [method, parts[2]]
        in ['GET', nil] then item
        in ['PATCH', nil] then update(item, json)
        in ['DELETE', nil]
          @state.assets.delete(id)
          @state.content.delete(id)
          lifecycle_event('asset.deleted', item)
          nil
        in ['DELETE', 'content'] then delete_content(item)
        in ['GET', 'children'] then page(project_assets.select { |child| child['parentId'] == id }, query, id)
        in ['POST', 'retry'] then retry_asset(item)
        in ['POST', 'explain'] then explain(item, json['rerun'])
        in ['POST', 'decision'] then decide_request(item, json)
        in ['POST', 'move']
          check_folder(json['folderId']) if json['folderId']
          touch(item.merge!('folderId' => json['folderId']))
        in ['POST', 'signed-url'] then signed_url(id, json)
        in ['POST', 'part'] then part(item, query, body)
        else fail!(ErrorCodes::ASSET_NOT_FOUND, 'Not found')
        end
      end

      def touch(item)
        item['updatedAt'] = @now.call
        item
      end

      # Like the API: an externalId stays unique in the project; null clears a field.
      def update(item, json)
        if json['externalId'] && project_assets.any? { |other| other['id'] != item['id'] && other['externalId'] == json['externalId'] }
          fail!(ErrorCodes::DUPLICATE_EXTERNAL_ID)
        end
        touch(item.merge!(json.except('id', 'projectId', 'upload', 'classification', 'content')))
      end

      # Like the API: the record and report stay; stored content, extracted text and the placeholder
      # go. Content already removed keeps its reason, and an `asset.content-removed` event is
      # recorded either way.
      def delete_content(item)
        forget_content(item)
        content = item['content']
        if content['status'] == 'removed'
          content['image'] = without_placeholder(content['image']) if content.dig('image', 'thumbhash')
        else
          now = @now.call
          content.merge!('status' => 'removed', 'removalReason' => 'requested', 'updatedAt' => now, 'extractedText' => nil,
                         'image' => without_placeholder(content['image']))
          item['updatedAt'] = now
        end
        lifecycle_event('asset.content-removed', item)
        item
      end

      # Like the API: back to processing, to be moderated again, with an `asset.retried` event.
      def retry_asset(item)
        unless item['classification']['status'] == 'failed' && item['classification']['moderation']['status'] == 'pending'
          fail!(ErrorCodes::ASSET_NOT_RETRYABLE)
        end
        fail!(ErrorCodes::ASSET_CONTENT_UNAVAILABLE) if item['content']['status'] == 'removed'

        apply_outcome(item, 'pending')
        lifecycle_event('asset.retried', item)
        item
      end

      def explain(item, rerun)
        fail!(ErrorCodes::ASSET_NOT_DECIDED) unless item['classification']['status'] == 'completed'
        moderation = item['classification']['moderation']
        unless rerun
          # Like the API: the evidence is completed and every action stays as decided.
          policy = moderation['policy']
          return item unless policy.is_a?(Hash) && policy['evidence'] == 'decision'

          policy['evidence'] = 'full'
          return touch(item)
        end
        fail!(ErrorCodes::ASSET_REVIEWED) unless moderation.fetch('manualReviews', []).empty?
        fail!(ErrorCodes::ASSET_CONTENT_UNAVAILABLE) if item['content']['status'] == 'removed'

        # Like the API: back to processing, to be moderated again under the current policy.
        apply_outcome(item, 'pending')
      end

      def signed_url(id, json)
        expires = json.fetch('expiresInSeconds', 900)
        params = URI.encode_www_form(json.slice('lens', 'transform').merge('expires' => expires))
        { 'url' => "#{@cdn_base_url}/signed/#{URI.encode_www_form_component(id)}/#{json.fetch('resource', 'rendered')}?#{params}",
          'expiresAt' => @now.call + (expires * 1000) }
      end

      # In the API's order: the upload must be open, parts arrive in order, image totals and the
      # declared total are checked, then the part itself (5 MiB unless it is the last).
      def part(item, query, body)
        fail!(ErrorCodes::UPLOAD_NOT_OPEN) unless item['upload']['status'] == 'uploading'
        number = query['partNumber']
        expected = item['upload']['partsReceived'].to_i + 1
        unless number == expected
          fail!(ErrorCodes::INVALID_UPLOAD_PART_NUMBER, "Expected part #{expected}",
                details: { 'expectedPartNumber' => expected, 'receivedPartNumber' => number })
        end
        final = query['isFinal'] == true
        size = body.to_s.bytesize
        received = item['content']['sizeInBytes'].to_i + size
        upload = @state.uploads[item['id']] || {}
        code = image_size_error(item['type'], received, final) || total_size_error(upload['total'], received, final)
        fail!(code) if code
        check_part_size(size, final)

        stored = (@state.content[item['id']] ||= { 'type' => item['content']['format'].to_s, 'parts' => {} })
        stored['parts'][number] = body.to_s
        now = @now.call
        item['content']['sizeInBytes'] = received
        # Like the API, a completed upload no longer counts parts.
        item['upload'].merge!('updatedAt' => now, 'partsReceived' => final ? nil : number)
        item['updatedAt'] = now
        return item unless final

        @state.uploads.delete(item['id'])
        queue = query.key?('queue') ? query['queue'] == true : upload.fetch('queue', false)
        apply_outcome(item, outcome_for(item, queue))
      end

      def folder(method, parts, json)
        id = parts[1]
        item = check_folder(id)
        case [method, parts[2]]
        in ['GET', nil] then item
        in ['PATCH', nil]
          unique_name(json['name'], item['parentId'], id) if json.key?('name') && json['name'] != item['name']
          touch(item.merge!(json.slice('name')))
        in ['POST', 'move'] then move_folder(item, json['parentId'])
        in ['DELETE', nil]
          assets = project_assets.any? { |asset| asset['folderId'] == id }
          children = project_folders.any? { |other| other['parentId'] == id }
          fail!(ErrorCodes::FOLDER_NOT_EMPTY, details: { 'hasAssets' => assets, 'hasChildren' => children }) if assets || children

          @state.folders.delete(id)
          nil
        else fail!(ErrorCodes::FOLDER_NOT_FOUND, 'Not found')
        end
      end

      def check_folder(id)
        item = @state.folders[id]
        fail!(ErrorCodes::FOLDER_NOT_FOUND) unless item && item['projectId'] == @project_id
        item
      end

      def unique_name(name, parent_id, exclude = nil)
        return unless project_folders.any? { |other| other['id'] != exclude && other['name'] == name && other['parentId'] == parent_id }

        fail!(ErrorCodes::DUPLICATE_FOLDER_NAME, "A folder named \"#{name}\" already exists in this location.")
      end

      def create_folder(json)
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'Folder name is required') if json['name'].to_s.empty?
        check_folder(json['parentId']) if json['parentId']
        unique_name(json['name'], json['parentId'])
        now = @now.call
        item = { 'id' => @create_id.call('fldr'), 'projectId' => @project_id, 'parentId' => json['parentId'], 'name' => json['name'],
                 'createdAt' => now, 'updatedAt' => now }
        @state.folders[item['id']] = item
        # Like the API, a new folder is 201 Created.
        respond(201, deep_copy(item))
      end

      def move_folder(item, parent_id)
        current = parent_id
        visited = [item['id']]
        while current
          fail!(ErrorCodes::FOLDER_PARENT_CYCLE) if visited.include?(current)

          visited << current
          current = check_folder(current)['parentId']
        end
        unique_name(item['name'], parent_id, item['id']) unless parent_id == item['parentId']
        touch(item.merge!('parentId' => parent_id))
      end

      # Hash lists and their entries. Uploads are not compared with them.
      def project_hash_lists = @state.hash_lists.values.select { |item| item['projectId'] == @project_id }

      def check_hash_list(id)
        item = @state.hash_lists[id]
        fail!(ErrorCodes::HASH_LIST_NOT_FOUND) unless item && item['projectId'] == @project_id
        item
      end

      def hash_list_action?(action) = %w[flag block].include?(action)

      def create_hash_list(json)
        name = json['name']
        unless name.is_a?(String) && !name.strip.empty? && hash_list_action?(json['action'])
          fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'A hash list needs a name and an action of flag or block')
        end
        now = @now.call
        item = { 'id' => @create_id.call('hl'), 'projectId' => @project_id, 'name' => name.strip,
                 'description' => json['description'].is_a?(String) ? json['description'] : nil,
                 'action' => json['action'], 'createdByUserId' => nil, 'createdAt' => now, 'updatedAt' => now }
        @state.hash_lists[item['id']] = item
        # Like the API, a new hash list is 201 Created.
        respond(201, deep_copy(item))
      end

      def hash_list(method, parts, query, json)
        id = parts[1]
        item = check_hash_list(id)
        case [method, parts[2..]]
        in ['GET', []] then item
        in ['PATCH', []] then update_hash_list(item, json)
        in ['DELETE', []]
          @state.hash_lists.delete(id)
          @state.hash_list_entries.delete_if { |_, entry| entry['hashListId'] == id }
          {}
        in ['GET', ['entries']] then page(@state.hash_list_entries.values.select { |entry| entry['hashListId'] == id }, query, id)
        in ['POST', ['entries']] then add_hash_list_entry(item, json)
        else fail!(ErrorCodes::HASH_LIST_NOT_FOUND, 'Not found')
        end
      end

      def update_hash_list(item, json)
        item['name'] = json['name'].strip if json['name'].is_a?(String)
        item['description'] = json['description'].is_a?(String) ? json['description'] : nil if json.key?('description')
        item['action'] = json['action'] if hash_list_action?(json['action'])
        touch(item)
      end

      # Like the API: a hash or an image asset's hash; a hash already in the list returns its entry (200).
      def add_hash_list_entry(list, json)
        hash = json['hash'].is_a?(String) ? json['hash'].strip.downcase : nil
        quality = json['quality'].is_a?(Numeric) ? json['quality'] : nil
        asset_id = json['assetId'].is_a?(String) ? json['assetId'] : nil
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'Send either hash or assetId') if hash.nil? == asset_id.nil?
        if asset_id
          asset = @state.assets[asset_id]
          fail!(ErrorCodes::ASSET_NOT_FOUND) unless asset && asset['projectId'] == @project_id
          image = asset.dig('content', 'image')
          fail!(ErrorCodes::HASH_LIST_ASSET_NOT_HASHED) unless image.is_a?(Hash) && image['perceptualHash']
          hash = image['perceptualHash']
          quality = image['perceptualHashQuality']
        end
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'Use a PDQ hash of 64 hexadecimal characters') unless hash.match?(/\A\h{64}\z/)

        existing = @state.hash_list_entries.values.find { |entry| entry['hashListId'] == list['id'] && entry['hash'] == hash }
        return existing if existing

        entry = { 'id' => @create_id.call('hle'), 'projectId' => @project_id, 'hashListId' => list['id'], 'hash' => hash,
                  'quality' => quality, 'label' => json['label'].is_a?(String) ? json['label'] : nil,
                  'sourceAssetId' => asset_id, 'createdByUserId' => nil, 'createdAt' => @now.call }
        @state.hash_list_entries[entry['id']] = entry
        respond(201, deep_copy(entry))
      end

      def remove_hash_list_entry(method, parts)
        entry = @state.hash_list_entries[parts[1]]
        found = method == 'DELETE' && parts.size == 2 && entry && entry['projectId'] == @project_id
        fail!(ErrorCodes::HASH_LIST_ENTRY_NOT_FOUND) unless found

        @state.hash_list_entries.delete(parts[1])
        {}
      end

      # One keyset page like the API's: ordered by `fields` (`createdAt` descending by default; an `id`
      # tie-breaker is added), starting after the cursor's values. The cursor is tied to `scope` (the
      # filter, folder or parent) and the ordering, so it only continues the query it came from.
      def page(items, query, scope, fields: %w[createdAt id], default: { 'field' => 'createdAt', 'direction' => 'DESC' })
        size = check_range(query.fetch('pageSize', DEFAULT_PAGE_SIZE), 'pageSize', MAX_PAGE_SIZE)
        ordering = ordering(query, default)
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'Invalid ordering') if ordering.any? { |o| !fields.include?(o['field']) }
        ordering << { 'field' => 'id', 'direction' => ordering.first['direction'] } unless ordering.any? { |o| o['field'] == 'id' }
        signature = JSON.generate([scope, ordering])
        sorted = items.sort { |a, b| compare_items(a, b, ordering) }
        if query['cursor']
          values = cursor_values(query['cursor'], signature, ordering)
          sorted = sorted.select { |item| after_cursor?(item, values, ordering) }
        end
        selected = sorted.first(size)
        more = sorted.size > size
        cursor = if more
                   [JSON.generate({ 'scope' => signature, 'values' => ordering.map do |o|
                     selected.last[o['field']]
                   end })].pack('m0')
                 end
        { 'items' => selected, 'pageSize' => size, 'hasMore' => more, 'ordering' => ordering, 'nextCursor' => cursor }
      end

      def cursor_values(cursor, signature, ordering)
        text_fields = %w[id name]
        parsed = JSON.parse(cursor.unpack1('m0').force_encoding(Encoding::UTF_8))
        values = parsed.is_a?(Hash) ? parsed['values'] : nil
        valid = parsed.is_a?(Hash) && parsed['scope'] == signature && values.is_a?(Array) && values.size == ordering.size &&
                values.zip(ordering).all? { |value, o| text_fields.include?(o['field']) ? value.is_a?(String) : value.is_a?(Numeric) }
        fail!(ErrorCodes::INVALID_CURSOR) unless valid
        values
      rescue ArgumentError, JSON::ParserError, EncodingError
        fail!(ErrorCodes::INVALID_CURSOR)
      end

      def after_cursor?(item, values, ordering)
        ordering.each_with_index do |rule, index|
          result = compare_values(item[rule['field']], values[index])
          return rule['direction'] == 'DESC' ? result.negative? : result.positive? unless result.zero?
        end
        false
      end

      def ordering(query, default)
        entries = query.keys.filter_map { |key| key.match(/\Aordering\[(\d+)\]\[(field|direction)\]\z/) }
        return [default&.dup].compact if entries.empty?

        entries.group_by { |match| Integer(match[1], 10) }.sort.map do |_, matches|
          matches.to_h { |match| [match[2], query[match[0]]] }
        end
      end

      def compare_items(left, right, ordering)
        ordering.each do |rule|
          result = compare_values(left[rule['field']], right[rule['field']])
          return rule['direction'] == 'DESC' ? -result : result unless result.zero?
        end
        0
      end

      # Like the API: missing values first, numbers by value, everything else as text.
      def compare_values(left, right)
        return 0 if left == right
        return -1 if left.nil?
        return 1 if right.nil?
        return left <=> right if left.is_a?(Numeric) && right.is_a?(Numeric)

        left.to_s <=> right.to_s
      end

      # Answers like the CDN: a placeholder is the asset's ThumbHash as a PNG, public whatever
      # the asset's visibility or moderation; other resources pass delivery checks first, which refuse
      # everyone (content still uploading, blocked or purged, failed processing, removed content),
      # then an age-restricted asset needs `viewerClaims.ageConfirmed=true` whatever the key, and a
      # private asset needs an API key with `assets:download` for its folder.
      def serve(method, relative)
        path, query = relative.split('#', 2).first.split('?', 2)
        segments = path.split('/').reject(&:empty?).map { |part| URI.decode_www_form_component(part) }
        _, project, identifier, resource = segments
        item = project == @project_id && project_assets.find { |asset| [asset['id'], asset['externalId']].include?(identifier) }
        return error('asset/not-found', 'Asset not found', status: 404) unless item && RESOURCES.include?(resource)

        return placeholder(method, item) if resource == 'placeholder'

        moderation = item['classification']['moderation']['status']
        stored = @state.content[item['id']]
        if stored.nil? || item['upload']['status'] == 'uploading' || %w[blocked purged].include?(moderation) ||
           item['classification']['status'] == 'failed' || item['content']['status'] == 'removed'
          return not_available
        end

        params = URI.decode_www_form(query.to_s).to_h
        opted_in = viewer_age_confirmed?(params)
        if moderation == 'age-restricted' && !opted_in
          return error('viewer/age-confirmation-required', 'Age confirmation required',
                       status: 403)
        end

        restricted = item['visibility'] != 'public'
        if restricted && !can_download?(item['folderId'])
          return error('asset/api-key-missing-permission',
                       'This API key needs assets:download permission for this asset’s folder.', status: 403)
        end

        type = stored['type'].to_s.empty? ? 'application/octet-stream' : stored['type']
        cdn_response(method, stored['parts'].sort.map(&:last).join.b,
                     viewer_delivery_headers(item, type, restricted, params))
      end

      def viewer_age_confirmed?(params)
        JSON.parse(params.fetch('viewerClaims', '{}'))['ageConfirmed'] == true
      end

      def viewer_delivery_headers(item, type, restricted, params)
        headers = delivery_headers(item, type, restricted)
        headers['Cache-Control'] = 'private, no-store' if params.key?('viewerClaims')
        headers
      end

      def not_available = error('asset/not-available', 'Asset is not available', status: 403)

      # Like the CDN's placeholder handler: an image's ThumbHash, public whatever the asset's
      # visibility or moderation; refused for purged assets and assets without one (not yet
      # classified, or content removed).
      def placeholder(method, item)
        thumbhash = item.dig('content', 'image', 'thumbhash')
        return not_available if thumbhash.nil? || item['classification']['moderation']['status'] == 'purged'

        cdn_response(method, Placeholder.png(thumbhash),
                     'content-type' => 'image/png', 'cache-control' => 'public, max-age=3600',
                     'cache-tag' => "asset-#{item['id']}", 'etag' => "\"#{thumbhash}\"")
      end

      # Like the CDN: an image's bytes are immutable for a year, other content is kept for an hour,
      # by shared caches only when delivery is public. Active content is served as a download.
      def delivery_headers(item, type, restricted)
        image = item['type'] == 'image'
        headers = { 'content-type' => type,
                    'cache-control' => "#{restricted ? 'private' : 'public'}, #{image ? 'max-age=31536000, immutable' : 'max-age=3600'}",
                    'cache-tag' => "asset-#{item['id']}" }
        headers.merge!('etag' => "\"#{item['id']}\"", 'expires' => Time.at((@now.call / 1000) + 31_536_000).utc.httpdate) if image
        headers.merge!('x-content-type-options' => 'nosniff', 'content-security-policy' => "sandbox; default-src 'none'")
        mime = type.downcase.split(';', 2).first.to_s.strip
        headers['content-disposition'] = 'attachment' if ACTIVE_TYPES.include?(mime) || mime.end_with?('+xml')
        headers
      end

      def cdn_response(method, bytes, headers)
        Response.new(status: 200, body: method == 'HEAD' ? '' : bytes,
                     headers: headers.merge('content-length' => bytes.bytesize.to_s, 'x-request-id' => request_id))
      end

      # Whether the mock API key's grants give `assets:download` for `folder_id`.
      def can_download?(folder_id)
        @grants.any? do |grant|
          next false unless Array(grant['actions']).include?('assets:download')
          next true if grant['folderId'].nil?

          covers?(grant, folder_id)
        end
      end

      def covers?(grant, folder_id)
        current = folder_id
        seen = []
        while current && !seen.include?(current)
          return true if current == grant['folderId']
          return false unless grant['includeSubfolders']

          seen << current
          current = @state.folders.dig(current, 'parentId')
        end
        false
      end
    end

    # Outcomes and merging test fields into a mock asset.
    # @api private
    module AssetRecord
      module_function

      # Processing and moderation status for each outcome.
      OUTCOMES = { 'pending' => %w[processing pending], 'allowed' => %w[completed allowed],
                   'limited' => %w[completed limited],
                   'age-restricted' => %w[completed age-restricted], 'blocked' => %w[completed blocked],
                   'purged' => %w[completed purged], 'failed' => %w[failed pending] }.freeze

      def statuses(outcome)
        OUTCOMES.fetch(outcome) do
          raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT,
                                         "MockServerClient outcomes are #{OUTCOMES.keys.join(', ')} (got #{outcome.inspect})")
        end
      end

      # The outcome of analyzed fields: `failed` when they fail processing, else their moderation status.
      def outcome_of(fields)
        fields.dig('classification', 'status') == 'failed' ? 'failed' : fields.dig('classification', 'moderation', 'status') || 'allowed'
      end

      def deep_merge!(target, fields)
        fields.each do |key, value|
          if value.is_a?(Hash) && target[key].is_a?(Hash)
            deep_merge!(target[key], value)
          else
            target[key] = value
          end
        end
        target
      end
    end

    # The RSQL subset the fake API understands: `==` and `!=` (with `*` wildcards), `=in=` and
    # `=out=` with a `(value,value)` list, and `=gt=`, `=ge=`, `=lt=`, `=le=`, with quoted values,
    # combined with `;` (and), which binds tighter than `,` (or), and grouped with `( … )`.
    # Anything else raises instead of being ignored, so a test never passes on an unfiltered list.
    # @api private
    module RSQL
      module_function

      def filter(items, expression)
        return items if expression.nil? || expression.to_s.strip.empty?

        test = parse(expression.to_s)
        items.select { |item| test.call(item) }
      end

      # Compiles `,` (or) of `;` (and) terms, where a term is a comparison or a `( … )` group.
      def parse(expression)
        alternatives = split(expression, ',').map do |alternative|
          split(alternative, ';').map do |term|
            text = term.strip
            raise unsupported(expression) if text.empty?

            group = unwrap(text)
            group ? parse(group) : comparison(text)
          end
        end
        ->(item) { alternatives.any? { |terms| terms.all? { |test| test.call(item) } } }
      end

      # The expression inside `( … )` when the parentheses enclose all of `text`, else nil.
      def unwrap(text)
        return unless text.start_with?('(') && text.end_with?(')')

        depth = 0
        quote = nil
        text.each_char.with_index do |char, index|
          if quote
            quote = nil if char == quote
          elsif ['"', "'"].include?(char)
            quote = char
          elsif char == '('
            depth += 1
          elsif char == ')'
            depth -= 1
            return index == text.length - 1 ? text[1..-2] : nil if depth.zero?
          end
        end
        nil
      end

      def unsupported(term)
        InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT,
                                 'MockServerClient filters support ==, !=, =in=, =out=, =gt=, =ge=, =lt= and ' \
                                 "=le=, joined by ; and , and grouped with parentheses (got #{term.inspect})")
      end

      # Splits on `separator` outside quotes and parentheses (groups and `=in=(...)` lists).
      def split(text, separator)
        parts = ['']
        quote = nil
        depth = 0
        text.each_char do |char|
          if quote
            quote = nil if char == quote
          elsif ['"', "'"].include?(char)
            quote = char
          elsif char == '('
            depth += 1
          elsif char == ')'
            depth -= 1
          elsif char == separator && depth.zero?
            parts << ''
            next
          end
          parts[-1] += char
        end
        parts
      end

      def comparison(term)
        match = term.strip.match(/\A([A-Za-z][\w.]*)(==|!=|=in=|=out=|=gt=|=ge=|=lt=|=le=)(.+)\z/m)
        raise unsupported(term) unless match

        field, operator, raw = match.captures
        values = list(operator, raw.strip)
        lambda do |item|
          actual = field.split('.').reduce(item) { |object, key| object.is_a?(Hash) ? object[key] : nil }
          entries = Array(actual.nil? ? 'null' : actual).map(&:to_s)
          case operator
          when '==', '=in=' then values.any? { |value| matches?(entries, value) }
          when '!=', '=out=' then values.none? { |value| matches?(entries, value) }
          else entries.any? { |entry| ordered?(entry, operator, values.first) }
          end
        end
      end

      def list(operator, raw)
        return [unquote(raw)] unless %w[=in= =out=].include?(operator)

        unless raw.start_with?('(') && raw.end_with?(')')
          raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, "#{operator} takes a (value,value) list")
        end

        split(raw[1..-2], ',').map { |value| unquote(value.strip) }
      end

      def unquote(value) = value.match?(/\A(["']).*\1\z/m) ? value[1..-2] : value

      def matches?(entries, value)
        pattern = Regexp.new("\\A#{Regexp.escape(value).gsub('\*', '.*')}\\z", Regexp::MULTILINE)
        entries.any? { |entry| pattern.match?(entry) }
      end

      # Numbers compare as numbers and everything else (such as ISO dates) as text.
      def ordered?(entry, operator, value)
        left, right = [entry, value].all? { |text| text.match?(/\A-?\d+(\.\d+)?\z/) } ? [entry.to_f, value.to_f] : [entry, value]
        { '=gt=' => left > right, '=ge=' => left >= right, '=lt=' => left < right, '=le=' => left <= right }.fetch(operator)
      end
    end
  end
end
