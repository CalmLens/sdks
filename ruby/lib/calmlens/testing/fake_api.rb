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
    # filters and sorting, serves stored bytes, and answers errors with the API's codes, statuses,
    # details and body shape, checking requests in the API's order. It moderates through the
    # `moderate` callback rather than classifying content, and does not run transforms or index for
    # semantic search.
    # @api private
    class FakeAPI
      JSON_QUERY = %w[wait isFinal sizeInBytes totalSizeInBytes partNumber pageSize].freeze
      # Keyword search fields, in the order matches are reported, and where each value sits in the asset.
      SEARCH_FIELDS = { 'name' => %w[name], 'id' => %w[id], 'externalId' => %w[externalId],
                        'description' => %w[description], 'tags' => %w[tags], 'type' => %w[type],
                        'content.format' => %w[content format], 'content.extension' => %w[content extension],
                        'classification.moderation.status' => %w[classification moderation status] }.freeze
      MAX_SEARCH_TOKENS = 8
      MAX_SEARCH_PAGE_SIZE = 20
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
      RESOURCES = %w[original rendered preview hls embed placeholder info].freeze
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
      NO_RENDERING = { 'rendered' => nil, 'hls' => nil, 'hlsStatus' => nil, 'preview' => nil }.freeze
      # The size of the waveform the API makes as an audio asset's preview.
      WAVEFORM_SIZE = { 'width' => 1200, 'height' => 300 }.freeze
      # Audio and video formats browsers play as uploaded, so the API serves them as stored (Asset.ts).
      BROWSER_SAFE_MEDIA_FORMATS = %w[video/mp4 audio/mpeg audio/aac audio/mp4 audio/x-m4a audio/ogg].freeze
      # Spreadsheets, which have no rendered file or preview (Asset.ts).
      SPREADSHEET_MIME_TYPES = %w[application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
                                  application/vnd.ms-excel.sheet.macroenabled.12 application/vnd.ms-excel
                                  application/vnd.oasis.opendocument.spreadsheet].freeze
      # The settings of the mock's presets: every category with its default action (`allow` for
      # personal information and profanity, `block` otherwise) and no rules. The mock holds no
      # built-in preset settings, and uploads are never decided by a policy.
      PRESET_SETTINGS = {
        'categorySettings' => MockClassification::CATEGORIES.to_h do |category|
          [category, { 'action' => %w[personal-information profanity].include?(category) ? 'allow' : 'block',
                       'allowances' => [], 'restrictions' => [] }]
        end
      }.freeze
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

      # Splits an upload form as the API reads it: exactly an `options` part, then a `file` part, then
      # the closing boundary.
      # @return [Array(String, String), nil] the options part's text and the file's bytes, or nil
      #   when the body isn't such a form.
      def self.upload_form(body, content_type)
        boundary = content_type.to_s.match(%r{\Amultipart/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))}i)
        return nil unless boundary

        framed = "\r\n".b + body.to_s.b
        delimiter = "\r\n--#{boundary[1] || boundary[2]}".b
        return nil unless framed.start_with?(delimiter)

        parts = []
        at = 0
        until framed.byteslice(at + delimiter.bytesize, 2) == '--'
          start = at + delimiter.bytesize
          header_end = framed.index("\r\n\r\n".b, start)
          following = header_end && framed.index(delimiter, header_end + 4)
          return nil unless following

          name = framed.byteslice(start, header_end - start)[/content-disposition:\s*form-data\s*;[^\r\n]*?\bname="([^"]*)"/i, 1]
          parts << [name, framed.byteslice(header_end + 4, following - header_end - 4)]
          at = following
        end
        return nil unless parts.map(&:first) == %w[options file]

        [parts[0][1].force_encoding(Encoding::UTF_8), parts[1][1]]
      end

      def initialize(project_id:, base_url:, cdn_base_url:, now:, create_id:, moderate:, api_key:, grants:)
        @project_id = project_id
        @api_key = api_key
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
        # The project's configuration: upload presets by key, the settings it has set, its metadata
        # fields in display order and the revision the settings and fields share.
        @upload_presets = {}
        @project_settings = {}
        @metadata_fields = []
        @settings_revision = 1
        @request_count = 0
        # Each asset's latest `assetSequence`, which the API keeps on the asset row.
        @asset_event_sequences = Hash.new(0)
        # The processing options each asset was uploaded with, which the API keeps but doesn't return.
        @processing_options = {}
        # Decided assets whose re-run (`assets.explain` with `rerun: true`) is still queued: they keep
        # their decision until `complete_processing` decides them.
        @reruns = {}
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

        record_decision(item, decision, nil, false)
        deep_copy(item)
      end

      # Finishes processing an asset as the pipeline would, with `decision` or else what `moderate`
      # answers for the `complete` trigger, and returns it; nil when there is no such asset. A decided
      # asset whose re-run is still queued counts as processing.
      def complete_processing(asset_id, decision)
        item = own_asset(asset_id)
        return unless item

        rerun = @reruns.key?(asset_id)
        raise Internal.invalid("Asset #{asset_id} isn't processing") unless rerun || item['classification']['status'] == 'processing'

        settled = decision.nil? ? nil : MockDecision.from(decision)
        rerun ? settle_rerun(item, 'complete', settled) : moderate_stored(item, 'complete', settled)
        deep_copy(item)
      end

      # @return [Response]
      def handle(method, url, headers, body)
        if url.start_with?("#{@cdn_base_url}/")
          serve(method, url.delete_prefix(@cdn_base_url), headers)
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
      # review is the mock API key's, which has no ID. A decision through the API (`by_api_key`) has
      # the API key as its events' actor; the test hook's is a reviewer's (a `user`).
      def record_decision(item, decision, note, by_api_key)
        # Like the API: a queued re-run no longer replaces a reviewed decision.
        @reruns.delete(item['id'])
        apply_outcome(item, decision, 'requested')
        # Like the API: the human review queue's decision settles its review, one through the API
        # leaves it waiting.
        item['classification']['moderation']['pendingReview'] = nil unless by_api_key
        review = { 'id' => @create_id.call('rev'), 'decision' => decision, 'note' => note,
                   'decidedBy' => { 'type' => 'api-key', 'id' => nil }, 'reviewedAt' => @now.call, 'applied' => true }
        actor = by_api_key ? API_KEY_ACTOR : REVIEWER_ACTOR
        item['classification']['moderation']['manualReviews'] << review
        lifecycle_event('asset.content-removed', item, actor: actor) if decision == 'purged'
        # Like the event catalog: only allowing and limiting are low severity.
        add_event('type' => "asset.#{decision}", 'severity' => %w[allowed limited].include?(decision) ? 'low' : 'high',
                  'title' => "asset.#{decision}", 'assetId' => item['id'], 'asset' => snapshot(item),
                  'actor' => deep_copy(actor),
                  'facts' => [{ 'key' => 'asset-type', 'value' => item['type'] },
                              { 'key' => 'asset-name', 'value' => item['name'], 'url' => "https://calmlens.com/go/asset/#{item['id']}" },
                              { 'key' => 'note', 'value' => note }])
      end

      # `POST /assets/:id/decision` as the API validates and applies it, with the API key as its
      # events' actor. An asset still uploading or processing is refused with `asset/processing`.
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

        record_decision(item, decision, note, true)
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

      # Like the API's schema, checked before the asset is looked up: asset updates take no null name.
      def check_asset_body(method, action, json)
        return unless method == 'PATCH' && action.nil?

        check_metadata(json['metadata'])
        invalid!('validation/invalid-type', 'name') if json.key?('name') && json['name'].nil?
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
        request = { query: query, json: json, body: body, upload: upload, content_type: content_type }
        return dispatch(method, parts, request) unless key && method == 'POST'

        fail!(ErrorCodes::INVALID_IDEMPOTENCY_KEY) unless key.match?(IDEMPOTENCY_KEY)
        # Like the API: a successful response is saved and replayed for the same key and request;
        # a failed one frees the key. An upload form counts by its options and file, not its boundary.
        form = upload && FakeAPI.upload_form(body, content_type)
        fingerprint = if form
                        [method, relative, 'multipart/form-data', form[0], Digest::SHA256.hexdigest(form[1])]
                      else
                        [method, relative, content_type, Digest::SHA256.hexdigest(body.to_s)]
                      end
        saved = @state.idempotency[key]
        if saved
          fail!(ErrorCodes::IDEMPOTENCY_KEY_REUSED) unless saved[:fingerprint] == fingerprint
          return Response.new(status: saved[:status], body: saved[:body],
                              headers: saved[:headers].merge('idempotent-replayed' => 'true', 'x-request-id' => request_id))
        end
        response = dispatch(method, parts, request)
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

      def dispatch(method, parts, request)
        query, json, body = request.values_at(:query, :json, :body)
        data = case parts.first
               when 'projects' then project(method, parts, request)
               when 'assets' then asset(method, parts, query, json, body)
               when 'folders' then folder(method, parts, json)
               when 'hash-lists' then hash_list(method, parts, query, json)
               when 'hash-list-entries' then remove_hash_list_entry(method, parts)
               when 'policies' then policies(method, parts, query, json)
               when 'lenses' then lens(method, parts, json)
               when 'upload-presets' then upload_preset(method, parts)
               else route_not_found!(method, parts)
               end
        data.is_a?(Response) ? data : respond(200, deep_copy(data))
      end

      def deep_copy(value) = JSON.parse(JSON.generate(value))

      def project(method, parts, request)
        fail!(ErrorCodes::API_KEY_PROJECT_MISMATCH) unless parts[1] == @project_id
        query, json = request.values_at(:query, :json)
        case [method, parts[2..]]
        in ['GET', ['events']] then events(query)
        in ['PUT', ['lenses']] then lenses(json.fetch('lenses', []))
        in ['GET', ['lenses']] then page(@state.lenses.values, query, JSON.generate(['lenses', @project_id]))
        in ['POST', ['lenses']] then create_lens(json)
        in ['GET', ['folders']] then folder_page(query)
        in ['POST', ['folders']] then create_folder(json)
        in ['GET', ['hash-lists']] then page(project_hash_lists, query, JSON.generate([@project_id]))
        in ['POST', ['hash-lists']] then create_hash_list(json)
        in ['GET', ['policy']] then show_policy(find_policy(ensure_policies))
        in ['PUT', ['policy']] then show_policy(assign_policy(json))
        in ['GET', ['assets']] then list(query)
        in ['GET', ['assets', 'search']] then search(query)
        in ['GET', ['assets', String => asset_id, 'timeline']] then timeline(asset_id, query)
        in ['POST', ['assets', 'batch']] then batch(json)
        in ['POST', ['signed-asset-urls']] then sign_asset_url(json)
        in ['POST', ['assets']] then create_upload(request)
        else configuration(method, parts, query, json)
        end
      end

      # A project's upload presets, settings and metadata fields.
      def configuration(method, parts, query, json)
        case [method, parts[2..]]
        in ['GET', ['upload-presets']] then upload_preset_page(query)
        in ['PUT', ['upload-presets']] then ensure_upload_presets(json)
        in ['GET', ['settings']] then show_project_settings
        in ['PUT', ['settings']] then update_project_settings(json)
        in ['GET', ['metadata-fields']] then show_metadata_fields
        in ['PUT', ['metadata-fields']] then ensure_metadata_fields(json)
        in ['DELETE', ['metadata-fields', String => field_id]] then delete_metadata_field(field_id, query)
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
        page(RSQL.filter(project_assets, query['filter']), query, JSON.generate([@project_id, query['filter']]))
      end

      # Like the API: one keyset page of a parent's child folders, optionally matching `search`, by
      # `name` ascending unless `sort` (one field, `name` or `createdAt`) says otherwise, with an
      # `id` tie-breaker, and the ancestors of the parent and the listed folders. Names compare by
      # code point, so case matters.
      def folder_page(query)
        found = project_folders.select do |f|
          f['parentId'] == query['parentId'] && (!query['search'] || f['name'].downcase.include?(query['search'].downcase))
        end
        scope = JSON.generate([@project_id, query['parentId'], query['search']])
        result = page(found, query, scope, fields: %w[name createdAt], max: 1, default: { 'field' => 'name', 'direction' => 'asc' })
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

      # Saves lenses in order, like the API: a new identifier creates a lens, an unchanged
      # definition returns the stored lens and a changed one updates it in place.
      def lenses(definitions)
        { 'lenses' => definitions.map { |definition| save_lens(definition) } }
      end

      def save_lens(definition)
        old = @state.lenses[definition['identifier']]
        return new_lens(definition) unless old

        definition = active_by_default(definition)
        same = %w[name type active].all? { |key| old[key] == definition[key] } &&
               old['description'] == definition['description'] && canonical(old['transform']) == canonical(definition['transform'])
        return old if same

        @state.lenses[old['identifier']] = old.merge(definition).merge('updatedAt' => @now.call)
      end

      def new_lens(definition)
        now = @now.call
        lens = { 'id' => @create_id.call('lens'), 'projectId' => @project_id }.merge(active_by_default(definition))
        @state.lenses[definition['identifier']] = lens.merge('createdAt' => now, 'updatedAt' => now)
      end

      # Like the API, a lens is served unless its definition says otherwise.
      def active_by_default(definition) = definition['active'].nil? ? definition.merge('active' => true) : definition

      # POST /projects/:id/lenses: like the API, the identifier must be new to the project.
      def create_lens(json)
        identifier = json['identifier']
        invalid!('validation/invalid-type', 'identifier') unless identifier.is_a?(String) && !identifier.empty?
        fail!(ErrorCodes::LENS_IDENTIFIER_TAKEN, details: { 'identifier' => identifier }) if @state.lenses.key?(identifier)

        # Like the API, a new lens is 201 Created.
        respond(201, deep_copy(new_lens(json)))
      end

      # GET, PATCH and DELETE /lenses/:id. An update keeps the identifier and changes the rest of
      # the definition, as ensuring the changed definition would.
      def lens(method, parts, json)
        item = @state.lenses.values.find { |lens| lens['id'] == parts[1] && lens['projectId'] == @project_id }
        fail!(ErrorCodes::LENS_NOT_FOUND) unless item && parts.size == 2
        case method
        when 'GET' then item
        when 'PATCH' then save_lens(item.merge(json.except('identifier', 'id', 'projectId', 'createdAt', 'updatedAt')))
        when 'DELETE'
          @state.lenses.delete(item['identifier'])
          {}
        else route_not_found!(method, parts)
        end
      end

      def canonical(value)
        case value
        when Hash then value.sort_by { |key, _| key }.to_h { |key, item| [key, canonical(item)] }
        when Array then value.map { |item| canonical(item) }
        else value
        end
      end

      # A page of the project's upload presets, oldest first unless `sort` says otherwise.
      def upload_preset_page(query)
        page(@upload_presets.values, query, JSON.generate(['upload-presets', @project_id]),
             default: { 'field' => 'createdAt', 'direction' => 'asc' })
      end

      # Like the API: every preset's revision and settings are checked before any is saved, and the
      # stored presets come back in the order sent.
      def ensure_upload_presets(json)
        definitions = json['uploadPresets']
        invalid!('validation/too-small', 'uploadPresets') unless definitions.is_a?(Array) && !definitions.empty?

        plans = definitions.each_with_index.map do |definition, index|
          %w[key name].each do |field|
            value = definition[field]
            invalid!('validation/invalid-type', "uploadPresets.#{index}.#{field}") unless value.is_a?(String) && !value.empty?
          end
          existing = @upload_presets[definition['key']]
          stored = existing ? existing['revision'] : 0
          if definition.key?('revision') && definition['revision'] != stored
            fail!(ErrorCodes::UPLOAD_PRESET_REVISION_CONFLICT, details: { 'key' => definition['key'], 'revision' => stored })
          end
          values = upload_preset_values(definition)
          limited = ![nil, 0].include?(values['dailyUploadLimit'])
          fail!(ErrorCodes::UPLOAD_PRESET_DAILY_LIMIT_REQUIRED) if values['access'] == 'anyone' && !limited

          [existing, values]
        end
        { 'uploadPresets' => plans.map { |existing, values| save_upload_preset(existing, values) } }
      end

      # The stored values a definition sets: fields left out take their defaults.
      def upload_preset_values(definition)
        given = ->(field, default = nil) { definition[field].nil? ? default : definition[field] }
        list = ->(field) { definition[field].is_a?(Array) && !definition[field].empty? ? definition[field].uniq : nil }
        { 'key' => definition['key'], 'name' => definition['name'], 'access' => given.call('access', 'token'),
          'enabled' => given.call('enabled', true), 'allowedContentTypes' => list.call('allowedContentTypes'),
          'maxSizeInBytes' => given.call('maxSizeInBytes'), 'folderId' => given.call('folderId'),
          'policyId' => given.call('policyId'), 'visibility' => given.call('visibility', 'private'),
          'processingOptions' => given.call('processingOptions'), 'revealDecision' => given.call('revealDecision', false),
          'dailyUploadLimit' => given.call('dailyUploadLimit'), 'allowedOrigins' => list.call('allowedOrigins') }
      end

      # Saves a preset's values under its key; an unchanged preset keeps its revision.
      def save_upload_preset(existing, values)
        return existing if existing && existing.slice(*values.keys) == values

        now = @now.call
        @upload_presets[values['key']] =
          { 'id' => existing ? existing['id'] : @create_id.call('preset'), 'projectId' => @project_id, 'createdByUserId' => nil,
            **values, 'revision' => (existing ? existing['revision'] : 0) + 1,
            'createdAt' => existing ? existing['createdAt'] : now, 'updatedAt' => now }
      end

      # DELETE /upload-presets/:id.
      def upload_preset(method, parts)
        route_not_found!(method, parts) unless method == 'DELETE' && parts.size == 2
        preset = @upload_presets.values.find { |item| item['id'] == parts[1] }
        fail!(ErrorCodes::UPLOAD_PRESET_NOT_FOUND) unless preset
        @upload_presets.delete(preset['key'])
        {}
      end

      def show_project_settings
        settings = { 'optOutJurisdictions' => [], 'blockUnmoderatedAssets' => true, 'storeSensitiveMetadata' => false,
                     'streamingEnabled' => false, 'aiMediaSearchEnabled' => false, 'remoteUrlRule' => nil,
                     'websiteSubmissionsPerMinute' => nil }.merge(@project_settings)
        settings['humanReview'] = { 'allowedSamplePercent' => 0, 'restrictedSamplePercent' => 0, 'uncertaintyMarginPercent' => 0,
                                    'reviewMissingEvidence' => false }.merge(@project_settings['humanReview'] || {})
        { 'projectId' => @project_id, 'revision' => @settings_revision, 'settings' => settings }
      end

      # A revision to check, from a body or the query; none refuses nothing.
      def check_settings_revision(revision)
        return if revision.nil? || revision.to_s == @settings_revision.to_s

        fail!(ErrorCodes::PROJECT_SETTINGS_REVISION_CONFLICT)
      end

      # Replaces the settings: those left out return to their defaults. A real change bumps the revision.
      def update_project_settings(json)
        check_settings_revision(json['revision'])
        invalid!('validation/invalid-type', 'settings') unless json['settings'].is_a?(Hash)

        before = show_project_settings['settings']
        previous = @project_settings
        @project_settings = json['settings']
        if show_project_settings['settings'] == before
          @project_settings = previous
        else
          @settings_revision += 1
        end
        show_project_settings
      end

      def show_metadata_fields = { 'projectId' => @project_id, 'revision' => @settings_revision, 'fields' => @metadata_fields }

      # Creates or replaces fields by ID, keeping the others in order. A real change bumps the revision.
      def ensure_metadata_fields(json)
        check_settings_revision(json['revision'])
        fields = json['fields']
        invalid!('validation/too-small', 'fields') unless fields.is_a?(Array) && !fields.empty?

        by_id = fields.to_h { |field| [field['id'], field] }
        known = @metadata_fields.map { |field| field['id'] }
        merged = @metadata_fields.map { |field| by_id.fetch(field['id'], field) } + fields.reject { |field| known.include?(field['id']) }
        unless merged == @metadata_fields
          @metadata_fields = merged
          @settings_revision += 1
        end
        show_metadata_fields
      end

      def delete_metadata_field(field_id, query)
        kept = @metadata_fields.reject { |field| field['id'] == field_id }
        fail!(ErrorCodes::METADATA_FIELD_NOT_FOUND, details: { 'fieldId' => field_id }) if kept.size == @metadata_fields.size

        check_settings_revision(query['revision'])
        @metadata_fields = kept
        @settings_revision += 1
        show_metadata_fields
      end

      # Keyword search like the API: every whitespace-separated token (case-insensitive, at most 8
      # distinct) must appear in some field. Results rank by the API's score, then newest first.
      def search(query)
        text = query['query'].to_s.strip
        invalid!('validation/too-small', 'query') if text.empty?
        invalid!('validation/too-big', 'query') if text.length > MAX_SEARCH_QUERY_LENGTH
        limit = check_range(query.fetch('pageSize', 10), 'pageSize', MAX_SEARCH_PAGE_SIZE)
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
        asset = { 'id' => @create_id.call('asset'), 'projectId' => @project_id, 'parentId' => nil, 'parentPages' => [],
                  'folderId' => options['folderId'], 'uploadPresetId' => options['uploadPresetId'],
                  'createdAt' => now, 'updatedAt' => now, 'name' => options['name'], 'description' => options['description'],
                  'externalId' => options['externalId'], 'externalUrl' => url || options['externalUrl'],
                  'type' => kind(mime, url), 'metadata' => options['metadata'] || [], 'authorId' => options['authorId'],
                  # Like the API, only the posts CalmLens uses are kept, and only while the content is held.
                  'context' => context.empty? ? nil : { 'items' => context }, 'tags' => options['tags'] || [],
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
                                # Like the API, moderation's results are null until it decides, and a
                                # feature's result is null until it has run.
                                'moderation' => { 'status' => 'pending', 'manualReviews' => [], 'automatedStatus' => nil,
                                                  'policy' => nil, 'pendingReview' => nil, 'source' => nil, 'rule' => nil,
                                                  'explanationComplete' => nil,
                                                  'categories' => nil, 'flaggedCategories' => [], 'regions' => [],
                                                  'raw' => nil, 'timeline' => nil },
                                'ocr' => nil, 'linkDetection' => nil }
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

      # `POST .../assets` as the API reads it. Asset fields in the query are refused; then the
      # `X-CalmLens-Upload` header picks the body: absent is JSON (text, a first text part or a URL),
      # `content` an upload form with a whole file and `part` one with a first part.
      def create_upload(request)
        query, json, body, upload = request.values_at(:query, :json, :body, :upload)
        in_query = Assets::UPLOAD_OPTION_KEYS.select { |key| query.key?(key) }
        unless in_query.empty?
          fail!(ErrorCodes::UPLOAD_OPTIONS_IN_QUERY, "Send the asset's fields in the request body, not in the query string",
                details: { 'fields' => in_query })
        end
        queue = query['wait'] == false
        return create_from_json(json, queue) if upload.nil?

        route_not_found!('POST', ['assets']) unless %w[content part].include?(upload)

        options, bytes = form_fields(body, request[:content_type])
        fields = options.merge('contentType' => query['contentType'])
        return create_asset(apply_upload_preset(fields, bytes), queue, data: bytes) if upload == 'content'

        start_multipart(apply_upload_preset(fields.merge(query.slice('isFinal', 'totalSizeInBytes')), bytes), bytes, queue)
      end

      # An API-key upload through a preset, as the API applies it: the preset gives the folder and
      # visibility, which the upload can't change, and the processing options unless the upload sets
      # its own, and refuses types and sizes it doesn't accept.
      def apply_upload_preset(fields, data = nil)
        return fields unless fields['uploadPresetId']

        preset = @upload_presets.values.find { |item| item['id'] == fields['uploadPresetId'] }
        fail!(ErrorCodes::UPLOAD_PRESET_NOT_FOUND) unless preset
        fail!(ErrorCodes::UPLOAD_PRESET_DISABLED) unless preset['enabled']
        check_preset_fields(preset, fields)
        check_preset_limits(preset, fields, data)
        fields.merge('folderId' => preset['folderId'] || fields['folderId'], 'visibility' => preset['visibility'],
                     'processingOptions' => fields['processingOptions'] || deep_copy(preset['processingOptions']))
      end

      def check_preset_fields(preset, fields)
        if preset['folderId'] && fields['folderId'] && fields['folderId'] != preset['folderId']
          fail!(ErrorCodes::UPLOAD_PRESET_FIELD_NOT_ALLOWED, details: { 'field' => 'folderId' })
        end
        return unless fields['visibility'] && fields['visibility'] != preset['visibility']

        fail!(ErrorCodes::UPLOAD_PRESET_FIELD_NOT_ALLOWED, details: { 'field' => 'visibility' })
      end

      def check_preset_limits(preset, fields, data)
        allowed = preset['allowedContentTypes']
        type = fields['contentType']
        if allowed && type && allowed.none? { |pattern| preset_accepts?(pattern, fields['name'], type) }
          fail!(ErrorCodes::UNSUPPORTED_UPLOAD_TYPE,
                details: { 'source' => 'preset', 'contentType' => type, 'allowedContentTypes' => allowed })
        end
        limit = preset['maxSizeInBytes']
        size = fields['totalSizeInBytes'] || data&.bytesize
        fail!(ErrorCodes::UPLOAD_TOO_LARGE, details: { 'limitBytes' => limit, 'source' => 'preset' }) if limit && size && size > limit
      end

      # Whether an upload matches one entry of a preset's list, such as `image/*`, `text/plain` or `.pdf`.
      def preset_accepts?(pattern, name, type)
        pattern = pattern.strip.downcase
        return true if ['*', '*/*'].include?(pattern)
        return type.downcase.start_with?(pattern.delete_suffix('*')) if pattern.end_with?('/*')
        return name.to_s.downcase.end_with?(pattern) if pattern.start_with?('.')

        type.downcase == pattern
      end

      # A JSON create: text as `content` or a first `part` (`{ plainText, type }`), or a URL.
      def create_from_json(json, queue)
        key = %w[content part].find { |name| json.key?(name) }
        return create_asset(apply_upload_preset(json), queue, url: json['url']) unless key

        text = json[key]
        invalid!('validation/invalid-type', key) unless text.is_a?(Hash) && text['plainText'].is_a?(String) && text['type'].is_a?(String)
        fields = json.except('content', 'part', 'sizeInBytes', 'totalSizeInBytes').merge('contentType' => text['type'])
        data = text['plainText'].encode(Encoding::UTF_8).b
        return create_asset(apply_upload_preset(fields, data), queue, data: data) if key == 'content'

        part = fields.merge('isFinal' => text['isFinal'] == true, 'totalSizeInBytes' => json['totalSizeInBytes'])
        start_multipart(apply_upload_preset(part, data), data, queue)
      end

      # The asset fields in an upload form's options part, and the file's bytes. Like the API, a raw
      # upload must be `multipart/form-data` (`request/unsupported-content-type`, 415), holding an
      # `options` JSON object of known fields with a name, then a `file` part.
      def form_fields(body, content_type)
        mime = content_type.to_s.split(';').first.to_s.strip.downcase
        unless mime == 'multipart/form-data'
          fail!(ErrorCodes::UNSUPPORTED_CONTENT_TYPE, 'Send a raw upload as multipart/form-data: an options part, then a file part.',
                details: { 'contentType' => mime.empty? ? nil : mime })
        end
        form = FakeAPI.upload_form(body, content_type)
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'The upload form must hold an options part, then a file part') unless form

        options = begin
          JSON.parse(form[0])
        rescue JSON::ParserError
          nil
        end
        unless options.is_a?(Hash)
          fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, "The options part must be a JSON object with the asset's fields")
        end
        unknown = options.keys.find { |name| !Assets::UPLOAD_OPTION_KEYS.include?(name) }
        invalid!('validation/unknown-field', unknown) if unknown
        invalid!('validation/invalid-type', 'name') unless options['name'].is_a?(String)
        [options, form[1]]
      end

      # In the API's order: a declared total, then a single final part as the whole upload, then the
      # part itself. Whether to wait and the declared total are saved with an open upload.
      def start_multipart(fields, data, queue)
        check_upload(fields)
        total = fields['totalSizeInBytes']
        type = kind(fields['contentType'].to_s, nil)
        final = fields['isFinal'] == true
        size = data.to_s.bytesize
        code = (total && image_size_error(type, total, true)) ||
               (final ? total_size_error(total, size, true) || image_size_error(type, size, true) : nil)
        size_failure!(code) if code
        check_part_size(size, final)
        fail!(total_size_error(total, size, false)) if !final && total_size_error(total, size, false)

        asset = create_asset(fields, queue, data: data, open: !final)
        @state.uploads[asset['id']] = { 'queue' => queue, 'total' => total } unless final
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

      # Applies `decision` to `asset` with its report. The mock reads no text, QR codes, people or
      # faces in an image, so a decided image reports that the features its upload ran found nothing:
      # OCR and person and face detection when turned on, link detection unless turned off.
      def decided(asset, decision)
        apply_outcome(asset, decision.status, 'policy', decision.report(@now.call))
        classification = asset['classification']
        return asset unless classification['status'] == 'completed' && asset['type'] == 'image'

        processing = @processing_options[asset['id']]
        features = processing.is_a?(Hash) && processing['features'].is_a?(Hash) ? processing['features'] : {}
        setting = ->(name) { features[name].is_a?(Hash) ? features[name]['enabled'] : nil }
        classification['ocr'] = { 'status' => 'evaluated', 'textRegions' => [] } if setting.call('ocr') == true
        unless setting.call('linkDetection') == false
          classification['linkDetection'] = { 'status' => 'evaluated', 'qrCodes' => [], 'links' => [] }
        end
        { 'personDetection' => 'people', 'faceDetection' => 'faces' }.each do |feature, list|
          classification[feature] = { 'status' => 'evaluated', list => [] } if setting.call(feature) == true
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
      def rendering(asset, processed) = { **rendered_file(asset, processed), 'hls' => nil, 'hlsStatus' => nil }

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

        # Like the API: the request is recorded, and the asset returns as it was. It keeps its decision
        # while it's moderated again under the current policy.
        add_event('type' => 'asset.rerun-requested', 'severity' => 'low', 'assetId' => item['id'],
                  'asset' => snapshot(item), 'actor' => deep_copy(API_KEY_ACTOR),
                  'facts' => [asset_name_fact(item), { 'key' => 'asset-type', 'value' => item['type'] },
                              { 'key' => 'moderation-status', 'value' => moderation['status'] }])
        response = deep_copy(item)
        settle_rerun(item, 'rerun')
        response
      end

      # Applies a re-run's decision to a decided asset like the pipeline: `pending` stays queued for
      # `complete_processing`, `failed` keeps the asset's decision, and any other replaces it with the
      # pipeline's events.
      def settle_rerun(item, trigger, decision = nil)
        decision ||= decision_for(item, trigger, true)
        @reruns.delete(item['id'])
        if decision.status == 'pending'
          @reruns[item['id']] = true
        elsif decision.status != 'failed'
          moderate_stored(item, trigger, decision)
        end
      end

      # Signs an asset URL like the API (`POST /projects/:projectId/signed-asset-urls`): a grant to one
      # asset, by ID or external ID, until it expires, serving the original only when asked. Only the
      # mock's CDN accepts the grant.
      def sign_asset_url(json)
        # Like the API's schema, none of these fields takes null.
        %w[assetId externalId expiresIn original].each do |key|
          invalid!('validation/invalid-type', key) if json.key?(key) && json[key].nil?
        end
        if json.key?('assetId') == json.key?('externalId')
          message = 'Send either assetId or externalId'
          raise Failure.new(ErrorCodes::INVALID_REQUEST, message,
                            details: { 'issues' => [{ 'path' => '', 'message' => message, 'code' => 'custom' }] }, status: 400)
        end
        expires = json.fetch('expiresIn', CDN::DEFAULT_SIGNED_URL_EXPIRES_IN)
        invalid!('validation/invalid-type', 'expiresIn') unless expires.is_a?(Integer) || (expires.is_a?(Float) && expires == expires.floor)
        invalid!('validation/too-small', 'expiresIn') if expires < 1
        invalid!('validation/too-big', 'expiresIn') if expires > CDN::MAX_SIGNED_URL_EXPIRES_IN
        original = json.fetch('original', false)
        invalid!('validation/invalid-type', 'original') unless [true, false].include?(original)

        item = if json.key?('externalId')
                 project_assets.find { |asset| asset['externalId'] == json['externalId'] }
               else
                 own_asset(json['assetId'].to_s)
               end
        fail!(ErrorCodes::ASSET_NOT_FOUND) unless item
        fail!(ErrorCodes::ASSET_HELD) if item['content']['safetyHold']

        expires_at = @now.call + (expires.to_i * 1000)
        { 'url' => "#{@cdn_base_url}/assets/#{Internal.component(@project_id)}/#{MockGrant.encode(item['id'], original, expires_at)}",
          'expiresAt' => expires_at }
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
        # `wait=false` queues the final part; without `wait`, the upload's saved choice applies.
        queue = query.key?('wait') ? query['wait'] == false : upload.fetch('queue', false)
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
      # automatic updates (mode `live`). The mock's presets have one release, version 1, with
      # PRESET_SETTINGS. A stored policy is the API's shape without `projectIds`, with its preset's
      # `id`, `version` and `own`, whether it follows its preset (`followsPreset`) and its reset
      # `baseline`.
      def new_policy(name, settings, description: '', follows_preset: false, preset: nil)
        now = @now.call
        item = { 'id' => @create_id.call('pol'), 'name' => name, 'description' => description, 'settings' => settings,
                 'revision' => 1, 'followsPreset' => follows_preset, 'preset' => preset,
                 'baseline' => deep_copy(settings), 'createdAt' => now, 'updatedAt' => now }
        @policies[item['id']] = item
      end

      # The project's policy, after creating the organisation's own General policy on first use.
      def ensure_policies
        return @project_policy_id if @project_policy_id

        preset = { 'id' => 'general-community', 'version' => 1, 'own' => true }
        @project_policy_id = new_policy(PRESET_NAMES['general-community'], deep_copy(PRESET_SETTINGS),
                                        follows_preset: true, preset: preset)['id']
      end

      # A stored policy as the API shows it: an own preset policy is `live` while it follows its
      # preset and `pinned` otherwise; any other preset policy is a `copy`.
      def show_policy(item)
        shown = item.except('baseline', 'followsPreset')
        if (preset = item['preset'])
          mode = if preset['own'] then item['followsPreset'] ? 'live' : 'pinned'
                 else 'copy'
                 end
          shown['preset'] = { 'id' => preset['id'], 'version' => preset['version'], 'latestVersion' => 1, 'mode' => mode }
        end
        shown.merge('projectIds' => item['id'] == @project_policy_id ? [@project_id] : [])
      end

      def find_policy(id)
        ensure_policies
        @policies[id] || fail!(ErrorCodes::POLICY_NOT_FOUND)
      end

      # `/policies` and `/policies/:id[/action]`, the API key's organisation's policies.
      def policies(method, parts, query, json)
        _, id, *rest = parts
        if id.nil?
          return policy_page(query) if method == 'GET'
          return create_policy(json) if method == 'POST'

          route_not_found!(method, parts)
        end
        policy(method, id, rest, json)
      end

      # A page of the organisation's policies, oldest first unless `sort` says otherwise.
      def policy_page(query)
        ensure_policies
        page(@policies.values.map { |item| show_policy(item) }, query, JSON.generate(['policies', @project_id]),
             default: { 'field' => 'createdAt', 'direction' => 'asc' })
      end

      # Refuses settings the API refuses (MODERATION_POLICY_SETTINGS_SCHEMA): every category, each
      # with an `action` and its `allowances` and `restrictions` lists, and no other category.
      def check_policy_settings(settings)
        categories = settings.is_a?(Hash) ? settings['categorySettings'] : nil
        invalid!('validation/invalid-type', 'settings.categorySettings') unless categories.is_a?(Hash)
        MockClassification::CATEGORIES.each do |category|
          path = "settings.categorySettings.#{category}"
          value = categories[category]
          invalid!('validation/invalid-type', path) unless value.is_a?(Hash)
          %w[allowances restrictions].each { |key| invalid!('validation/invalid-type', "#{path}.#{key}") unless value[key].is_a?(Array) }
          invalid!('validation/invalid-value', "#{path}.action") unless value['action'].is_a?(String)
        end
        unknown = categories.keys.find { |key| !MockClassification::CATEGORIES.include?(key) }
        invalid!('validation/unknown-field', "settings.categorySettings.#{unknown}") if unknown
      end

      def create_policy(json)
        ensure_policies
        name, preset_id, settings = json.values_at('name', 'presetId', 'settings')
        named = name.is_a?(String) && !name.strip.empty?
        if settings.nil? == preset_id.nil? || (preset_id && !PRESET_NAMES.key?(preset_id)) || (preset_id.nil? && !named)
          fail!(ErrorCodes::INVALID_VALUE, 'Send settings with a name, or presetId')
        end
        check_policy_settings(settings) unless preset_id
        description = json['description'].is_a?(String) ? json['description'] : ''
        item = if preset_id
                 origin = { 'id' => preset_id, 'version' => 1, 'own' => false }
                 new_policy(named ? name.strip : PRESET_NAMES[preset_id], deep_copy(PRESET_SETTINGS),
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
        in ['POST', ['reset']] then restore_policy(item, 'reset', json)
        in ['POST', ['upgrade']] then restore_policy(item, 'upgrade', json)
        in ['PUT', ['automatic-updates']] then set_policy_automatic_updates(item, json)
        else route_not_found!(method, ['policies', id, *rest])
        end
      end

      def update_policy(item, json)
        check_policy_settings(json['settings']) if json.key?('settings')
        values = %w[name description].select { |key| json[key].is_a?(String) }
                                     .to_h { |key| [key, key == 'name' ? json[key].strip : json[key]] }
        values['settings'] = json['settings'] if json.key?('settings')
        # Saving a `live` policy pins it.
        save_policy(item, json['revision'], values.merge('followsPreset' => false))
      end

      # Resets a `pinned` or `copy` policy to its preset release, or upgrades it to the latest.
      def restore_policy(item, operation, json)
        preset = item['preset']
        fail!(ErrorCodes::POLICY_NO_PRESET) if preset.nil? || item['followsPreset']
        fail!(ErrorCodes::POLICY_PRESET_VERSION_CONFLICT) unless json['presetVersion'] == preset['version']
        # The mock's presets have one release, so an upgrade never has a newer one to apply.
        fail!(ErrorCodes::POLICY_PRESET_UPDATE_UNAVAILABLE) if operation == 'upgrade'

        save_policy(item, json['revision'], 'settings' => deep_copy(item['baseline']))
      end

      def set_policy_automatic_updates(item, json)
        enabled = json['enabled'] == true
        preset = item['preset']
        fail!(ErrorCodes::POLICY_AUTOMATIC_UPDATES_UNAVAILABLE) if preset.nil? || !preset['own'] || item['followsPreset'] == enabled
        fail!(ErrorCodes::POLICY_REVISION_CONFLICT) unless json['revision'] == item['revision']
        fail!(ErrorCodes::POLICY_PRESET_VERSION_CONFLICT) unless json['presetVersion'] == 1

        values = { 'followsPreset' => enabled }
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
        check_range(query.fetch('pageSize', DEFAULT_PAGE_SIZE), 'pageSize', MAX_PAGE_SIZE)
        fail!(ErrorCodes::ASSET_HELD, details: { 'hold' => 'safety' }) if item['content']['safetyHold']
        fail!(ErrorCodes::INVALID_CURSOR) if query.key?('cursor')

        { 'items' => [], 'nextCursor' => nil, 'hasMore' => false }
      end

      # The page size and sort, refused like the API's query schema: `sort` is comma-separated
      # fields from `fields`, each descending when prefixed with `-`, none repeated and at most `max`
      # (`validation/invalid-value` at `sort` otherwise). Without one, `default` applies.
      def page_query(query, fields = %w[createdAt id], default = { 'field' => 'createdAt', 'direction' => 'desc' }, max: 2)
        size = check_range(query.fetch('pageSize', DEFAULT_PAGE_SIZE), 'pageSize', MAX_PAGE_SIZE)
        [size, query.key?('sort') ? parse_sort(query['sort'], fields, max) : [default.dup]]
      end

      def parse_sort(value, fields, max)
        sort = value.to_s.split(',', -1).map(&:strip).map do |part|
          field = part.delete_prefix('-')
          invalid!('validation/invalid-value', 'sort') unless part.match?(/\A-?[A-Za-z][A-Za-z0-9.]*\z/) && fields.include?(field)
          { 'field' => field, 'direction' => part.start_with?('-') ? 'desc' : 'asc' }
        end
        fields_sent = sort.map { |rule| rule['field'] }
        invalid!('validation/invalid-value', 'sort') if sort.empty? || fields_sent.uniq.size != fields_sent.size || sort.size > max
        sort
      end

      # One keyset page like the API's: sorted by `sort` (`createdAt` descending by default; an `id`
      # tie-breaker is added), starting after the cursor's values. The cursor is tied to `scope` (the
      # filter, folder or parent) and the sort, so it only continues the query it came from.
      def page(items, query, scope, fields: %w[createdAt id], max: 2, default: { 'field' => 'createdAt', 'direction' => 'desc' })
        size, ordering = page_query(query, fields, default, max: max)
        ordering << { 'field' => 'id', 'direction' => ordering.first['direction'] } unless ordering.any? { |o| o['field'] == 'id' }
        signature = JSON.generate([scope, ordering])
        sorted = items.sort { |a, b| compare_items(a, b, ordering) }
        if query['cursor']
          values = cursor_values(query['cursor'], signature, ordering)
          sorted = sorted.select { |item| after_cursor?(item, values, ordering) }
        end
        selected = sorted.first(size)
        more = sorted.size > size
        cursor = ([JSON.generate({ 'scope' => signature, 'values' => ordering.map { |o| selected.last[o['field']] } })].pack('m0') if more)
        { 'items' => selected, 'hasMore' => more, 'nextCursor' => cursor }
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
      def serve(method, relative, headers)
        path, query = relative.split('#', 2).first.split('?', 2)
        raw_segments = path.split('/').reject(&:empty?)
        root, project, _, resource = raw_segments.map { |part| URI.decode_www_form_component(part) }
        selected, options = selector(resource, raw_segments.drop(4))
        return invalid_transform if selected.nil?
        return asset_not_found unless root == 'assets' && project == @project_id && raw_segments[2]

        grant, item = resolve_asset(raw_segments[2])
        return grant if grant.is_a?(Response)
        return asset_not_found unless item && RESOURCES.include?(resource)

        refused = refuse_viewer(item, resource, grant, headers)
        return refused if refused

        params = URI.decode_www_form(query.to_s).to_h
        # A grant authorises a private asset without the API key.
        authorised = !grant.nil? || can_download?(item['folderId'], headers)
        return info(method, item, authorised, params) if resource == 'info'
        return not_available if item['content']['safetyHold']
        return placeholder(method, item) if resource == 'placeholder'

        deliver(method, item, resource, params, selected ? options || {} : nil, authorised)
      end

      # What a grant doesn't cover, or, like the CDN, a private asset for anyone without a grant or the
      # project's API key: it answers as an unknown asset does, whatever its state, except for its
      # public placeholder and its info, which has its own rule. An error response, or nil.
      def refuse_viewer(item, resource, grant, headers)
        if resource == 'original' && grant && !grant[:original]
          return error(ErrorCodes::SIGNED_URL_ORIGINAL_NOT_GRANTED, "This signed asset URL doesn't grant the original file", status: 403)
        end
        return if grant || item['visibility'] == 'public' || header(headers, 'X-Api-Key') == @api_key

        asset_not_found unless %w[placeholder info].include?(resource)
      end

      # Whether the path after the resource selects a lens or transform, and its options; nil when the
      # CDN refuses it. Like the CDN, the adaptive stream's files sit beneath `/hls/` (its master
      # playlist is `/hls/index.m3u8`). Otherwise the selector after the resource is read
      # (AssetTransformParser.ts); the original, the embed page and the info take none.
      def selector(resource, path)
        lens, options = TransformRules.parse_selector(resource == 'hls' ? '' : path.join('/'))
        selected = !(lens || options).nil?
        %w[original embed info].include?(resource) && selected ? nil : [selected, options]
      rescue ArgumentError
        nil
      end

      # Like the CDN (CdnUtils.ts), the asset segment is `ext:` and the URL-encoded external ID, a
      # grant (`sig_…`) or the asset ID. Returns `[grant, asset]`, or an error response for a grant
      # the mock didn't sign or that has expired.
      def resolve_asset(segment)
        if segment.start_with?('sig_')
          grant = MockGrant.decode(segment)
          return error(ErrorCodes::SIGNED_URL_INVALID, "The signed asset URL's grant is invalid", status: 403) unless grant
          return error(ErrorCodes::SIGNED_URL_EXPIRED, 'The signed URL has expired', status: 403) if grant[:expires_at] <= @now.call

          [grant, project_assets.find { |asset| asset['id'] == grant[:asset_id] }]
        elsif segment.start_with?(CDN::EXTERNAL_ID_PREFIX)
          external = MockGrant.percent_decode(segment.delete_prefix(CDN::EXTERNAL_ID_PREFIX))
          [nil, external && !external.empty? ? project_assets.find { |asset| asset['externalId'] == external } : nil]
        else
          id = MockGrant.percent_decode(segment)
          [nil, project_assets.find { |asset| asset['id'] == id }]
        end
      end

      def asset_not_found = error(ErrorCodes::ASSET_NOT_FOUND, 'Asset not found', status: 404)

      # The display info at `/info`, like the CDN's (AssetInfo.ts): the allowlisted fields and whether
      # the viewer the claims describe can see the content, decided as the other resources decide it.
      # A private asset's info needs a grant or an API key with `assets:download`.
      def info(method, item, authorised, params)
        restricted = item['visibility'] != 'public'
        return asset_not_found if restricted && !authorised

        claims = JSON.parse(params.fetch('viewerClaims', '{}'))
        body = { 'id' => item['id'], 'projectId' => item['projectId'], 'type' => item['type'], 'externalUrl' => item['externalUrl'],
                 'content' => item['content'].slice(*%w[format width height durationSeconds pageCount rendered preview hls]),
                 'availability' => availability(item, claims.is_a?(Hash) && claims['ageConfirmed'] == true) }
        cdn_response(method, JSON.generate(body), { 'content-type' => 'application/json',
                                                    'cache-control' => "#{restricted ? 'private' : 'public'}, max-age=60",
                                                    'cache-tag' => "asset-#{item['id']}" })
      rescue JSON::ParserError
        error(ErrorCodes::INVALID_VIEWER_CLAIMS, 'Invalid viewer claims', status: 400)
      end

      # Whether a viewer can see an asset's content now, decided as the other resources decide it.
      def availability(item, age_confirmed)
        moderation = item['classification']['moderation']['status']
        if item['content']['safetyHold'] || item['upload']['status'] == 'uploading' || %w[blocked purged].include?(moderation) ||
           item['classification']['status'] == 'failed' || item['content']['status'] == 'removed'
          'unavailable'
        elsif moderation == 'age-restricted' && !age_confirmed
          'age-restricted'
        else
          'available'
        end
      end

      # Serves a found asset's resource after the delivery, age and access checks, then whether it
      # has the resource and takes the selector, then the transform options' schema check.
      # `selector` is the selector's options (empty for a lens alone), or nil without one.
      def deliver(method, item, resource, params, selector, authorised)
        stored = @state.content[item['id']]
        refused = refuse_delivery(item, resource, stored, params, authorised)
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
      def refuse_delivery(item, resource, stored, params, authorised)
        moderation = item['classification']['moderation']['status']
        if (resource == 'original' && stored.nil?) || item['upload']['status'] == 'uploading' ||
           %w[blocked purged].include?(moderation) || item['classification']['status'] == 'failed' ||
           item['content']['status'] == 'removed'
          return not_available
        end
        if moderation == 'age-restricted' && !viewer_age_confirmed?(params)
          return error('viewer/age-confirmation-required', 'Age confirmation required', status: 403)
        end
        return if item['visibility'] == 'public' || authorised

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

      # Whether the request carries the mock API key and its grants give `assets:download` for
      # `folder_id`.
      def can_download?(folder_id, headers)
        return false unless header(headers, 'X-Api-Key') == @api_key

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

    # The mock's grant, the asset segment of a URL {CDN#sign_asset_url} signs on the mock: `sig_` and
    # the lowercase hex of the UTF-8 text `{assetId}.{1|0}.{expiresAt}`, its asset, original access and
    # expiry. Every SDK's mock writes it the same way. It is readable, not signed, as the mock has no
    # secret to keep.
    # @api private
    module MockGrant
      module_function

      def encode(asset_id, original, expires_at)
        "sig_#{"#{asset_id}.#{original ? 1 : 0}.#{expires_at}".unpack1('H*')}"
      end

      # `{asset_id:, original:, expires_at:}`, or nil for a segment the mock didn't sign.
      def decode(segment)
        hex = segment.delete_prefix('sig_')
        return unless hex.match?(/\A(?:[0-9a-f]{2})+\z/)

        text = [hex].pack('H*').force_encoding(Encoding::UTF_8)
        match = text.valid_encoding? && /\A(.+)\.([01])\.(\d+)\z/m.match(text)
        match && { asset_id: match[1], original: match[2] == '1', expires_at: Integer(match[3], 10) }
      end

      # Percent-decodes a path segment like decodeURIComponent; nil when it isn't valid UTF-8.
      def percent_decode(text)
        decoded = text.b.gsub(/%(\h\h)/) { Regexp.last_match(1).hex.chr }.force_encoding(Encoding::UTF_8)
        decoded if decoded.valid_encoding?
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
