# frozen_string_literal: true

# Calmthread: a pre-moderated discussion thread demonstrating the CalmLens Ruby SDK.
# Clean replies publish at once. Anything the project policy flags is held, with its
# content retained, until a person reviews it in the CalmLens portal.
require 'calmlens'
require 'erb'
require 'json'
require 'openssl'
require 'optparse'
require 'securerandom'
require 'uri'
require 'webrick'

module Calmthread
  MAX_NAME = 40
  MAX_TEXT = 1000
  MAX_FORM_BYTES = 16 * 1024
  MAX_WEBHOOK_BYTES = 1024 * 1024
  MAX_REPLIES = 100
  MAX_ACTIVITY = 50
  EVENT_PAGE_SIZE = 50
  MAX_EVENT_PAGES = 5
  DEFAULT_HOST = '127.0.0.1'
  DEFAULT_PORT = 6403

  # Sent with every field of every reply. `hide` overrides the project's action for a flagged
  # field: the asset is rejected and CDN delivery is blocked. Content is kept after processing so
  # a reviewer can read a held reply; the app deletes it once the reply is rejected.
  PROCESSING_OPTIONS = { keep_content_after_processing: true, flagged_content_policy: { action: 'hide' } }.freeze

  DEMO_RESULTS = {
    'clean' => 'Clean: publish immediately',
    'held' => 'Flagged: hold the reply for review',
    'name-held' => 'Flagged display name: hold for review',
    'error' => 'Processing error',
    'unavailable' => 'CalmLens unavailable'
  }.freeze

  # Each reply field becomes its own text asset, moderated in this order.
  FIELDS = { name: 'Calmthread display name', text: 'Calmthread reply' }.freeze
  FIELD_LABELS = { name: 'display name', text: 'reply' }.freeze

  # Registered fact keys and labels from packages/shared/src/EventCatalog.ts that
  # this app shows. Other keys (such as the hidden reviewer-user-id) are not shown.
  FACT_LABELS = {
    'asset-name' => 'Asset',
    'asset-type' => 'Asset type',
    'reviewer-name' => 'Reviewer',
    'note' => 'Note'
  }.freeze
  # Only reviewer decisions change a reply: `asset.approved` and `asset.rejected` events whose
  # `decided-by` fact is `reviewer`. Automated outcomes (`decided-by` `automated`) and other
  # asset events are skipped, since the app already acted on the automated report at upload.
  EVENT_LABELS = {
    'asset.approved' => 'Approved by a reviewer',
    'asset.rejected' => 'Rejected by a reviewer'
  }.freeze

  # A form value the app refuses. Its message is written by this app, never taken from input
  # or from a library error, so it is safe to show.
  class InputError < StandardError; end

  # Moderates replies with the live SDK client. Demo mode (demo.rb) swaps in a subclass.
  class Moderator
    attr_reader :client

    # Credentials are required: a missing key never falls back to demo mode.
    def initialize(api_key: '', project_id: '', base_url: '', client: nil)
      if client.nil? && (api_key.to_s.empty? || project_id.to_s.empty?)
        raise ArgumentError, 'Set CALMLENS_API_KEY and CALMLENS_PROJECT_ID, or CALMLENS_DEMO=1 for demo mode'
      end

      @client = client || CalmLens::ServerClient.new(api_key: api_key, project_id: project_id, timeout: 30,
                                               **(base_url.to_s.empty? ? {} : { base_url: base_url }))
    end

    def demo? = false

    # Moderates each field in order with the per-asset hold policy. It stops at the first
    # field that neither passed nor was held, so a failed name never sends the reply text.
    # A held name still sends the text, so the reviewer sees the whole reply. The external ID
    # ties each asset back to its reply and field.
    def moderate_reply(reply_id, fields, _demo_result = nil)
      FIELDS.each_with_object({}) do |(field, asset_name), assets|
        asset = client_for(reply_id).text.moderate(
          name: asset_name,
          external_id: Calmthread.external_id(reply_id, field),
          processing_options: PROCESSING_OPTIONS,
          text: fields.fetch(field)
        )
        assets[field] = asset
        break assets if Calmthread.decision(asset) == :failed
      end
    end

    private

    def client_for(_reply_id) = @client
  end

  def self.external_id(reply_id, field) = "#{reply_id}:#{field}"

  # The asset's `moderation` or `processing` object, or {} when the response has none.
  def self.section(asset, key) = asset.is_a?(Hash) && asset[key].is_a?(Hash) ? asset[key] : {}

  def self.status(asset) = section(asset, 'moderation')['status']
  def self.processing_failed?(asset) = section(asset, 'processing')['status'] == 'failed'
  # Flagged means the policy took an action (alert, hide or purge) on the field.
  def self.flagged?(asset) = !section(asset, 'moderation')['action'].nil?

  # :clean publishes, :held waits for a reviewer, :failed never publishes.
  # An approved but flagged field is held too: only an unflagged approval is clean.
  def self.decision(asset)
    return :failed unless asset.is_a?(Hash) && asset['id'].is_a?(String) && !asset['id'].empty?
    return :failed if processing_failed?(asset)

    case status(asset)
    when 'approved' then flagged?(asset) ? :held : :clean
    when 'rejected' then :held
    else :failed
    end
  end

  # The current status of a retrieved asset, or nil when the response is not that asset of
  # that reply. A returned external ID must name the same reply and field.
  def self.current_status(asset, asset_id, reply = nil)
    return nil unless asset.is_a?(Hash) && asset['id'] == asset_id

    if reply && asset.key?('externalId')
      field = reply[:asset_ids].key(asset_id)
      return nil unless asset['externalId'] == external_id(reply[:id], field)
    end
    status(asset)
  end

  # The in-memory thread: published replies and replies held for review.
  class Discussion
    attr_reader :moderator

    def initialize(moderator)
      @moderator = moderator
      @replies = []
      @activity = []
      @lock = Mutex.new
    end

    # Returns :published, :held or :failed. Raises InputError for an invalid form.
    def submit(name, text, demo_result = 'clean')
      name = name.to_s.strip
      text = text.to_s.strip
      if name.empty? || name.length > MAX_NAME || name.match?(/[[:cntrl:]]/)
        raise InputError, "Choose a display name of 1 to #{MAX_NAME} characters on one line."
      end
      raise InputError, "Write a reply of 1 to #{MAX_TEXT} characters." if text.empty? || text.length > MAX_TEXT
      raise InputError, 'Choose one of the listed demo outcomes.' unless DEMO_RESULTS.key?(demo_result)

      id = SecureRandom.uuid
      # Network calls run outside the lock, so concurrent replies never wait on each other.
      assets = moderator.moderate_reply(id, { name: name, text: text }, demo_result)
      decisions = FIELDS.keys.to_h { |field| [field, Calmthread.decision(assets[field])] }
      if decisions.value?(:failed)
        field = decisions.key(:failed)
        status = Calmthread.status(assets[field])
        record(:failed, "A reply was not posted: its #{FIELD_LABELS[field]} ended as " \
                        "#{status.is_a?(String) ? status[0, 30] : 'no status'}. Nothing was kept here.")
        return :failed
      end

      held = decisions.select { |_, decision| decision == :held }.keys
      state = held.empty? ? :published : :held
      reply = { id: id, name: name, text: text, created_at: Time.now, state: state, held_fields: held,
                asset_ids: assets.transform_values { |asset| asset['id'] } }
      @lock.synchronize do
        @replies.unshift(reply)
        @replies.pop while @replies.size > MAX_REPLIES
      end
      # Held replies are logged without their name or text.
      if state == :held
        record(:held, "A reply was held for review: its #{held.map { |item| FIELD_LABELS[item] }.join(' and ')} was flagged.")
      else
        record(:published, "#{name} replied.")
      end
      state
    end

    def replies = @lock.synchronize { @replies.map(&:dup) }
    def activity = @lock.synchronize { @activity.dup }

    def find_by_asset(asset_id)
      @lock.synchronize { @replies.find { |reply| reply[:asset_ids].value?(asset_id) }&.dup }
    end

    def find(reply_id)
      @lock.synchronize { @replies.find { |reply| reply[:id] == reply_id }&.dup }
    end

    def publish(reply_id)
      @lock.synchronize do
        reply = @replies.find { |item| item[:id] == reply_id && item[:state] == :held }
        reply && (reply[:state] = :published)
        !reply.nil?
      end
    end

    # Forgets the reply, including its text, so a rejected reply can never be published.
    def remove(reply_id)
      @lock.synchronize { !@replies.reject! { |reply| reply[:id] == reply_id }.nil? }
    end

    def record(kind, text, facts: [])
      @lock.synchronize do
        @activity.unshift({ kind: kind, text: text, facts: facts, at: Time.now })
        @activity.pop while @activity.size > MAX_ACTIVITY
      end
    end
  end

  # Applies portal review decisions from the events feed (pull) and verified webhooks (push).
  class ReviewFeed
    OUTCOME_TEXT = {
      released: 'a held reply is now published.',
      removed: 'the reply is out of the thread for good, and its stored text was deleted from CalmLens.',
      unchanged: 'no change. A reply publishes only once every field is approved.'
    }.freeze

    def initialize(discussion, cursor: nil)
      @discussion = discussion
      @cursor = cursor
      @state_lock = Mutex.new
      @sync_lock = Mutex.new
      @claimed = {}
    end

    def cursor = @state_lock.synchronize { @cursor }

    # Without a cursor the API returns no events and a cursor for "now". The request runs
    # outside any lock; the first cursor to arrive wins.
    def prime(client)
      return if cursor

      fresh = Calmthread.cursor(client.events.list)
      @state_lock.synchronize { @cursor ||= fresh }
    end

    # Returns the number of events that changed a local reply, or :busy when another check is
    # already running (it never waits for one). The cursor advances only after every event on
    # a page is applied, so a failure retries the page.
    def sync(client)
      return :busy unless @sync_lock.try_lock

      begin
        unless cursor
          prime(client)
          return 0
        end
        applied = 0
        client.events.each_page(after: cursor, limit: EVENT_PAGE_SIZE).first(MAX_EVENT_PAGES).each do |page|
          page['events'].each { |event| applied += 1 if %i[released removed].include?(apply(event, client)) }
          @state_lock.synchronize { @cursor = Calmthread.cursor(page) }
        end
        applied
      ensure
        @sync_lock.unlock
      end
    end

    # Accepts the flat events-feed shape. Returns :released, :removed, :unchanged, :test,
    # :ignored, :duplicate or :invalid. An event is claimed before it runs, so the feed and a
    # webhook never apply it twice at once; a failure releases the claim for a retry.
    def apply(event, client)
      return :invalid unless event.is_a?(Hash) && event['id'].is_a?(String) && event['type'].is_a?(String)
      return :duplicate unless claim(event['id'])

      begin
        outcome = run(event, client)
      rescue StandardError
        release(event['id'])
        raise
      end
      outcome
    end

    private

    def run(event, client)
      facts = Array(event['facts']).select { |fact| fact.is_a?(Hash) && fact['key'].is_a?(String) }
      if facts.any? { |fact| fact['key'] == 'test' && fact['value'] == true }
        @discussion.record(:test, "Test event received (#{event['type'][0, 40]}). Nothing changed.")
        return :test
      end
      asset_id = event['assetId']
      reviewed = facts.any? { |fact| fact['key'] == 'decided-by' && fact['value'] == 'reviewer' }
      reply = EVENT_LABELS.key?(event['type']) && reviewed && asset_id.is_a?(String) && @discussion.find_by_asset(asset_id)
      return :ignored unless reply

      # Act on the asset's current status, never on the event's snapshot.
      status = Calmthread.current_status(client.assets.retrieve(asset_id: asset_id), asset_id, reply)
      outcome = if status == 'rejected' && event['type'] == 'asset.rejected'
                  remove(reply, client)
                elsif status == 'approved' && reply[:state] == :held && approved_elsewhere?(reply, asset_id, client)
                  @discussion.publish(reply[:id]) ? :released : :unchanged
                else
                  :unchanged
                end
      @discussion.record(outcome == :unchanged ? :review : outcome,
                         "#{EVENT_LABELS[event['type']]}: #{OUTCOME_TEXT.fetch(outcome)}",
                         facts: Calmthread.display_facts(facts))
      outcome
    end

    # Every other field of the reply must also be approved right now.
    def approved_elsewhere?(reply, asset_id, client)
      reply[:asset_ids].values.reject { |id| id == asset_id }.all? do |id|
        Calmthread.current_status(client.assets.retrieve(asset_id: id), id, reply) == 'approved'
      end
    end

    # Deletes the stored content of every field first; the record and report stay in
    # CalmLens. The reply is dropped locally only after that succeeded, so a failure retries.
    def remove(reply, client)
      reply[:asset_ids].each_value { |id| client.assets.delete_content(asset_id: id) }
      @discussion.remove(reply[:id])
      :removed
    end

    def claim(id)
      @state_lock.synchronize do
        next false if @claimed.key?(id)

        @claimed[id] = true
        @claimed.shift while @claimed.size > 1000
        true
      end
    end

    def release(id) = @state_lock.synchronize { @claimed.delete(id) }
  end

  # Acknowledges verified webhook deliveries at once and applies them afterwards, on a
  # background thread, so a slow CalmLens request never delays the response. Deliveries are
  # deduplicated by their `x-calmlens-delivery` ID. This local example keeps those IDs in
  # memory; a production receiver stores them durably with the work it queues.
  class WebhookInbox
    MAX_ATTEMPTS = 3

    # mode: :background starts a worker thread; :manual leaves the queue for #drain (tests).
    def initialize(feed, client, mode: :background)
      @feed = feed
      @client = client
      @queue = Queue.new
      @seen = {}
      @lock = Mutex.new
      @worker = Thread.new { loop { process(@queue.pop) } } if mode == :background
    end

    # Returns :accepted, or :duplicate for a delivery already received.
    def push(delivery_id, event)
      fresh = @lock.synchronize do
        next false if @seen.key?(delivery_id)

        @seen[delivery_id] = true
        @seen.shift while @seen.size > 10_000
        true
      end
      return :duplicate unless fresh

      @queue << event
      :accepted
    end

    # Applies every queued delivery in the calling thread.
    def drain
      process(@queue.pop) until @queue.empty?
    end

    private

    # A delivery that keeps failing is logged; the events feed applies it on the next check,
    # because the feed and webhooks share the same event IDs.
    def process(event)
      attempts = 0
      begin
        attempts += 1
        @feed.apply(event, @client)
      rescue CalmLens::Error => e
        if attempts < MAX_ATTEMPTS
          sleep(attempts) if @worker
          retry
        end
        warn "Webhook event could not be applied: #{e.code}. The next review check retries it."
      end
    end
  end

  def self.cursor(page)
    cursor = page.is_a?(Hash) ? page['cursor'] : nil
    unless cursor.is_a?(String) && !cursor.empty?
      raise CalmLens::InvalidResponseError.new(CalmLens::SdkErrorCodes::INVALID_RESPONSE, 'Events page has no cursor')
    end

    cursor
  end

  # Registered facts become display rows. Links are kept only for absolute HTTP(S) URLs:
  # internal portal paths do not resolve inside this app.
  def self.display_facts(facts)
    facts.filter_map do |fact|
      label = FACT_LABELS[fact['key']]
      value = fact['value']
      next if label.nil? || value.nil? || value == []

      text = (value.is_a?(Array) ? value.join(', ') : value.to_s)[0, 200]
      url = fact['url'].is_a?(String) && fact['url'].match?(%r{\Ahttps?://[^\s\\]+\z}i) ? fact['url'] : nil
      { label: label, value: text, url: url }
    end
  end

  # Template helpers; every dynamic value is escaped with h().
  class View
    include ERB::Util
    TEMPLATE = ERB.new(File.read(File.join(__dir__, 'index.html.erb'), encoding: Encoding::UTF_8), trim_mode: '-')

    def initialize(**locals)
      locals.each { |key, value| instance_variable_set("@#{key}", value) }
    end

    def render = TEMPLATE.result(binding)
    def initial(name) = name.each_grapheme_cluster.first.to_s.upcase
    def held_labels(reply) = reply[:held_fields].map { |field| FIELD_LABELS[field] }.join(' and ')
  end

  # A Rack-compatible application: call(env) returns [status, headers, body].
  class App
    SECURITY_HEADERS = {
      'cache-control' => 'no-store',
      'x-content-type-options' => 'nosniff',
      'referrer-policy' => 'no-referrer',
      'content-security-policy' => "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
    }.freeze
    # Redirects name a notice by key; the page shows only these texts, never text from the URL.
    NOTICES = {
      'published' => 'Published. Thanks for joining the conversation!',
      'held' => 'Held for review. A moderator checks this reply before anyone sees it.',
      'failed' => 'Not posted: moderation did not complete. Please try again.',
      'watching' => 'Watching for review decisions from now on. Check again after a reviewer acts.',
      'no-decisions' => 'No new review decisions changed the thread.',
      'applied' => 'Applied %<count>d review decision(s).',
      'busy' => 'A check for review decisions is already running. Try again in a moment.',
      'demo-approved' => 'A simulated reviewer approved the reply. It is now published.',
      'demo-rejected' => 'A simulated reviewer rejected the reply. It stays out of the thread and its stored text was deleted.'
    }.freeze
    CSRF_COOKIE = 'calmthread_csrf'
    TOKEN = /\A[A-Za-z0-9_-]{43}\z/

    attr_reader :discussion, :feed, :webhooks

    # webhooks: :background (default) applies deliveries on a worker thread; :manual queues them
    # until #webhooks.drain is called.
    def initialize(discussion, feed: nil, webhook_secret: '', webhooks: :background)
      @discussion = discussion
      @feed = feed || ReviewFeed.new(discussion, cursor: discussion.moderator.demo? ? discussion.moderator.start_cursor : nil)
      @webhook_secret = webhook_secret.to_s
      @webhooks = WebhookInbox.new(@feed, discussion.moderator.client, mode: webhooks) unless @webhook_secret.empty? || demo?
    end

    def demo? = @discussion.moderator.demo?

    def call(env)
      route(env)
    rescue StandardError => e
      warn "Calmthread request failed: #{e.class}"
      text(500, 'Something went wrong. Please try again.')
    end

    private

    def route(env)
      case [env['REQUEST_METHOD'], env['PATH_INFO']]
      in ['GET' | 'HEAD', '/'] then home(env)
      in ['POST', '/replies'] then form_action(env) { |fields| submit(fields) }
      in ['POST', '/reviews/sync'] then form_action(env) { sync }
      in ['POST', '/demo/review'] if demo? then form_action(env) { |fields| demo_review(fields) }
      in ['POST', '/webhooks/calmlens'] then webhook(env)
      in [_, '/' | '/replies' | '/reviews/sync' | '/webhooks/calmlens'] then text(405, 'Method not allowed')
      else text(404, 'Not found')
      end
    end

    # Each browser gets its own form token, kept in a SameSite=Strict cookie and echoed in forms.
    def home(env)
      query = URI.decode_www_form(env['QUERY_STRING'].to_s).to_h
      template = NOTICES[query['notice']]
      notice = template ? format(template, count: Integer(query['count'].to_s, 10, exception: false).to_i) : ''
      page(env, notice)
    rescue ArgumentError
      page(env, '')
    end

    def page(env, notice, status = 200)
      token = cookie_token(env)
      headers = SECURITY_HEADERS.merge('content-type' => 'text/html; charset=utf-8')
      unless token
        token = SecureRandom.urlsafe_base64(32)
        headers['set-cookie'] = "#{CSRF_COOKIE}=#{token}; Path=/; HttpOnly; SameSite=Strict"
      end
      replies = @discussion.replies
      body = View.new(
        demo: demo?, csrf: token, notice: notice, replies: replies,
        held: replies.select { |reply| reply[:state] == :held }, activity: @discussion.activity,
        demo_results: DEMO_RESULTS, webhooks: !@webhooks.nil?, max_name: MAX_NAME, max_text: MAX_TEXT
      ).render
      [status, headers, [body]]
    end

    def cookie_token(env)
      env['HTTP_COOKIE'].to_s.split(';').each do |pair|
        name, value = pair.strip.split('=', 2)
        return value if name == CSRF_COOKIE && value.to_s.match?(TOKEN)
      end
      nil
    end

    # Bounded, token-checked form posts that end in redirect-after-submit.
    def form_action(env)
      fields = read_form(env)
      return fields if fields.is_a?(Array) # an error response

      token = cookie_token(env)
      unless token && OpenSSL.secure_compare(fields.fetch('csrf', ''), token)
        return text(403, 'Invalid form token. Reload the page.')
      end

      redirect(*yield(fields))
    rescue InputError => e
      page(env, e.message, 400)
    rescue CalmLens::Error => e
      warn "CalmLens request failed: #{e.code}#{" (request #{e.request_id})" if e.request_id}"
      page(env, 'Not posted: CalmLens could not be reached or did not complete the request. Please try again.', 502)
    end

    def submit(fields)
      # A submitted demo override must never affect live moderation.
      choice = demo? ? fields.fetch('demo_result', 'clean') : 'clean'
      ensure_cursor
      @discussion.submit(fields['name'], fields['text'], choice).to_s
    end

    def sync
      raise InputError, 'Demo mode has no events feed. Use a simulated reviewer decision.' if demo?

      first = @feed.cursor.nil?
      count = @feed.sync(@discussion.moderator.client)
      return 'busy' if count == :busy
      return 'watching' if first

      count.zero? ? 'no-decisions' : ['applied', count]
    end

    def demo_review(fields)
      reply = @discussion.find(fields['reply'].to_s)
      raise InputError, 'That reply is no longer held for review.' unless reply && reply[:state] == :held

      @discussion.moderator.review(reply, fields['decision'].to_s, @feed)
    end

    def ensure_cursor
      return if demo? || @feed.cursor

      @feed.prime(@discussion.moderator.client)
    rescue CalmLens::Error => e
      warn "Could not start the events cursor: #{e.code}. Review sync will start later."
    end

    # Verifies the raw body, acknowledges at once and applies the decision afterwards.
    def webhook(env)
      return text(503, 'Webhooks need live mode and CALMLENS_WEBHOOK_SECRET.') unless @webhooks

      raw = read_body(env, MAX_WEBHOOK_BYTES)
      return raw if raw.is_a?(Array)

      event = CalmLens.parse_webhook_event(
        payload: raw, secret: @webhook_secret,
        signature: env[header_key(CalmLens::WEBHOOK_SIGNATURE_HEADER)],
        timestamp: env[header_key(CalmLens::WEBHOOK_TIMESTAMP_HEADER)]
      )
      delivery = env[header_key(CalmLens::WEBHOOK_DELIVERY_HEADER)].to_s
      # Webhook deliveries wrap the feed's event fields in `data`.
      flat = event.data.merge('id' => event.id, 'type' => event.type, 'createdAt' => event.created_at)
      @webhooks.push(delivery.empty? ? event.id : delivery, flat)
      [204, SECURITY_HEADERS.dup, []]
    rescue CalmLens::WebhookVerificationError => e
      e.code == CalmLens::SdkErrorCodes::INVALID_WEBHOOK_SIGNATURE ? text(401, 'Invalid signature') : text(400, 'Invalid event')
    end

    def header_key(name) = "HTTP_#{name.upcase.tr('-', '_')}"

    def read_form(env)
      type = env['CONTENT_TYPE'].to_s.split(';').first.to_s.strip.downcase
      return text(415, 'Use a form submission') unless type == 'application/x-www-form-urlencoded'

      raw = read_body(env, MAX_FORM_BYTES)
      return raw if raw.is_a?(Array)
      return text(400, 'Invalid form encoding') unless raw.force_encoding(Encoding::UTF_8).valid_encoding?

      pairs = URI.decode_www_form(raw)
      return text(400, 'Too many form fields') if pairs.size > 6
      return text(400, 'Invalid form encoding') unless pairs.flatten.all?(&:valid_encoding?)

      pairs.to_h
    rescue ArgumentError
      text(400, 'Invalid form encoding')
    end

    def read_body(env, limit)
      length = Integer(env['CONTENT_LENGTH'].to_s, 10, exception: false)
      return text(411, 'Content-Length is required') if length.nil?
      return text(413, 'Request body is too large') if length <= 0 || length > limit

      body = env['rack.input'].read(length).to_s
      body.bytesize == length ? body : text(400, 'Incomplete request body')
    end

    def redirect(notice, count = nil)
      query = { notice: notice }
      query[:count] = count if count
      [303, SECURITY_HEADERS.merge('location' => "/?#{URI.encode_www_form(query)}"), []]
    end

    def text(status, message)
      [status, SECURITY_HEADERS.merge('content-type' => 'text/plain; charset=utf-8'), ["#{message}\n"]]
    end
  end

  # Request bodies are read only after the app has checked their declared size.
  class WebrickInput
    def initialize(request) = @request = request
    def read(length) = @request.body.to_s.byteslice(0, length)
  end

  FORWARDED_HEADERS = ['cookie', CalmLens::WEBHOOK_SIGNATURE_HEADER, CalmLens::WEBHOOK_TIMESTAMP_HEADER,
                       CalmLens::WEBHOOK_DELIVERY_HEADER].freeze

  # Serves the app with WEBrick, on loopback only. WEBrick handles each connection on its
  # own thread, and the app holds no lock around network calls.
  def self.server(app, port: DEFAULT_PORT, logger: nil)
    server = WEBrick::HTTPServer.new(
      BindAddress: DEFAULT_HOST, Port: port, DoNotReverseLookup: true, MaxClients: 16, RequestTimeout: 30,
      AccessLog: [], Logger: logger || WEBrick::Log.new($stderr, WEBrick::Log::WARN)
    )
    server.mount_proc('/') do |request, response|
      env = {
        'REQUEST_METHOD' => request.request_method, 'PATH_INFO' => request.path,
        'QUERY_STRING' => request.query_string.to_s, 'CONTENT_TYPE' => request.content_type.to_s,
        'CONTENT_LENGTH' => request['content-length'].to_s, 'rack.input' => WebrickInput.new(request)
      }
      FORWARDED_HEADERS.each { |name| env["HTTP_#{name.upcase.tr('-', '_')}"] = request[name] }
      status, headers, body = app.call(env)
      response.status = status
      headers.each { |name, value| response[name] = value }
      response.body = request.request_method == 'HEAD' ? '' : body.join
      response.keep_alive = false if status >= 400
    end
    server
  end

  # Live mode needs both credentials. Demo mode runs only when CALMLENS_DEMO=1.
  def self.moderator_from(env)
    if env.fetch('CALMLENS_DEMO', '') == '1'
      require_relative 'demo'
      return Demo::Moderator.new
    end
    Moderator.new(api_key: env.fetch('CALMLENS_API_KEY', ''), project_id: env.fetch('CALMLENS_PROJECT_ID', ''),
                  base_url: env.fetch('CALMLENS_API_URL', ''))
  end

  def self.main(argv = ARGV, env = ENV)
    port = DEFAULT_PORT
    OptionParser.new do |options|
      options.banner = 'Usage: bundle exec ruby app.rb [--port PORT]'
      options.on('--port PORT', Integer, "Port (default #{DEFAULT_PORT})") { |value| port = value }
    end.parse!(argv)
    moderator = moderator_from(env)
    app = App.new(Discussion.new(moderator), webhook_secret: env.fetch('CALMLENS_WEBHOOK_SECRET', ''))
    server = server(app, port: port)
    %w[INT TERM].each { |signal| trap(signal) { server.shutdown } }
    puts "Calmthread: http://#{DEFAULT_HOST}:#{port} (#{moderator.demo? ? 'demo' : 'live'})"
    $stdout.flush
    server.start
  rescue ArgumentError, OptionParser::ParseError, CalmLens::ConfigurationError => e
    abort "Calmthread: #{e.message}"
  ensure
    moderator&.client&.close
  end
end

Calmthread.main if $PROGRAM_NAME == __FILE__
