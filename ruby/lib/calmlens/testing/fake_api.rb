# frozen_string_literal: true

require 'json'
require 'securerandom'
require 'uri'

module CalmLens
  module Testing
    # Raised inside the fake API to answer with a CalmLens error response.
    # @api private
    class Failure < StandardError
      attr_reader :code

      def initialize(code, message = nil)
        super(message || code)
        @code = code
      end
    end

    # In-memory records behind {MockServerClient}. Change them to arrange a test, such as setting an
    # asset's `classification.moderation.decision`.
    #
    # @!attribute assets [Hash{String => Hash}] assets by ID, with API field names.
    # @!attribute folders [Hash{String => Hash}] folders by ID.
    # @!attribute content [Hash{String => Hash}] stored bytes by asset ID: `{'type', 'parts' => {n => bytes}}`.
    # @!attribute events [Array<Hash>] the events feed, oldest first.
    # @!attribute lenses [Hash{String => Hash}] lenses by identifier.
    State = Struct.new(:assets, :folders, :content, :events, :lenses, :uploads, :idempotency, keyword_init: true)

    # A stateful stand-in for the CalmLens API and CDN. It stores assets and folders, applies
    # filters and ordering, serves stored bytes, and answers errors with the API's codes, statuses
    # and body shape. It does not classify content, run transforms or index for semantic search.
    # @api private
    class FakeAPI
      JSON_QUERY = %w[queue isFinal sizeInBytes totalSizeInBytes partNumber pageSize pageIndex searchAll resolveOnly limit
                      processingOptions metadata].freeze
      # Search match fields and where each one's value sits in the asset.
      SEARCH_FIELDS = { 'name' => %w[name], 'id' => %w[id], 'externalId' => %w[externalId],
                        'description' => %w[description], 'tags' => %w[tags], 'type' => %w[type],
                        'status' => %w[classification moderation decision] }.freeze
      MIN_MULTIPART_IMAGE = 10 * 1024 * 1024
      MAX_MULTIPART_IMAGE = 20 * 1024 * 1024

      attr_reader :state

      def initialize(project_id:, base_url:, cdn_base_url:, now:, create_id:, queued_outcome:, analyzed_outcome:)
        @project_id = project_id
        @base_url = base_url
        @cdn_base_url = cdn_base_url
        @now = now
        @create_id = create_id
        @queued_outcome = queued_outcome
        @analyzed_outcome = analyzed_outcome
        @state = State.new(assets: {}, folders: {}, content: {}, events: [], lenses: {}, uploads: {}, idempotency: {})
        @event_sequence = 0
      end

      # Adds an event to the feed, filling the fields the API always sets.
      def add_event(event)
        @event_sequence += 1
        time = @now.call
        record = { 'id' => @create_id.call, 'projectId' => @project_id, 'severity' => 'low', 'facts' => [],
                   'createdAt' => time, 'updatedAt' => time }.merge(event)
        record['title'] ||= record['type']
        @state.events << record.merge('_sequence' => @event_sequence)
        record
      end

      # @return [Response]
      def handle(method, url, headers, body)
        if url.start_with?("#{@cdn_base_url}/")
          serve(method, url.delete_prefix(@cdn_base_url))
        else
          api(method, url.delete_prefix(@base_url), headers, body)
        end
      rescue Failure => e
        error(e.code, e.message)
      end

      private

      def respond(status, data, headers = {})
        Response.new(status: status, body: data.nil? ? '' : JSON.generate(data),
                     headers: { 'content-type' => 'application/json', 'x-request-id' => request_id }.merge(headers))
      end

      def request_id = "mock-#{SecureRandom.hex(8)}"

      def error(code, message)
        respond(ErrorCodes::STATUSES.fetch(code, 400), { 'code' => code, 'message' => message })
      end

      def fail!(code, message = nil) = raise(Failure.new(code, message))

      def api(method, relative, headers, body)
        uri = URI.parse(relative)
        parts = uri.path.split('/').reject(&:empty?).map { |part| URI.decode_www_form_component(part) }
        query = URI.decode_www_form(uri.query.to_s).to_h.to_h { |key, value| [key, query_value(key, value)] }
        selected_ids = query.keys.grep(/\Aids\[\d+\]\z/).sort_by { |key| key[/\d+/].to_i }
        query['ids'] = selected_ids.map { |key| query.delete(key) } unless selected_ids.empty?
        json = headers['Content-Type'] == 'application/json' && body ? JSON.parse(body) : {}
        key = headers['Idempotency-Key']
        upload = headers.find { |name, _| name.to_s.casecmp?('X-CalmLens-Upload') }&.last
        return dispatch(method, parts, query, json, body, upload) unless key && method == 'POST'

        # Like the API: a successful response is saved and replayed for the same key and request.
        fingerprint = [method, relative, headers['Content-Type'], body&.bytesize]
        saved = @state.idempotency[key]
        if saved
          fail!(ErrorCodes::IDEMPOTENCY_KEY_REUSED) unless saved[:fingerprint] == fingerprint
          return Response.new(status: saved[:status], body: saved[:body],
                              headers: saved[:headers].merge('idempotent-replayed' => 'true', 'x-request-id' => request_id))
        end
        response = dispatch(method, parts, query, json, body, upload)
        @state.idempotency[key] = { fingerprint: fingerprint, status: response.status, body: response.body,
                                    headers: response.headers }
        response
      end

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
        in ['GET', ['assets', 'page'], _] then page(project_assets.reject { |item| item['parentId'] }, query)
        in ['GET', ['assets', 'search'], _] then search(query)
        in ['POST', ['assets'], nil] then create_asset(json, query['queue'] == true, url: json['url'])
        in ['POST', ['assets'], 'content'] then create_asset(query, query['queue'] == true, data: body)
        in ['POST', ['assets'], 'part'] then start_multipart(query, body)
        else fail!(ErrorCodes::ASSET_NOT_FOUND, 'Not found')
        end
      end

      def project_assets = @state.assets.values.select { |item| item['projectId'] == @project_id }

      def folder_page(query)
        found = project_folders.select do |f|
          in_scope = (query['searchAll'] && query['search']) || f['parentId'] == query['parentId']
          in_scope && (!query['search'] || f['name'].downcase.include?(query['search'].downcase))
        end
        found.sort_by! { |f| [query['sort'] == 'createdAt' ? f['createdAt'] : f['name'], f['id']] }
        found.reverse! if query['direction'] == 'DESC'
        size = query.fetch('pageSize', 100)
        start = query.fetch('pageIndex', 0) * size
        page = query['resolveOnly'] ? [] : found.slice(start, size) || []
        ids = (Array(query['ids']) + page.map { |f| f['id'] } + [query['parentId']]).compact.uniq
        queue = ids.dup
        until queue.empty?
          parent = @state.folders.dig(queue.pop, 'parentId')
          if parent && !ids.include?(parent)
            ids << parent
            queue << parent
          end
        end
        { 'folders' => page, 'ancestors' => project_folders.select do |f|
          ids.include?(f['id']) && !page.include?(f)
        end, 'hasMore' => !query['resolveOnly'] && found.length > start + size }
      end

      def project_folders = @state.folders.values.select { |item| item['projectId'] == @project_id }

      def events(query)
        # Without a cursor the feed starts from now, like the API.
        return { 'events' => [], 'cursor' => "mock_#{@event_sequence}", 'hasMore' => false } unless query.key?('after')

        match = query['after'].to_s.match(/\Amock_(\d+)\z/)
        fail!(ErrorCodes::INVALID_EVENT_CURSOR) unless match

        sequence = Integer(match[1], 10)
        limit = query.fetch('limit', 50)
        later = @state.events.select { |event| event['_sequence'] > sequence }
        taken = later.first(limit)
        cursor = taken.empty? ? sequence : taken.last['_sequence']
        { 'events' => taken.map { |event| event.except('_sequence') }, 'cursor' => "mock_#{cursor}",
          'hasMore' => later.size > taken.size }
      end

      def lenses(definitions)
        now = @now.call
        pending = deep_copy(@state.lenses)
        saved = definitions.map do |definition|
          old = pending[definition['identifier']]
          same = old && %w[name description type active transforms version].all? { |key| old[key] == definition[key] }
          fail!(ErrorCodes::LENS_VERSION_CONFLICT) if old && !same && definition['version'].to_i <= old['version'].to_i

          lens = if same
                   old
                 else
                   definition.merge('id' => old ? old['id'] : @create_id.call, 'projectId' => @project_id,
                                    'createdAt' => old ? old['createdAt'] : now, 'updatedAt' => now)
                 end
          pending[lens['identifier']] = lens
        end
        @state.lenses = pending
        { 'lenses' => saved }
      end

      def search(query)
        text = query['query'].to_s.strip.downcase
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD, 'query is required') if text.empty?

        items = project_assets.filter_map do |item|
          fields = SEARCH_FIELDS.filter_map do |field, path|
            field if Array(item.dig(*path)).any? { |value| value.to_s.downcase.include?(text) }
          end
          { 'asset' => item, 'score' => 1.0, 'matchedFields' => fields } unless fields.empty?
        end
        { 'query' => query['query'], 'items' => items.first(query.fetch('limit', 10)), 'semanticStatus' => 'disabled' }
      end

      def kind(mime, url)
        return 'website' if url
        return mime.split('/').first if mime.start_with?('image/', 'video/', 'audio/')
        return 'plaintext-document' if mime.start_with?('text/')
        return 'multimedia-document' if mime.include?('pdf') || mime.include?('document')

        'file'
      end

      def create_asset(options, queue, url: nil, data: nil, open: false)
        if options['externalId'] && project_assets.any? { |item| item['externalId'] == options['externalId'] }
          fail!(ErrorCodes::DUPLICATE_EXTERNAL_ID)
        end
        check_folder(options['folderId']) if options['folderId']
        now = @now.call
        mime = options['contentType'].to_s
        asset = options.slice('name', 'description', 'metadata', 'externalId', 'externalUrl', 'processingOptions')
        keep = options['processingOptions'].is_a?(Hash) && options['processingOptions']['keepContentAfterProcessing'] == true
        asset.merge!('id' => @create_id.call, 'projectId' => @project_id, 'folderId' => options['folderId'],
                     'parentId' => nil, 'type' => kind(mime, url), 'visibility' => options.fetch('visibility', 'private'),
                     'createdAt' => now, 'updatedAt' => now,
                     **AssetRecord.sections(now: now, open: open, keep: keep, format: mime, size: data&.bytesize))
        asset['externalUrl'] = url if url
        @state.assets[asset['id']] = asset
        @state.content[asset['id']] = { 'type' => mime, 'parts' => { 1 => data } } if data
        open ? asset : finish(asset, queue)
      end

      # The queue mode and declared total are saved with the upload and apply to its final part.
      def start_multipart(query, data)
        total = query['totalSizeInBytes']
        if query['contentType'].to_s.start_with?('image/') && [total, data.bytesize].compact.max > MAX_MULTIPART_IMAGE
          fail!(ErrorCodes::MULTIPART_IMAGE_TOO_LARGE)
        end

        asset = create_asset(query, query['queue'] == true, data: data, open: true)
        upload = { 'queue' => query['queue'] == true, 'total' => total }
        return complete(asset, upload, nil) if query['isFinal']

        @state.uploads[asset['id']] = upload
        asset
      end

      # Applies queue mode: queued assets get `queued_outcome`; others `analyzed_outcome` now.
      def finish(asset, queue)
        return apply_outcome(asset, @queued_outcome) if queue

        decision = @analyzed_outcome.respond_to?(:call) ? @analyzed_outcome.call(deep_copy(asset)) : @analyzed_outcome
        return apply_outcome(asset, decision) unless decision.is_a?(Hash)

        fields = deep_copy(decision)
        AssetRecord.deep_merge!(apply_outcome(asset, AssetRecord.outcome_of(fields)), fields)
      end

      # Moves an asset to an outcome like the pipeline would: a decision finishes processing, and
      # finished processing removes content kept only temporarily.
      def apply_outcome(asset, outcome)
        processing, moderation = AssetRecord.statuses(outcome)
        now = @now.call
        asset['classification'].merge!('status' => processing, 'updatedAt' => now, 'completedAt' => processing == 'completed' ? now : nil)
        asset['upload'].merge!('status' => 'completed', 'updatedAt' => now)
        asset['classification']['moderation'].merge!('decision' => moderation)
        remove_content(asset, 'retention', now) if processing == 'completed' && asset['content']['status'] == 'temporary'
        asset['updatedAt'] = now
        asset
      end

      def remove_content(asset, reason, now)
        @state.content.delete(asset['id'])
        asset['content'].merge!('status' => 'removed', 'removalReason' => reason, 'updatedAt' => now,
                                'extractedText' => nil)
      end

      def complete(asset, upload, queue_override)
        size = asset.dig('content', 'sizeInBytes').to_i
        fail!(ErrorCodes::UPLOAD_SIZE_MISMATCH) if upload['total'] && upload['total'] != size
        fail!(ErrorCodes::MULTIPART_IMAGE_TOO_SMALL) if (asset['type'] == 'image') && (size < MIN_MULTIPART_IMAGE)
        finish(asset, queue_override.nil? ? upload['queue'] : queue_override == true)
      end

      def asset(method, parts, query, json, body)
        id = parts[1]
        item = @state.assets[id]
        fail!(ErrorCodes::ASSET_NOT_FOUND) unless item && item['projectId'] == @project_id
        case [method, parts[2]]
        in ['GET', nil] then item
        in ['PATCH', nil] then touch(item.merge!(json.except('id', 'projectId', 'upload', 'classification', 'content')))
        in ['DELETE', nil]
          @state.assets.delete(id)
          @state.content.delete(id)
          {}
        in ['DELETE', 'content']
          remove_content(item, 'requested', @now.call) unless item['content']['status'] == 'removed'
          touch(item)
        in ['GET', 'children'] then page(project_assets.select { |child| child['parentId'] == id }, query)
        in ['POST', 'retry']
          fail!(ErrorCodes::ASSET_NOT_RETRYABLE) unless item['classification']['status'] == 'failed'
          fail!(ErrorCodes::ASSET_CONTENT_UNAVAILABLE) if item['content']['status'] == 'removed'
          # Like the API: back to processing, to be moderated again.
          apply_outcome(item, 'pending')
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

      def signed_url(id, json)
        expires = json.fetch('expiresInSeconds', 900)
        params = URI.encode_www_form(json.slice('lens', 'transform').merge('expires' => expires))
        { 'url' => "#{@cdn_base_url}/signed/#{URI.encode_www_form_component(id)}/#{json.fetch('resource', 'content')}?#{params}",
          'expiresAt' => @now.call + (expires * 1000) }
      end

      def part(item, query, body)
        upload = @state.uploads[item['id']]
        fail!(ErrorCodes::UPLOAD_NOT_OPEN) unless upload && item['upload']['status'] == 'uploading'
        number = query['partNumber']
        fail!(ErrorCodes::INVALID_UPLOAD_PART_NUMBER) unless number.is_a?(Integer) && number >= 2

        stored = (@state.content[item['id']] ||= { 'type' => '', 'parts' => {} })
        stored['parts'][number] = body.to_s
        size = stored['parts'].values.sum(&:bytesize)
        fail!(ErrorCodes::MULTIPART_IMAGE_TOO_LARGE) if item['type'] == 'image' && size > MAX_MULTIPART_IMAGE
        item['content']['sizeInBytes'] = size
        item['upload']['partsReceived'] = number
        return touch(item) unless query['isFinal']

        @state.uploads.delete(item['id'])
        complete(item, upload, query['queue'])
      end

      def folder(method, parts, json)
        id = parts[1]
        item = check_folder(id)
        case [method, parts[2]]
        in ['GET', nil] then item
        in ['PATCH', nil]
          unique_name(json['name'], item['parentId'], id) if json.key?('name')
          touch(item.merge!(json.slice('name')))
        in ['POST', 'move'] then move_folder(item, json['parentId'])
        in ['DELETE', nil]
          if project_assets.any? { |asset| asset['folderId'] == id } || project_folders.any? { |other| other['parentId'] == id }
            fail!(ErrorCodes::FOLDER_NOT_EMPTY)
          end

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

        fail!(ErrorCodes::DUPLICATE_FOLDER_NAME)
      end

      def create_folder(json)
        check_folder(json['parentId']) if json['parentId']
        unique_name(json['name'], json['parentId'])
        now = @now.call
        item = json.slice('name').merge('id' => @create_id.call, 'projectId' => @project_id,
                                        'parentId' => json['parentId'], 'createdAt' => now, 'updatedAt' => now)
        @state.folders[item['id']] = item
      end

      def move_folder(item, parent_id)
        current = parent_id
        visited = [item['id']]
        while current
          fail!(ErrorCodes::FOLDER_PARENT_CYCLE) if visited.include?(current)

          visited << current
          current = check_folder(current)['parentId']
        end
        unique_name(item['name'], parent_id, item['id'])
        touch(item.merge!('parentId' => parent_id))
      end

      def page(items, query)
        size = query.fetch('pageSize', 10)
        ordering = ordering(query)
        fail!(ErrorCodes::INVALID_UPLOAD_PAYLOAD) if ordering.any? { |o| !%w[createdAt id].include?(o['field']) }
        ordering << { 'field' => 'id', 'direction' => ordering.first['direction'] } unless ordering.any? { |o| o['field'] == 'id' }
        matched = RSQL.filter(items, query['filter'])
        sorted = matched.sort { |a, b| compare(a, b, ordering) }
        if query['cursor']
          begin
            boundary = JSON.parse(query['cursor'].unpack1('m0'))
            valid = boundary.is_a?(Hash) && ordering.all? do |o|
              o['field'] == 'id' ? boundary[o['field']].is_a?(String) : boundary[o['field']].is_a?(Numeric)
            end
            fail!(ErrorCodes::INVALID_CURSOR) unless valid
          rescue ArgumentError, JSON::ParserError
            fail!(ErrorCodes::INVALID_CURSOR)
          end
          sorted = sorted.select { |item| compare(item, boundary, ordering).positive? }
        end
        selected = sorted.first(size)
        more = sorted.size > size
        cursor = more ? [JSON.generate(selected.last.slice(*ordering.map { |o| o['field'] }))].pack('m0') : nil
        { 'items' => selected, 'nextCursor' => cursor,
          'pageSize' => size, 'ordering' => ordering, 'hasMore' => more }
      end

      def ordering(query)
        entries = query.keys.filter_map { |key| key.match(/\Aordering\[(\d+)\]\[(field|direction)\]\z/) }
        return [{ 'field' => 'createdAt', 'direction' => 'DESC' }] if entries.empty?

        entries.group_by { |match| Integer(match[1], 10) }.sort.map do |_, matches|
          matches.to_h { |match| [match[2], query[match[0]]] }
        end
      end

      def compare(left, right, ordering)
        ordering.each do |order|
          a = left[order['field']]
          b = right[order['field']]
          # Missing values sort last in either direction.
          result = if a.nil? || b.nil? then (a.nil? ? 1 : 0) - (b.nil? ? 1 : 0)
                   else
                     natural = (a <=> b) || (a.to_s <=> b.to_s)
                     order['direction'].to_s.casecmp?('DESC') ? -natural : natural
                   end
          return result unless result.zero?
        end
        left['id'].to_s <=> right['id'].to_s
      end

      def serve(method, relative)
        segments = relative.split(/[?#]/, 2).first.split('/').reject(&:empty?).map { |part| URI.decode_www_form_component(part) }
        _, project, identifier, resource = segments
        return text(404, 'Asset not found') unless project == @project_id

        item = project_assets.find { |asset| asset['id'] == identifier || asset['externalId'] == identifier }
        return text(404, 'Asset not found') unless item && %w[content preview].include?(resource)
        return text(403, 'Asset is held') if item['classification']['moderation'].values_at('decision', 'action') == %w[rejected hide]

        stored = @state.content[item['id']]
        return text(404, 'Asset content not found') unless stored

        bytes = stored['parts'].sort.map(&:last).join.b
        Response.new(status: 200, body: method == 'HEAD' ? '' : bytes,
                     headers: { 'content-type' => stored['type'], 'content-length' => bytes.bytesize.to_s,
                                'x-request-id' => request_id })
      end

      def text(status, message)
        Response.new(status: status, body: message,
                     headers: { 'content-type' => 'text/plain; charset=utf-8', 'x-request-id' => request_id })
      end
    end

    # The nested state of a new mock asset, and merging test fields into it.
    # @api private
    module AssetRecord
      module_function

      # Processing and moderation status for each outcome.
      OUTCOMES = { 'pending' => %w[processing pending], 'approved' => %w[completed approved],
                   'rejected' => %w[completed rejected], 'failed' => %w[failed pending] }.freeze

      def statuses(outcome)
        OUTCOMES.fetch(outcome) do
          raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT,
                                         "MockServerClient outcomes are #{OUTCOMES.keys.join(', ')} (got #{outcome.inspect})")
        end
      end

      # The outcome of analyzed fields: `failed` when they fail processing, else their moderation status.
      def outcome_of(fields)
        fields.dig('classification', 'status') == 'failed' ? 'failed' : fields.dig('classification', 'moderation', 'decision') || 'approved'
      end

      def sections(now:, open:, keep:, format:, size:)
        {
          'upload' => { 'status' => open ? 'uploading' : 'completed', 'updatedAt' => now, 'partsReceived' => open ? 1 : nil },
          'classification' => { 'status' => open ? 'pending' : 'processing', 'updatedAt' => now, 'completedAt' => nil,
                                'moderation' => { 'decision' => 'pending', 'action' => nil, 'reviewerAction' => nil,
                                                  'reviewerNote' => nil, 'reviewerUserId' => nil, 'reviewedAt' => nil } },
          'content' => { 'status' => keep ? 'stored' : 'temporary', 'removalReason' => nil, 'updatedAt' => now,
                         'safetyHold' => nil, 'format' => format.empty? ? nil : format, 'extension' => nil,
                         'sizeInBytes' => size, 'checksums' => nil, 'image' => nil, 'previewImage' => nil,
                         'extractedText' => nil }
        }
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

    # The RSQL subset the fake API understands: `field==value` and `field!=value` (with `*`
    # wildcards and quoted values), combined with `;` (and) and `,` (or). Anything else raises
    # instead of being ignored, so a test never passes on an unfiltered list.
    # @api private
    module RSQL
      module_function

      def filter(items, expression)
        return items if expression.nil? || expression.to_s.strip.empty?

        groups = split(expression.to_s, ',').map { |group| split(group, ';').map { |term| comparison(term) } }
        items.select { |item| groups.any? { |terms| terms.all? { |test| test.call(item) } } }
      end

      def split(text, separator)
        parts = ['']
        quote = nil
        text.each_char do |char|
          if quote
            quote = nil if char == quote
          elsif ['"', "'"].include?(char)
            quote = char
          elsif char == separator
            parts << ''
            next
          end
          parts[-1] += char
        end
        parts
      end

      def comparison(term)
        match = term.strip.match(/\A([A-Za-z][\w.]*)(==|!=)(.+)\z/m)
        unless match
          raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT,
                                         "MockServerClient filters support only ==, != with ; and , (got #{term.inspect})")
        end

        field, operator, raw = match.captures
        value = raw.strip.match?(/\A(["']).*\1\z/m) ? raw.strip[1..-2] : raw.strip
        pattern = Regexp.new("\\A#{Regexp.escape(value).gsub('\*', '.*')}\\z", Regexp::MULTILINE)
        lambda do |item|
          actual = field.split('.').reduce(item) { |object, key| object.is_a?(Hash) ? object[key] : nil }
          equal = Array(actual.nil? ? 'null' : actual).any? { |entry| pattern.match?(entry.to_s) }
          operator == '==' ? equal : !equal
        end
      end
    end
  end
end
