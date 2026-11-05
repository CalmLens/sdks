# frozen_string_literal: true

require 'digest'
require 'json'
require 'securerandom'
require 'uri'
require_relative 'placeholder'
require_relative 'mock_decision'
require_relative 'rsql'

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
    # details and body shape, checking requests in the API's order. It moderates through the
    # `moderate` callback rather than classifying content, and does not run transforms or index for
    # semantic search.
    # @api private
    class FakeAPI
      JSON_QUERY = %w[queue isFinal sizeInBytes totalSizeInBytes partNumber pageSize limit processingOptions metadata
                      tags context].freeze
      # Keyword search fields, in the order matches are reported, and where each value sits in the asset.
      SEARCH_FIELDS = { 'name' => %w[name], 'id' => %w[id], 'externalId' => %w[externalId],
                        'description' => %w[description], 'tags' => %w[tags], 'type' => %w[type],
                        'content.format' => %w[content format], 'content.extension' => %w[content extension],
                        'classification.moderation.status' => %w[classification moderation status] }.freeze
      MAX_SEARCH_TOKENS = 8
      MAX_SEARCH_LIMIT = 20
      MAX_SEARCH_QUERY_LENGTH = 200
      # Every API cursor list returns this many items unless `pageSize` says otherwise.
      DEFAULT_PAGE_SIZE = 50
      MAX_PAGE_SIZE = 100
      REVIEW_DECISIONS = %w[allowed limited age-restricted blocked purged].freeze
      # The moderation status each `asset.<status>` event announces.
      ANNOUNCED_STATUSES = REVIEW_DECISIONS.to_h { |status| ["asset.#{status}", status] }.freeze
      MAX_DECISION_NOTE_LENGTH = 1499
      # The actor of events the mock's API key causes: mock keys have no ID.
      API_KEY_ACTOR = { 'type' => 'api-key', 'id' => nil }.freeze
      # The actor of a reviewer's decision through {MockServerClient#decide}.
      REVIEWER_ACTOR = { 'type' => 'user', 'id' => nil }.freeze
      # The actor of the pipeline's processing events.
      AUTOMATED_ACTOR = { 'type' => 'automated', 'id' => nil }.freeze
      # An event type's shape (`resource.action`), as the mock checks `types` without the catalog.
      EVENT_TYPE_PATTERN = /\A[a-z][a-z-]*\.[a-z][a-z-]*\z/
      # The resources an asset's CDN path names.
      RESOURCES = %w[original rendered preview hls embed placeholder].freeze
      # The page the mock serves at `/embed`, standing in for the CDN's embed page.
      EMBED_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title></head>' \
                   '<body></body></html>'

      MIN_PART = 5 * 1024 * 1024
      MAX_MULTIPART_IMAGE = 20 * 1024 * 1024
      # Like the API: an upload has at most this many parts.
      MAX_PARTS = 10_000
      # The ThumbHash the mock gives every processed asset's preview, standing in for one computed
      # from its pixels. The `placeholder` resource serves it as a PNG, like the CDN.
      THUMBHASH = '1QcSHQRnh493V4dIh4eXh1h4kJUI'
      # Removing or withholding content removes its rendered file, adaptive stream and preview, as the API does.
      NO_RENDERING = { 'rendered' => nil, 'hls' => nil, 'preview' => nil }.freeze
      # The size of the waveform the API makes as an audio asset's preview.
      WAVEFORM_SIZE = { 'width' => 1200, 'height' => 300 }.freeze
      # Audio and video formats browsers play as uploaded, so the API serves them as stored (Asset.ts).
      BROWSER_SAFE_MEDIA_FORMATS = %w[video/mp4 audio/mpeg audio/aac audio/mp4 audio/x-m4a audio/ogg].freeze
      # Spreadsheets, which have no rendered file or preview (Asset.ts).
      SPREADSHEET_MIME_TYPES = %w[application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                                  application/vnd.ms-excel.sheet.macroenabled.12 application/vnd.ms-excel
                                  application/vnd.oasis.opendocument.spreadsheet].freeze
      # The built-in presets the mock knows, by display name.
      PRESET_NAMES = { 'general-community' => 'General', 'children-platform' => 'Kids',
                       'education-support' => 'Learning and support', 'wholesome-community' => 'Teen-safe' }.freeze
      # Like the API: 1 to 255 printable ASCII characters, without a space at either end.
      IDEMPOTENCY_KEY = /\A[\x21-\x7e](?:[\x20-\x7e]{0,253}[\x21-\x7e])?\z/
      # Content a browser could run as a document, which the CDN serves as a download.
      ACTIVE_TYPES = %w[image/svg+xml application/xhtml+xml text/html application/xml text/xml].freeze

      attr_reader :state
      # The mock API key's `{ 'actions', 'folderId', 'includeSubfolders' }` grants.
      attr_accessor :grants

      def initialize(project_id:, base_url:, cdn_base_url:, now:, create_id:, moderate:, grants:)
        @project_id = project_id
        @base_url = base_url
        @cdn_base_url = cdn_base_url
        @now = now
        @create_id = create_id
        @moderate = moderate
        @grants = grants
        @state = State.new(assets: {}, folders: {}, content: {}, events: [], lenses: {}, uploads: {}, idempotency: {},
                           hash_lists: {}, hash_list_entries: {})
        # Stored policies (the API's shape without `projectIds` and `preset.latestVersion`, plus their
        # reset `baseline`) and the one the project moderates with.
        @policies = {}
        @project_policy_id = nil
        @request_count = 0
        # Each asset's latest `assetSequence`, which the API keeps on the asset row.
        @asset_event_sequences = Hash.new(0)
        # The processing options each asset was uploaded with, which the API keeps but doesn't return.
        @processing_options = {}
      end

      # Adds an event to the feed, filling the fields the API always sets. Its `actor` is the mock's
      # API key unless the event names another.
      def add_event(event)
        time = @now.call
        record = { 'id' => @create_id.call('evt'), 'projectId' => @project_id, 'actor' => deep_copy(API_KEY_ACTOR),
                   'severity' => 'low', 'description' => nil,
                   'assetId' => nil, 'assetSequence' => nil, 'asset' => nil, 'facts' => [],
                   'createdAt' => time }.merge(event)
        record['title'] ||= record['type']
        # Like the API: each event about an asset takes the asset's next number; others have none.
        asset_id = record['assetId']
        record['assetSequence'] = asset_id ? (@asset_event_sequences[asset_id] += 1) : nil
        @state.events << record
        record
      end

      # Adds an event like {#add_event}; one about a stored asset carries the asset as it is now,
      # with the moderation status an `asset.<status>` event announces.
      def enqueue_event(event)
        item = own_asset(event['assetId'])
        if item && !event.key?('asset')
          asset = snapshot(item)
          announced = ANNOUNCED_STATUSES[event['type']]
          asset['classification']['moderation']['status'] = announced if announced
          event = event.merge('asset' => asset)
        end
        add_event(event)
      end

      # Applies a reviewer's decision, adds the matching events and returns the asset, or nil when
      # there is no such asset. A purge removes the content with reason `requested`.
      def decide(asset_id, decision)
        unless REVIEW_DECISIONS.include?(decision)
          raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT,
                                         "Review decisions are #{REVIEW_DECISIONS.join(', ')} (got #{decision.inspect})")
        end
        item = own_asset(asset_id)
        return unless item

        record_decision(item, decision, nil, nil)
        deep_copy(item)
      end

      # Finishes processing an asset as the pipeline would, with `decision` or else what `moderate`
      # answers for the `complete` trigger, and returns it; nil when there is no such asset.
      def complete_processing(asset_id, decision)
        item = own_asset(asset_id)
        return unless item
        raise Internal.invalid("Asset #{asset_id} isn't processing") unless item['classification']['status'] == 'processing'

        moderate_stored(item, 'complete', decision.nil? ? nil : MockDecision.from(decision))
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

      # An API error response, as the API sends it: `{ code, message, requestId, details }` with the
      # code's status, `requestId` matching the `x-request-id` header and `details` always an object.
      # `retry_after` is whole seconds for the `Retry-After` header.
      def error(code, message = nil, details: nil, status: nil, retry_after: nil)
        id = request_id
        body = { 'code' => code, 'message' => message || code, 'requestId' => id, 'details' => details || {} }
        headers = retry_after.nil? ? {} : { 'retry-after' => retry_after.to_s }
        respond(status || ErrorCodes::STATUSES.fetch(code, 400), body, headers, id: id)
      end

      private

      def respond(status, data, headers = {}, id: request_id)
        Response.new(status: status, body: data.nil? ? '' : JSON.generate(data),
                     headers: { 'content-type' => 'application/json', 'x-request-id' => id }.merge(headers))
      end

      def request_id = "mock-request-#{@request_count += 1}"

      def own_asset(asset_id)
        item = @state.assets[asset_id]
        item if item && item['projectId'] == @project_id
      end

      # Applies a reviewer's decision like `decideAssetManually` in the API: the status and the review,
      # then (for `purged`) the content removal and its event, then `asset.<decision>`. Either way the
      # review is the mock API key's, which has no ID. A decision through the API (with
      # `reviewer_name`) has the API key as its events' actor and names the reviewer in the event;
      # the test hook's is a reviewer's (a `user`).
      def record_decision(item, decision, note, reviewer_name)
        apply_outcome(item, decision, 'requested')
        review = { 'id' => @create_id.call('rev'), 'decision' => decision, 'note' => note,
                   'decidedBy' => { 'type' => 'api-key', 'id' => nil }, 'reviewedAt' => @now.call, 'applied' => true }
        actor = reviewer_name ? API_KEY_ACTOR : REVIEWER_ACTOR
        reviewer_facts = reviewer_name ? [{ 'key' => 'reviewer-name', 'value' => reviewer_name }] : []
        item['classification']['moderation']['manualReviews'] << review
        lifecycle_event('asset.content-removed', item, actor: actor) if decision == 'purged'
        # Like the event catalog: only allowing and limiting are low severity.
        add_event('type' => "asset.#{decision}", 'severity' => %w[allowed limited].include?(decision) ? 'low' : 'high',
                  'title' => "asset.#{decision}", 'assetId' => item['id'], 'asset' => snapshot(item),
                  'actor' => deep_copy(actor),
                  'facts' => [{ 'key' => 'asset-type', 'value' => item['type'] },
                              { 'key' => 'asset-name', 'value' => item['name'], 'url' => "https://calmlens.com/go/asset/#{item['id']}" },
                              *reviewer_facts, { 'key' => 'note', 'value' => note }])
      end

      # `POST /assets/:id/decision` as the API validates and applies it. The mock's key is unnamed, so its
      # event names the reviewer `An API key`. An asset still uploading or processing is
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
          'classification' => { 'status' => item['classification']['status'], 'testInput' => item['classification']['testInput'],
                                'moderation' => { 'status' => item['classification']['moderation']['status'] } },
          'content' => { 'status' => item['content']['status'] } }
      end

      # The `asset.deleted`, `asset.content-removed` and `asset.retried` events the API records, with
      # the `batch-id` fact of the batch that caused them, if any.
      def lifecycle_event(type, item, batch_id: nil, actor: API_KEY_ACTOR)
        name = { 'key' => 'asset-name', 'value' => item['name'] }
        # A deleted asset has no portal page to link to.
        name['url'] = "https://calmlens.com/go/asset/#{item['id']}" unless type == 'asset.deleted'
        facts = [name, { 'key' => 'asset-type', 'value' => item['type'] }]
        facts << { 'key' => 'batch-id', 'value' => batch_id } if batch_id
        add_event('type' => type, 'severity' => 'low', 'assetId' => item['id'], 'asset' => snapshot(item),
                  'actor' => deep_copy(actor), 'facts' => facts)
      end

      def fail!(code, message = nil, details: nil) = raise(Failure.new(code, message, details: details))

      def route_not_found!(method, parts) = fail!(ErrorCodes::ROUTE_NOT_FOUND, "No route for #{method} /#{parts.join('/')}")

      # A request the API's schema refuses: `validation/invalid-request` with HTTP 400, listing the
      # field and its issue code (such as `validation/too-big`) in `details.issues`.
      def invalid!(code, path)
        message = "Invalid #{path}"
        raise Failure.new(ErrorCodes::INVALID_REQUEST, message,
                          details: { 'issues' => [{ 'path' => path, 'message' => message, 'code' => code }] }, status: 400)
      end

      # Like the API's schema (METADATA_ITEM_SCHEMA): metadata is nil or a list of `{id, value}`
      # Hashes with a String `id` and any JSON `value`.
      def check_metadata(metadata)
        return if metadata.nil?

        invalid!('validation/invalid-type', 'metadata') unless metadata.is_a?(Array)
        metadata.each_with_index do |item, index|
          invalid!('validation/invalid-type', "metadata.#{index}") unless item.is_a?(Hash)
          invalid!('validation/invalid-type', "metadata.#{index}.id") unless item['id'].is_a?(String)
          invalid!('validation/invalid-value', "metadata.#{index}.value") unless item.key?('value')
        end
      end

      # Like the API's schema, checked before the asset is looked up: asset updates take no null
      # name, and signed URLs no null field.
      def check_asset_body(method, action, json)
        case [method, action]
        in ['PATCH', nil]
          check_metadata(json['metadata'])
          invalid!('validation/invalid-type', 'name') if json.key?('name') && json['name'].nil?
        in ['POST', 'signed-url']
          %w[viewerClaims resource lens transform expiresInSeconds].each do |key|
            next unless json.key?(key) && json[key].nil?

            invalid!(key == 'resource' ? 'validation/invalid-value' : 'validation/invalid-type', key)
          end
          # Like the API, a signed URL is for one of the signed resources.
          invalid!('validation/invalid-value', 'resource') unless CDN::SIGNED_RESOURCES.include?(json.fetch('resource', 'rendered'))
        else nil
        end
      end

      # Like the API: an upload's metadata is checked, then its MIME type, which must be one the
      # API can moderate (`upload/unsupported-type` with `details.mimeType` and `details.source`).
      def check_upload(options)
        check_metadata(options['metadata'])
        type = options['contentType']
        return if type.nil? || Internal.accepted_upload_mime_type?(type)

        fail!(ErrorCodes::UNSUPPORTED_UPLOAD_TYPE, "#{type} is not a valid upload file type",
              details: { 'mimeType' => type, 'source' => 'calmlens' })
      end

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
        content_type = header(headers, 'Content-Type')
        upload = header(headers, 'X-CalmLens-Upload')
        # A raw upload's body is the file itself, whatever its type.
        json = content_type == 'application/json' && body && upload.nil? ? JSON.parse(body) : {}
        # HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
        key = header(headers, 'Idempotency-Key')&.to_s&.gsub(/\A[ \t\r\n]+|[ \t\r\n]+\z/, '')
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
               else route_not_found!(method, parts)
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
        in ['GET', ['policies'], _] then policy_list
        in ['POST', ['policies'], _] then create_policy(json)
        in ['PUT', ['policy'], _] then show_policy(assign_policy(json))
        in [_, ['policies', String => policy_id, *rest], _] then policy(method, policy_id, rest, json)
        in ['GET', ['assets'], _] then list(query)
        in ['GET', ['assets', 'search'], _] then search(query)
        in ['GET', ['assets', String => asset_id, 'timeline'], _] then timeline(asset_id, query)
        in ['POST', ['assets', 'batch'], _] then batch(json)
        in ['POST', ['assets'], nil] then create_asset(json, query['queue'] == true, url: json['url'])
        in ['POST', ['assets'], 'content'] then create_asset(query, query['queue'] == true, data: body)
        in ['POST', ['assets'], 'part'] then start_multipart(query, body)
        else route_not_found!(method, parts)
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
      # content like DELETE /assets/:id/content. Each event carries the batch's `batch-id` fact. Mock
      # assets carry no safety holds.
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
        batch_id = @create_id.call('batch')
        items.each do |item|
          if json['operation'] == 'delete'
            delete_tree(item)
            lifecycle_event('asset.deleted', item, batch_id: batch_id)
          else
            remove_content(item, batch_id)
          end
        end
        respond(202, { 'batchId' => batch_id, 'status' => 'queued', 'assetCount' => items.size })
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
          @processing_options.delete(id)
        end
      end

      def list(query)
        # Like the API: the query schema is checked before the filter.
        page_query(query)
        items = project_assets
        items = items.select { |item| item['folderId'] == query['folderId'] } if query.key?('folderId')
        page(RSQL.filter(items, query['filter']), query, JSON.generate([@project_id, query['filter'], query['folderId']]))
      end

      # Like the API: one keyset page of a parent's child folders, optionally matching `search`, by
      # `name` ascending unless `ordering` (one entry, `name` or `createdAt`) says otherwise, with an
      # `id` tie-breaker, and the ancestors of the parent and the listed folders. Names compare by
      # code point, so case matters.
      def folder_page(query)
        found = project_folders.select do |f|
          f['parentId'] == query['parentId'] && (!query['search'] || f['name'].downcase.include?(query['search'].downcase))
        end
        invalid!('validation/too-big', 'ordering') if ordering(query, nil).size > 1
        scope = JSON.generate([@project_id, query['parentId'], query['search']])
        result = page(found, query, scope, fields: %w[name createdAt], default: { 'field' => 'name', 'direction' => 'asc' })
        page = result['items']
        ids = ([query['parentId']] + page.map { |f| f['id'] }).compact.uniq
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
      # events added since, oldest first, of the `types` (comma-separated) and `assetId` asked for.
      # `nextCursor` is never nil, and a cursor belongs to the filters it was issued with. The mock's
      # key holds every permission, so no event type is excluded.
      def events(query)
        size = check_range(query.fetch('pageSize', DEFAULT_PAGE_SIZE), 'pageSize', MAX_PAGE_SIZE)
        types = query.key?('types') ? query['types'].to_s.split(',', -1) : []
        if query.key?('types') && (types.empty? || types.any? { |type| !type.match?(EVENT_TYPE_PATTERN) })
          invalid!('validation/invalid-value', 'types')
        end
        asset_id = query['assetId']
        invalid!('validation/invalid-format', 'assetId') if asset_id && !asset_id.match?(ASSET_ID_PATTERN)
        filter = [JSON.generate([types.uniq.sort, asset_id])].pack('m0')
        matches = ->(event) { (types.empty? || types.include?(event['type'])) && (asset_id.nil? || event['assetId'] == asset_id) }
        feed = @state.events
        unless query['cursor']
          return { 'items' => [], 'nextCursor' => "mock_#{feed.size}~#{filter}", 'hasMore' => false, 'excludedTypes' => [] }
        end

        match = query['cursor'].to_s.match(/\Amock_(\d+)~(.*)\z/)
        position = match && match[2] == filter ? Integer(match[1], 10) : nil
        fail!(ErrorCodes::INVALID_CURSOR) unless position && position <= feed.size

        taken = []
        following = position
        while following < feed.size && taken.size < size
          event = feed[following]
          following += 1
          taken << event if matches.call(event)
        end
        { 'items' => taken, 'nextCursor' => "mock_#{following}~#{filter}", 'hasMore' => feed.drop(following).any?(&matches),
          'excludedTypes' => [] }
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
          lens = { 'id' => @create_id.call('lens'), 'projectId' => @project_id }.merge(definition)
          return @state.lenses[definition['identifier']] = lens.merge('createdAt' => now, 'updatedAt' => now)
        end

        same = %w[name type active].all? { |key| old[key] == definition[key] } &&
               old['description'] == definition['description'] && canonical(old['transform']) == canonical(definition['transform'])
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
        check_upload(options)
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
        asset = { 'id' => @create_id.call('asset'), 'projectId' => @project_id, 'parentId' => nil,
                  'folderId' => options['folderId'], 'uploadPresetId' => options['uploadPresetId'],
                  'createdAt' => now, 'updatedAt' => now, 'name' => options['name'], 'description' => options['description'],
                  'externalId' => options['externalId'], 'externalUrl' => url || options['externalUrl'],
                  'type' => kind(mime, url), 'metadata' => options['metadata'], 'authorId' => options['authorId'],
                  # Like the API, only the posts CalmLens uses are kept, and only while the content is held.
                  'context' => context.empty? ? nil : { 'items' => context }, 'tags' => options['tags'],
                  'visibility' => options.fetch('visibility', 'private'),
                  **sections(now: now, open: open, keep: keep, format: mime, size: data&.bytesize) }
        @state.assets[asset['id']] = asset
        @processing_options[asset['id']] = processing
        if data
          @state.content[asset['id']] = { 'type' => mime, 'parts' => { 1 => data } }
          asset['content'].merge!(rendering(asset, false)) unless open
        end
        open ? asset : upload_completed(asset, queue, data)
      end

      def sections(now:, open:, keep:, format:, size:)
        {
          'content' => { 'status' => keep ? 'stored' : 'temporary', 'removalReason' => nil, 'updatedAt' => now,
                         'safetyHold' => nil, 'format' => format.empty? ? nil : format, 'extension' => nil,
                         # The mock decodes nothing, so the file's own details are unknown, and like
                         # the API, the rendered file and preview come with processing.
                         'sizeInBytes' => size, 'checksums' => nil, 'width' => nil, 'height' => nil,
                         'durationSeconds' => nil, 'pageCount' => nil, 'perceptualHash' => nil,
                         'perceptualHashQuality' => nil, 'metadata' => nil, 'extractedText' => nil, **NO_RENDERING },
          # Like the API, only an open upload counts the parts received.
          'upload' => { 'status' => open ? 'uploading' : 'completed', 'updatedAt' => now, 'partsReceived' => open ? 1 : nil },
          'classification' => { 'status' => open ? 'queued' : 'processing', 'failureReason' => nil, 'updatedAt' => now,
                                # The mock never reads test inputs.
                                'completedAt' => nil, 'progress' => nil, 'testInput' => false,
                                'moderation' => { 'status' => 'pending', 'manualReviews' => [],
                                                  'flaggedCategories' => [], 'regions' => [], 'timeline' => nil } }
        }
      end

      # Like the API: image uploads in parts total at most 20 MiB, at any size below that.
      def image_size_error(type, size, _final)
        ErrorCodes::UPLOAD_TOO_LARGE if type == 'image' && size > MAX_MULTIPART_IMAGE
      end

      # Like the API: the parts may not overshoot a declared total, and must reach it at the end.
      def total_size_error(total, received, final)
        return if total.nil?

        ErrorCodes::UPLOAD_SIZE_MISMATCH if received > total || (final && received != total)
      end

      # The failure for a size error code, with the limit `upload/too-large` carries.
      def size_failure!(code)
        details = code == ErrorCodes::UPLOAD_TOO_LARGE ? { 'limitBytes' => MAX_MULTIPART_IMAGE, 'source' => 'plan' } : nil
        fail!(code, details: details)
      end

      def check_part_size(size, final)
        return if final || size >= MIN_PART

        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'Multipart upload parts must be at least 5MiB except the final part.')
      end

      # In the API's order: a declared total, then a single final part as the whole upload, then the
      # part itself. The queue mode and declared total are saved with an open upload.
      def start_multipart(query, data)
        check_upload(query)
        total = query['totalSizeInBytes']
        type = kind(query['contentType'].to_s, nil)
        final = query['isFinal'] == true
        size = data.to_s.bytesize
        code = (total && image_size_error(type, total, true)) ||
               (final ? total_size_error(total, size, true) || image_size_error(type, size, true) : nil)
        size_failure!(code) if code
        check_part_size(size, final)
        fail!(total_size_error(total, size, false)) if !final && total_size_error(total, size, false)

        asset = create_asset(query, query['queue'] == true, data: data, open: !final)
        @state.uploads[asset['id']] = { 'queue' => query['queue'] == true, 'total' => total } unless final
        asset
      end

      # A completed upload of a processing asset: moderated for the `upload` trigger, with
      # `asset.uploaded` (the asset before moderation) and then the processing events.
      def upload_completed(asset, queue, bytes = :stored)
        decision = decision_for(asset, 'upload', queue, bytes)
        uploaded = snapshot(asset)
        format = asset['content']['format']
        decided(asset, decision) unless decision.status == 'pending'
        add_event('type' => 'asset.uploaded', 'severity' => 'low', 'assetId' => asset['id'], 'asset' => uploaded,
                  'facts' => [{ 'key' => 'asset-type', 'value' => asset['type'] }, asset_name_fact(asset),
                              { 'key' => 'file-format', 'value' => format }])
        record_processing_events(asset, decision)
        asset
      end

      # Asks `moderate` how to decide `asset`, with its content: `bytes` when the caller has them,
      # otherwise the stored parts in order (none once the content is removed).
      def decision_for(asset, trigger, queued, bytes = :stored)
        if bytes == :stored
          stored = asset['content']['status'] == 'removed' ? nil : @state.content[asset['id']]
          bytes = stored && stored['parts'].sort.map { |_, part| part.to_s.b }.join.b
        end
        return MockDecision.from(default_moderation(trigger, queued)) unless @moderate

        text = bytes && asset['type'] == 'plaintext-document' ? bytes.dup.force_encoding(Encoding::UTF_8).scrub : nil
        content = MockModerationInput::Content.new(bytes: bytes&.dup, text: text)
        MockDecision.from(@moderate.call(MockModerationInput.new(asset: deep_copy(asset), content: content, trigger: trigger,
                                                                 queued: queued)))
      end

      # Without `moderate`, queued work stays pending until completed, which allows it.
      def default_moderation(trigger, queued) = queued && trigger != 'complete' ? 'pending' : 'allowed'

      # Applies `decision` to `asset` with its report. Like the API for an image with nobody in it, a
      # decided image reports the person and face detection its upload turned on.
      def decided(asset, decision)
        apply_outcome(asset, decision.status, 'policy', decision.report)
        classification = asset['classification']
        return asset unless classification['status'] == 'completed' && asset['type'] == 'image'

        processing = @processing_options[asset['id']]
        features = processing.is_a?(Hash) ? processing['features'] : nil
        enabled = ->(name) { features.is_a?(Hash) && features[name].is_a?(Hash) && features[name]['enabled'] == true }
        { 'personDetection' => 'people', 'faceDetection' => 'faces' }.each do |feature, list|
          classification[feature] = { 'status' => 'evaluated', 'stage' => 'beta', list => [] } if enabled.call(feature)
        end
        asset
      end

      # Asks `moderate` (unless `decision` is given) and settles a processing asset: a decision and
      # its events, or nothing for `pending`.
      def moderate_stored(asset, trigger, decision = nil)
        decision ||= decision_for(asset, trigger, true)
        return asset if decision.status == 'pending'

        decided(asset, decision)
        record_processing_events(asset, decision)
        asset
      end

      def asset_name_fact(item) = { 'key' => 'asset-name', 'value' => item['name'], 'url' => "https://calmlens.com/go/asset/#{item['id']}" }

      # The events the pipeline records when it settles an asset (AssetClassification.ts and
      # AssetErrorAlert.ts): `asset.classified` and the automated `asset.<status>`, or `asset.failed`.
      def record_processing_events(item, decision)
        return if decision.status == 'pending'

        if decision.status == 'failed'
          return add_event('type' => 'asset.failed', 'severity' => 'high', 'assetId' => item['id'], 'asset' => snapshot(item),
                           'actor' => deep_copy(AUTOMATED_ACTOR),
                           'facts' => [asset_name_fact(item), { 'key' => 'asset-type', 'value' => item['type'] },
                                       { 'key' => 'previous-status', 'value' => 'processing' },
                                       { 'key' => 'failure-reason',
                                         'value' => item['classification']['failureReason'] || 'processing-error' }])
        end

        flagged = decision.report['flaggedCategories']
        add_event('type' => 'asset.classified', 'severity' => 'low', 'assetId' => item['id'], 'asset' => snapshot(item),
                  'actor' => deep_copy(AUTOMATED_ACTOR),
                  'facts' => [{ 'key' => 'flagged-categories', 'value' => flagged },
                              { 'key' => 'moderation-status', 'value' => decision.status },
                              { 'key' => 'asset-type', 'value' => item['type'] }, asset_name_fact(item)])
        # Like the event catalog: only allowing and limiting are low severity.
        add_event('type' => "asset.#{decision.status}", 'severity' => %w[allowed limited].include?(decision.status) ? 'low' : 'high',
                  'assetId' => item['id'], 'asset' => snapshot(item), 'actor' => deep_copy(AUTOMATED_ACTOR),
                  'facts' => [{ 'key' => 'flagged-categories', 'value' => flagged },
                              { 'key' => 'asset-type', 'value' => item['type'] }, asset_name_fact(item)])
      end

      # Moves an asset to an outcome like the pipeline would: a decision finishes processing, `purged`
      # deletes the content (with `purge_reason`, `policy` for the pipeline), and finished processing
      # removes content kept only temporarily. A decided asset gets its rendered file and preview
      # (with a ThumbHash for its placeholder), which go with its content. `report` is a decision's
      # categories, score and policy.
      def apply_outcome(asset, outcome, purge_reason = 'policy', report = nil)
        processing, moderation = AssetRecord.statuses(outcome)
        now = @now.call
        decided = processing == 'completed'
        purge = moderation == 'purged' && asset['content']['status'] != 'removed'
        remove = purge || (decided && asset['content']['status'] == 'temporary')
        # Like the API, an asset whose content is held has its rendered file and preview, completed by
        # its decision, and removing content (when processing finishes or by purging) removes them
        # with it, so no placeholder outlives the content. A safety hold withholds them.
        content = asset['content']
        held = content['status'] != 'removed' && !purge && !content['safetyHold']
        content.merge!(held ? rendering(asset, decided) : NO_RENDERING)
        if remove
          forget_content(asset)
          content.merge!('status' => 'removed', 'removalReason' => purge ? purge_reason : 'retention', 'updatedAt' => now,
                         'extractedText' => nil, 'metadata' => nil, **NO_RENDERING)
        end
        asset['upload'].merge!('status' => 'completed', 'updatedAt' => now)
        update_classification(asset['classification'], processing, moderation, now)
        asset['classification']['moderation'].merge!(deep_copy(report)) if report
        asset['updatedAt'] = now
        asset
      end

      # Like the API, a failed asset says why (the mock has only `processing-error`).
      def update_classification(classification, processing, moderation, now)
        classification.merge!('status' => processing, 'failureReason' => processing == 'failed' ? 'processing-error' : nil,
                              'updatedAt' => now, 'completedAt' => processing == 'completed' ? now : nil)
        classification['moderation']['status'] = moderation
      end

      # Like the API, the earlier posts CalmLens used go with the stored content.
      def forget_content(item)
        @state.content.delete(item['id'])
        item['context'] = nil
      end

      # Whether browsers play an audio or video upload's format as it is, so it is served as stored.
      def browser_safe_media?(format) = BROWSER_SAFE_MEDIA_FORMATS.include?(mime_type(format))

      # A MIME type without parameters, in lower case.
      def mime_type(format) = format.to_s.downcase.split(';', 2).first.to_s.strip

      # The rendered file and preview the API reports for an asset with its content held (Asset.ts,
      # getAssetRendered and getAssetPreview). Once uploaded, an image renders as itself with a preview
      # that has no ThumbHash yet, and a PDF and browser-safe audio and video render as uploaded. Once
      # processed, a website renders as its screenshot; a document or presentation as a PDF, with its
      # first page as the preview; video and audio as a browser-safe file (MP4 or M4A unless browsers
      # play the upload), audio with a waveform preview and video with no poster; and every preview has
      # its ThumbHash. Text, spreadsheets and other files have neither. The mock decodes nothing, so
      # sizes are unknown, audio has no peaks, and audio and video never get an adaptive stream.
      def rendering(asset, processed) = { **rendered_file(asset, processed), 'hls' => nil }

      # The rendered file and preview of {#rendering}.
      def rendered_file(asset, processed)
        format = asset['content']['format']
        mime = mime_type(format)
        safe = browser_safe_media?(format)
        media = %w[video audio].include?(asset['type'])
        return NO_RENDERING.dup unless processed || asset['type'] == 'image' || mime == 'application/pdf' || (media && safe)

        unsized = { 'width' => nil, 'height' => nil }
        preview = lambda do |size = unsized|
          size.merge('thumbhash' => processed ? THUMBHASH : nil, 'averageColor' => processed ? '#7f7f7f' : nil)
        end
        case asset['type']
        when 'image' then { 'rendered' => { 'kind' => 'image', 'format' => format || 'image/png', **unsized }, 'preview' => preview.call }
        when 'website' then { 'rendered' => { 'kind' => 'image', 'format' => 'image/png', **unsized }, 'preview' => preview.call }
        when 'multimedia-document'
          return NO_RENDERING.dup if SPREADSHEET_MIME_TYPES.include?(mime)

          { 'rendered' => { 'kind' => 'pdf', 'format' => 'application/pdf', **unsized }, 'preview' => processed ? preview.call : nil }
        when 'video' then { 'rendered' => { 'kind' => 'video', 'format' => safe ? format : 'video/mp4', **unsized }, 'preview' => nil }
        when 'audio'
          rendered = { 'kind' => 'audio', 'format' => safe ? format : 'audio/mp4', **unsized }
          rendered['peaks'] = [] if processed
          { 'rendered' => rendered, 'preview' => processed ? preview.call(WAVEFORM_SIZE.dup) : nil }
        else NO_RENDERING.dup
        end
      end

      def asset(method, parts, query, json, body)
        id = parts[1]
        check_asset_body(method, parts[2], json)
        item = @state.assets[id]
        fail!(ErrorCodes::ASSET_NOT_FOUND) unless item && item['projectId'] == @project_id
        case [method, parts[2]]
        in ['GET', nil] then item
        in ['PATCH', nil] then update(item, json)
        in ['DELETE', nil]
          @state.assets.delete(id)
          @state.content.delete(id)
          @processing_options.delete(id)
          lifecycle_event('asset.deleted', item)
          nil
        in ['DELETE', 'content'] then remove_content(item)
        in ['GET', 'children'] then page(project_assets.select { |child| child['parentId'] == id }, query, id)
        in ['POST', 'retry'] then retry_asset(item)
        in ['POST', 'explain'] then explain(item, json['rerun'])
        in ['POST', 'decision'] then decide_request(item, json)
        in ['POST', 'move']
          check_folder(json['folderId']) if json['folderId']
          touch(item.merge!('folderId' => json['folderId']))
        in ['POST', 'signed-url'] then signed_url(id, json)
        in ['POST', 'part'] then part(item, query, body)
        else route_not_found!(method, parts)
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

      # Like the API: the record and report stay; stored content, extracted text, metadata, the
      # rendered file and the preview go. Content already removed keeps its reason, and an `asset.content-removed` event is
      # recorded either way, with the `batch-id` fact of the batch that removed it, if any.
      def remove_content(item, batch_id = nil)
        forget_content(item)
        content = item['content']
        if content['status'] == 'removed'
          content.merge!(NO_RENDERING)
        else
          now = @now.call
          content.merge!('status' => 'removed', 'removalReason' => 'requested', 'updatedAt' => now, 'extractedText' => nil,
                         'metadata' => nil, **NO_RENDERING)
          item['updatedAt'] = now
        end
        lifecycle_event('asset.content-removed', item, batch_id: batch_id)
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
        moderate_stored(item, 'retry')
      end

      def explain(item, rerun)
        fail!(ErrorCodes::ASSET_NOT_DECIDED) unless item['classification']['status'] == 'completed'
        moderation = item['classification']['moderation']
        unless rerun
          # Like the API: the evidence is completed and every action stays as decided.
          return item unless moderation['explanationComplete'] == false

          moderation['explanationComplete'] = true
          return touch(item)
        end
        fail!(ErrorCodes::ASSET_REVIEWED) unless moderation.fetch('manualReviews', []).empty?
        fail!(ErrorCodes::ASSET_CONTENT_UNAVAILABLE) if item['content']['status'] == 'removed'

        # Like the API: back to processing, to be moderated again under the current policy.
        apply_outcome(item, 'pending')
        moderate_stored(item, 'rerun')
      end

      def signed_url(id, json)
        expires = json.fetch('expiresInSeconds', 900)
        query = json.slice('lens', 'transform').merge('expires' => expires)
        # Like the API, the URL carries the viewer claims its signature covers.
        query['viewerClaims'] = JSON.generate(json['viewerClaims']) if json['viewerClaims'].is_a?(Hash)
        params = URI.encode_www_form(query)
        { 'url' => "#{@cdn_base_url}/signed/#{URI.encode_www_form_component(id)}/#{json.fetch('resource', 'rendered')}?#{params}",
          'expiresAt' => @now.call + (expires * 1000) }
      end

      # In the API's order: the upload must be open, parts arrive in order, image totals and the
      # declared total are checked, then the part itself (5 MiB unless it is the last).
      def part(item, query, body)
        fail!(ErrorCodes::UPLOAD_NOT_OPEN) unless item['upload']['status'] == 'uploading'
        number = query['partNumber']
        expected = item['upload']['partsReceived'].to_i + 1
        unless number == expected && number <= MAX_PARTS
          fail!(ErrorCodes::INVALID_UPLOAD_PART_NUMBER, "Expected part #{expected}",
                details: { 'expectedPartNumber' => expected, 'receivedPartNumber' => number })
        end
        final = query['isFinal'] == true
        size = body.to_s.bytesize
        received = item['content']['sizeInBytes'].to_i + size
        upload = @state.uploads[item['id']] || {}
        code = image_size_error(item['type'], received, final) || total_size_error(upload['total'], received, final)
        size_failure!(code) if code
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
        apply_outcome(item, 'pending')
        upload_completed(item, queue)
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

      # Policies: the project starts on the organisation's own General preset policy, following
      # automatic updates. The mock holds no built-in preset settings: a preset's settings are
      # `{ 'categorySettings' => {} }` at version 1, and uploads are never decided by a policy.
      def new_policy(name, settings, description: '', automatic_updates: false, preset: nil)
        now = @now.call
        item = { 'id' => @create_id.call('pol'), 'name' => name, 'description' => description, 'settings' => settings,
                 'revision' => 1, 'automaticUpdates' => automatic_updates, 'preset' => preset,
                 'baseline' => deep_copy(settings), 'createdAt' => now, 'updatedAt' => now }
        @policies[item['id']] = item
      end

      def ensure_policies
        return if @project_policy_id

        preset = { 'id' => 'general-community', 'version' => 1, 'own' => true }
        @project_policy_id = new_policy(PRESET_NAMES['general-community'], { 'categorySettings' => {} },
                                        automatic_updates: true, preset: preset)['id']
      end

      # A stored policy as the API shows it.
      def show_policy(item)
        shown = item.except('baseline')
        shown['preset'] = item['preset'].merge('latestVersion' => 1) if item['preset']
        shown.merge('projectIds' => item['id'] == @project_policy_id ? [@project_id] : [])
      end

      def find_policy(id)
        ensure_policies
        @policies[id] || fail!(ErrorCodes::POLICY_NOT_FOUND)
      end

      def policy_list
        ensure_policies
        { 'policies' => @policies.values.map { |item| show_policy(item) }, 'projectPolicyId' => @project_policy_id }
      end

      def create_policy(json)
        ensure_policies
        name, preset_id, settings = json.values_at('name', 'presetId', 'settings')
        named = name.is_a?(String) && !name.strip.empty?
        if settings.nil? == preset_id.nil? || (preset_id && !PRESET_NAMES.key?(preset_id)) || (preset_id.nil? && !named)
          fail!(ErrorCodes::INVALID_VALUE, 'Send settings with a name, or presetId')
        end
        description = json['description'].is_a?(String) ? json['description'] : ''
        item = if preset_id
                 origin = { 'id' => preset_id, 'version' => 1, 'own' => false }
                 new_policy(named ? name.strip : PRESET_NAMES[preset_id], { 'categorySettings' => {} },
                            description: description, preset: origin)
               else
                 new_policy(name.strip, settings, description: description)
               end
        # Like the API, a new policy is 201 Created.
        respond(201, deep_copy(show_policy(item)))
      end

      def assign_policy(json)
        item = find_policy(json['policyId'].to_s)
        @project_policy_id = item['id']
        item
      end

      # Saves new values under the next revision, once `revision` is the current one.
      def save_policy(item, revision, values)
        fail!(ErrorCodes::POLICY_REVISION_CONFLICT) unless revision.is_a?(Integer) && revision == item['revision']

        item.merge!(values, 'revision' => item['revision'] + 1, 'updatedAt' => @now.call)
        show_policy(item)
      end

      def policy(method, id, rest, json)
        item = find_policy(id)
        case [method, rest]
        in ['GET', []] then show_policy(item)
        in ['PATCH', []] then update_policy(item, json)
        in ['DELETE', []]
          fail!(ErrorCodes::POLICY_IN_USE) if item['id'] == @project_policy_id
          @policies.delete(id)
          {}
        in ['POST', ['preset']] then apply_policy_preset(item, json)
        in ['PUT', ['automatic-updates']] then set_policy_automatic_updates(item, json)
        else route_not_found!(method, ['policies', id, *rest])
        end
      end

      def update_policy(item, json)
        values = %w[name description].select { |key| json[key].is_a?(String) }
                                     .to_h { |key| [key, key == 'name' ? json[key].strip : json[key]] }
        values['settings'] = json['settings'] if json.key?('settings')
        # Saving a policy that follows its preset pins it as a copy.
        save_policy(item, json['revision'], values.merge('automaticUpdates' => false))
      end

      def apply_policy_preset(item, json)
        preset = item['preset']
        fail!(ErrorCodes::POLICY_NO_PRESET) if preset.nil? || item['automaticUpdates']
        fail!(ErrorCodes::POLICY_PRESET_VERSION_CONFLICT) unless json['presetVersion'] == preset['version']
        # The mock's presets have one release, so an update never has a newer one to apply.
        fail!(ErrorCodes::POLICY_PRESET_UPDATE_UNAVAILABLE) if json['operation'] == 'update'

        save_policy(item, json['revision'], 'settings' => deep_copy(item['baseline']))
      end

      def set_policy_automatic_updates(item, json)
        enabled = json['enabled'] == true
        preset = item['preset']
        fail!(ErrorCodes::POLICY_AUTOMATIC_UPDATES_UNAVAILABLE) if preset.nil? || !preset['own'] || item['automaticUpdates'] == enabled
        fail!(ErrorCodes::POLICY_REVISION_CONFLICT) unless json['revision'] == item['revision']
        fail!(ErrorCodes::POLICY_PRESET_VERSION_CONFLICT) unless json['presetVersion'] == 1

        values = { 'automaticUpdates' => enabled }
        values.merge!('name' => PRESET_NAMES[preset['id']], 'description' => '', 'settings' => deep_copy(item['baseline'])) if enabled
        save_policy(item, json['revision'], values)
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
                 'action' => json['action'], 'createdAt' => now, 'updatedAt' => now }
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
          content = asset['content']
          fail!(ErrorCodes::HASH_LIST_ASSET_NOT_HASHED) unless content['perceptualHash']
          hash = content['perceptualHash']
          quality = content['perceptualHashQuality']
        end
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'Use a PDQ hash of 64 hexadecimal characters') unless hash.match?(/\A\h{64}\z/)

        existing = @state.hash_list_entries.values.find { |entry| entry['hashListId'] == list['id'] && entry['hash'] == hash }
        return existing if existing

        entry = { 'id' => @create_id.call('hle'), 'projectId' => @project_id, 'hashListId' => list['id'], 'hash' => hash,
                  'quality' => quality, 'label' => json['label'].is_a?(String) ? json['label'] : nil,
                  'assetId' => asset_id, 'createdAt' => @now.call }
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

      # An asset's findings timeline, as the API lists it (publicGetAssetTimeline.ts): refused while a
      # safety hold is on. The mock analyses no audio or video, so it keeps no segments: every
      # timeline is empty, and no cursor continues one.
      def timeline(id, query)
        item = own_asset(id)
        fail!(ErrorCodes::ASSET_NOT_FOUND) unless item
        size = check_range(query.fetch('pageSize', DEFAULT_PAGE_SIZE), 'pageSize', MAX_PAGE_SIZE)
        fail!(ErrorCodes::ASSET_HELD, details: { 'hold' => 'safety' }) if item['content']['safetyHold']
        fail!(ErrorCodes::INVALID_CURSOR) if query.key?('cursor')

        { 'items' => [], 'nextCursor' => nil, 'pageSize' => size, 'hasMore' => false, 'ordering' => [] }
      end

      # The page size and ordering, refused like the API's query schema: each ordering entry's field
      # and direction are enum values.
      def page_query(query, fields = %w[createdAt id], default = { 'field' => 'createdAt', 'direction' => 'desc' })
        size = check_range(query.fetch('pageSize', DEFAULT_PAGE_SIZE), 'pageSize', MAX_PAGE_SIZE)
        ordering = ordering(query, default)
        ordering.each_with_index do |rule, index|
          invalid!('validation/invalid-value', "ordering.#{index}.field") unless fields.include?(rule['field'])
          invalid!('validation/invalid-value', "ordering.#{index}.direction") unless %w[asc desc].include?(rule['direction'])
        end
        [size, ordering]
      end

      # One keyset page like the API's: ordered by `fields` (`createdAt` descending by default; an `id`
      # tie-breaker is added), starting after the cursor's values. The cursor is tied to `scope` (the
      # filter, folder or parent) and the ordering, so it only continues the query it came from.
      def page(items, query, scope, fields: %w[createdAt id], default: { 'field' => 'createdAt', 'direction' => 'desc' })
        size, ordering = page_query(query, fields, default)
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
          return rule['direction'] == 'desc' ? result.negative? : result.positive? unless result.zero?
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
          return rule['direction'] == 'desc' ? -result : result unless result.zero?
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

      # Answers like the CDN (serveAssetResource.ts): `original` is the upload; `rendered` the image,
      # PDF, video or audio file `content.rendered` describes; `preview` the still `content.preview`
      # describes; `hls` the adaptive stream's files, which the mock never prepares; `embed` a small
      # page standing in for the embed page of any asset; and `placeholder` the preview's ThumbHash as a PNG, public
      # whatever the asset's visibility or moderation. A safety hold refuses every resource. Other resources pass delivery checks first,
      # which refuse everyone (content still uploading, blocked or purged, failed processing, removed
      # content), then an age-restricted asset needs `viewerClaims.ageConfirmed=true` whatever the key,
      # and a private asset needs an API key with `assets:download` for its folder. The mock converts
      # nothing: an upload stands in for its rendered file, an image for its own preview, and the
      # placeholder PNG for a screenshot, page or waveform.
      def serve(method, relative)
        path, query = relative.split('#', 2).first.split('?', 2)
        raw_segments = path.split('/').reject(&:empty?)
        _, project, identifier, resource = raw_segments.map { |part| URI.decode_www_form_component(part) }
        selector_path = raw_segments.drop(4)
        # Like the CDN, the adaptive stream's files sit beneath `/hls/` (its master playlist is
        # `/hls/index.m3u8`). Otherwise the selector after the resource is read
        # (AssetTransformParser.ts); the original and the embed page take none.
        begin
          lens, options = TransformRules.parse_selector(resource == 'hls' ? '' : selector_path.join('/'))
        rescue ArgumentError
          return invalid_transform
        end
        selected = !(lens || options).nil?
        return invalid_transform if %w[original embed].include?(resource) && selected

        item = project == @project_id && project_assets.find { |asset| [asset['id'], asset['externalId']].include?(identifier) }
        return error('asset/not-found', 'Asset not found', status: 404) unless item && RESOURCES.include?(resource)
        return not_available if item['content']['safetyHold']
        return placeholder(method, item) if resource == 'placeholder'

        deliver(method, item, resource, URI.decode_www_form(query.to_s).to_h, selected ? options || {} : nil)
      end

      # Serves a found asset's resource after the delivery, age and access checks, then whether it
      # has the resource and takes the selector, then the transform options' schema check.
      # `selector` is the selector's options (empty for a lens alone), or nil without one.
      def deliver(method, item, resource, params, selector)
        stored = @state.content[item['id']]
        refused = refuse_delivery(item, resource, stored, params)
        return refused if refused

        restricted = item['visibility'] != 'public'
        return embed(method, item, restricted, params) if resource == 'embed'

        # Then whether the asset has the resource, and whether it is a still image that takes a lens
        # or transform: the preview always is, the rendered file only when it is an image.
        rendered, preview = item['content'].values_at('rendered', 'preview')
        return no_rendered_version if (resource == 'rendered' && !rendered) || (resource == 'preview' && !preview)
        # The mock prepares no stream, so it has no HLS files.
        return no_rendered_version if resource == 'hls'

        still = resource == 'preview' || (resource == 'rendered' && rendered['kind'] == 'image')
        return invalid_transform if !still && selector

        refused = selector ? TransformRules.check(selector).flatten : []
        return error(ErrorCodes::INVALID_TRANSFORM_OPTIONS, "Invalid transform options: #{refused.join(', ')}", status: 400) if refused.any?

        bytes, type = resource_body(item, resource, stored)
        return not_available unless bytes

        immutable = still || (resource == 'original' && item['type'] == 'image')
        cdn_response(method, bytes, viewer_delivery_headers(item, type, restricted, immutable, params))
      end

      # The delivery checks, which refuse everyone, then age and access, as an error response, or nil.
      # Only the original needs the upload still stored.
      def refuse_delivery(item, resource, stored, params)
        moderation = item['classification']['moderation']['status']
        if (resource == 'original' && stored.nil?) || item['upload']['status'] == 'uploading' ||
           %w[blocked purged].include?(moderation) || item['classification']['status'] == 'failed' ||
           item['content']['status'] == 'removed'
          return not_available
        end
        if moderation == 'age-restricted' && !viewer_age_confirmed?(params)
          return error('viewer/age-confirmation-required', 'Age confirmation required', status: 403)
        end
        return if item['visibility'] == 'public' || can_download?(item['folderId'])

        error(ErrorCodes::PERMISSION_DENIED, 'This API key needs assets:download permission for this asset’s folder.', status: 403)
      end

      # A resource's bytes and Content-Type: the upload, which stands in for its own rendered file
      # and an image's preview, or the placeholder PNG for a still the mock doesn't make. Nil bytes
      # when the upload is no longer stored.
      def resource_body(item, resource, stored)
        rendered = item['content']['rendered']
        serves_upload = resource == 'original' || (resource == 'rendered' && rendered['kind'] != 'image') || item['type'] == 'image'
        return [Placeholder.png(item.dig('content', 'preview', 'thumbhash') || THUMBHASH), 'image/png'] unless serves_upload
        return [nil, nil] unless stored

        type = if resource == 'rendered' then rendered['format']
               elsif stored['type'].to_s.empty? then 'application/octet-stream'
               else stored['type']
               end
        [stored['parts'].sort.map(&:last).join.b, type]
      end

      def viewer_age_confirmed?(params)
        JSON.parse(params.fetch('viewerClaims', '{}'))['ageConfirmed'] == true
      end

      def viewer_delivery_headers(item, type, restricted, immutable, params)
        headers = delivery_headers(item, type, restricted, immutable)
        headers['Cache-Control'] = 'private, no-store' if params.key?('viewerClaims')
        headers
      end

      # The embed page, which shows any asset that may be delivered, as its viewer for the asset's
      # type or a notice that the type has none; cached like other non-image content.
      def embed(method, item, restricted, params)
        cache = if params.key?('viewerClaims') then 'private, no-store'
                else "#{restricted ? 'private' : 'public'}, max-age=3600"
                end
        cdn_response(method, EMBED_HTML, { 'content-type' => 'text/html; charset=utf-8', 'cache-control' => cache,
                                           'cache-tag' => "asset-#{item['id']}", 'x-content-type-options' => 'nosniff' })
      end

      def invalid_transform = error(ErrorCodes::INVALID_TRANSFORM, 'Invalid transform selector', status: 400)

      def no_rendered_version = error('asset/no-rendered-version', 'This asset has no such resource', status: 404)

      def not_available = error('asset/not-available', 'Asset is not available', status: 403)

      # Like the CDN's placeholder handler: the preview's ThumbHash, public whatever the asset's
      # visibility or moderation; refused for purged assets and assets without one (not yet
      # processed, without a preview, or content removed).
      def placeholder(method, item)
        thumbhash = item.dig('content', 'preview', 'thumbhash')
        return not_available if thumbhash.nil? || item['classification']['moderation']['status'] == 'purged'

        cdn_response(method, Placeholder.png(thumbhash),
                     'content-type' => 'image/png', 'cache-control' => 'public, max-age=3600',
                     'cache-tag' => "asset-#{item['id']}", 'etag' => "\"#{thumbhash}\"")
      end

      # Like the CDN: a still image's bytes are immutable for a year, other content is kept for an
      # hour, by shared caches only when delivery is public. Active content is served as a download.
      def delivery_headers(item, type, restricted, immutable)
        lifetime = immutable ? 'max-age=31536000, immutable' : 'max-age=3600'
        headers = { 'content-type' => type, 'cache-control' => "#{restricted ? 'private' : 'public'}, #{lifetime}",
                    'cache-tag' => "asset-#{item['id']}" }
        headers.merge!('etag' => "\"#{item['id']}\"", 'expires' => Time.at((@now.call / 1000) + 31_536_000).utc.httpdate) if immutable
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

    # The processing and moderation status of each outcome.
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
    end
  end
end
