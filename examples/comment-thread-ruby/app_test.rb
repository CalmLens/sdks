# frozen_string_literal: true

require 'minitest/autorun'
require 'net/http'
require 'socket'
require 'stringio'
require_relative 'app'
require_relative 'demo'

module TestHelpers
  HOLD_POLICY = { 'keepContentAfterProcessing' => true, 'flaggedContentPolicy' => { 'action' => 'block' } }.freeze
  CURSOR = { 'items' => [], 'nextCursor' => 'c0', 'hasMore' => false }.freeze

  def demo_app(**options)
    Calmthread::App.new(Calmthread::Discussion.new(Calmthread::Demo::Moderator.new), webhooks: :manual, **options)
  end

  # A "live" app whose SDK client is the offline mock. Queued responses answer first, in order.
  def live_app(*responses, **options)
    mock = CalmLens::MockServerClient.new(max_retries: 0)
    responses.each { |body| mock.enqueue(body: body) }
    [Calmthread::App.new(Calmthread::Discussion.new(Calmthread::Moderator.new(client: mock)), webhooks: :manual, **options), mock]
  end

  # A live app with one reply whose text was blocked and held (name-1 allowed, text-1 blocked).
  def held_app(**options)
    app, mock = live_app(CURSOR, asset('name-1', 'allowed'), asset('text-1', 'blocked'), **options)
    post_reply(app, name: 'Held Name', text: 'Held reply text')
    assert_equal [:held], app.discussion.replies.map { |reply| reply[:state] }
    [app, mock]
  end

  # An asset with content stored. `status` is `pending` or `uploading` (still processing), `error`
  # (processing failed) or the moderation status once processing is done.
  # `flagged` lists the categories the report's policy decision flagged.
  def asset(id, status, flagged: nil)
    classification = { 'pending' => 'processing', 'uploading' => 'pending', 'error' => 'failed' }.fetch(status, 'completed')
    moderation = { 'status' => classification == 'completed' ? status : 'pending', 'categories' => {} }
    moderation['policy'] = { 'decision' => { 'source' => 'asset-override', 'action' => 'block', 'flaggedCategories' => flagged } } if flagged
    { 'id' => id, 'upload' => { 'status' => status == 'uploading' ? 'uploading' : 'completed' },
      'classification' => { 'status' => classification, 'moderation' => moderation },
      'content' => { 'status' => 'stored' } }
  end

  # Moderation status events default to a reviewer's decision; pass decided_by: 'automated'
  # for an automated outcome.
  def decision_facts(type, facts, decided_by)
    return facts unless Calmthread::EVENT_LABELS.key?(type)

    [{ 'key' => 'decided-by', 'value' => decided_by }, *facts]
  end

  def event(id, type, asset_id, facts = [], snapshot: nil, decided_by: 'reviewer')
    { 'id' => id, 'type' => type, 'assetId' => asset_id, 'createdAt' => 1, 'facts' => decision_facts(type, facts, decided_by),
      'asset' => snapshot && event_asset(asset_id, snapshot) }.compact
  end

  def event_asset(asset_id, moderation)
    { 'id' => asset_id, 'upload' => { 'status' => 'completed' }, 'classification' => { 'status' => 'completed', 'moderation' => { 'status' => moderation } },
      'content' => { 'status' => 'stored' } }
  end

  def page_of(*events, cursor: 'c1', more: false) = { 'items' => events, 'nextCursor' => cursor, 'hasMore' => more }

  def request(app, method, path, fields: nil, body: nil, headers: {}, type: 'application/x-www-form-urlencoded')
    body ||= fields ? URI.encode_www_form(fields) : ''
    path, query = path.split('?', 2)
    env = { 'REQUEST_METHOD' => method, 'PATH_INFO' => path, 'QUERY_STRING' => query.to_s, 'CONTENT_TYPE' => type,
            'CONTENT_LENGTH' => body.bytesize.to_s, 'rack.input' => StringIO.new(body) }
    headers.each { |name, value| env["HTTP_#{name.upcase.tr('-', '_')}"] = value }
    status, response_headers, response_body = app.call(env)
    [status, response_headers, response_body.join]
  end

  # A browser session: the form token from the page's cookie.
  def token(app)
    (@tokens ||= {})[app] ||= request(app, 'GET', '/')[1].fetch('set-cookie')[/calmthread_csrf=([^;]+)/, 1]
  end

  def form(app, path, fields)
    request(app, 'POST', path, fields: { csrf: token(app) }.merge(fields), headers: { 'Cookie' => "calmthread_csrf=#{token(app)}" })
  end

  def post_reply(app, name: 'Ada', text: 'Ten minutes outside before work.', **extra)
    form(app, '/replies', { name: name, text: text, **extra })
  end

  def sync(app) = form(app, '/reviews/sync', {})
  # The page for a new visitor, and for the browser that posted with #form.
  def home(app) = request(app, 'GET', '/').last
  def home_as_author(app) = request(app, 'GET', '/', headers: { 'Cookie' => "calmthread_csrf=#{token(app)}" }).last
  def states(app) = app.discussion.replies.map { |reply| reply[:state] }
  def calls(mock) = mock.requests.map { |item| [item.method, item.path] }
end

class SubmissionTest < Minitest::Test
  include TestHelpers

  def test_every_field_of_every_reply_carries_the_hold_override_and_an_external_id
    app, mock = live_app(CURSOR, asset('name-1', 'allowed'), asset('text-1', 'allowed'),
                         asset('name-2', 'blocked'), asset('text-2', 'allowed'))
    assert_equal 303, post_reply(app).first
    assert_equal 303, post_reply(app, name: 'Second').first
    moderations = mock.requests.select { |item| item.method == 'POST' && item.path == '/projects/project-1/assets' }
    assert_equal 4, moderations.size
    moderations.each { |item| assert_equal HOLD_POLICY, JSON.parse(item.query['processingOptions']) }
    assert_equal ['Calmthread display name', 'Calmthread reply'] * 2, moderations.map { |item| item.query['name'] }
    assert_equal ['false'] * 4, moderations.map { |item| item.query['queue'] }
    reply = app.discussion.replies.last
    assert_equal ["#{reply[:id]}:name", "#{reply[:id]}:text"], moderations.first(2).map { |item| item.query['externalId'] }
    assert_equal({ name: 'name-1', text: 'text-1' }, reply[:asset_ids])
  end

  def test_clean_replies_publish_immediately
    # A limited field is delivered like an allowed one, so it shows too.
    %w[allowed limited].each do |status|
      app, = live_app(CURSOR, asset('name-1', 'allowed'), asset('text-1', status))
      _, headers, = post_reply(app, name: 'Ada', text: 'Ten minutes outside.')
      assert_equal '/?notice=published', headers['location'], status
      assert_equal [:published], app.discussion.replies.map { |reply| reply[:state] }, status
      page = home(app)
      assert_includes page, 'Ten minutes outside.'
      assert_includes page, '>Ada<'
    end
  end

  def test_a_blocked_reply_is_held_and_shown_only_to_its_author
    app, = held_app
    reply = app.discussion.replies.first
    assert_equal [:text], reply[:held_fields]
    page = home(app)
    refute_includes page, 'Held reply text'
    refute_includes page, 'Held Name'
    author = home_as_author(app)
    assert_includes author, 'Held reply text'
    assert_includes author, 'Held Name'
    assert_equal [reply[:id]], app.discussion.visible_to(Calmthread.author_id(token(app))).map { |item| item[:id] }
    assert_empty app.discussion.visible_to(nil)
    refute_includes app.discussion.activity.inspect, 'Held reply text'
    refute_includes app.discussion.activity.inspect, 'Held Name'
  end

  def test_a_held_reply_keeps_the_categories_its_report_flagged
    app, = live_app(CURSOR, asset('name-1', 'blocked', flagged: ['profanity']), asset('text-1', 'blocked', flagged: %w[harassment profanity]))
    post_reply(app)
    assert_equal [%w[profanity harassment]], app.discussion.replies.map { |reply| reply[:flagged] }
    app, = live_app(CURSOR, asset('name-1', 'allowed', flagged: ['hate']), asset('text-1', 'blocked'))
    post_reply(app)
    assert_equal [[]], app.discussion.replies.map { |reply| reply[:flagged] }, 'only held fields give reasons'
  end

  def test_a_blocked_name_holds_the_reply_but_still_sends_the_text_for_review
    app, mock = live_app(CURSOR, asset('name-1', 'blocked'), asset('text-1', 'allowed'))
    post_reply(app, name: 'Rude Name', text: 'Fine words')
    assert_equal 'Fine words', mock.requests.last.body
    reply = app.discussion.replies.first
    assert_equal [:held, [:name]], [reply[:state], reply[:held_fields]]
    refute_includes home(app), 'Rude Name'
    refute_includes home(app), 'Fine words'
  end

  def test_age_restricted_and_purged_fields_hold_the_reply_too
    %w[age-restricted purged].each do |status|
      app, = live_app(CURSOR, asset('name-1', 'allowed'), asset('text-1', status))
      post_reply(app, text: 'Borderline')
      assert_equal [[:held, [:text]]], app.discussion.replies.map { |reply| [reply[:state], reply[:held_fields]] }, status
      refute_includes home(app), 'Borderline'
    end
  end

  def test_pending_unknown_and_malformed_results_fail_closed
    ['pending', 'uploading', 'error', 'approved', 'unknown'].each do |status|
      # A failed name never sends the reply text; a failed text discards the reply.
      [[asset('n', 'allowed'), asset('t', status)], [asset('n', status)]].each do |responses|
        app, mock = live_app(*responses)
        assert_equal :failed, app.discussion.submit('Ada', 'Secret text')
        assert_empty app.discussion.replies, "kept #{status.inspect}"
        assert_equal(responses.size == 2 ? 1 : 0, mock.requests.count { |item| item.body == 'Secret text' })
      end
    end
    # The SDK refuses a response that is not a well-formed asset, so nothing is kept or published.
    allowed = asset('t', 'allowed')
    [allowed.merge('id' => ''), allowed.reject { |key, _| key == 'id' }, [],
     asset('t', nil)].each do |text|
      [[asset('n', 'allowed'), text], [text]].each do |responses|
        app, mock = live_app(*responses)
        error = assert_raises(CalmLens::InvalidResponseError) { app.discussion.submit('Ada', 'Secret text') }
        assert_equal CalmLens::SdkErrorCodes::INVALID_RESPONSE, error.code
        assert_empty app.discussion.replies, "kept #{text.inspect}"
        assert_equal(responses.size == 2 ? 1 : 0, mock.requests.count { |item| item.body == 'Secret text' })
      end
    end
    app, = live_app(asset('n', 'allowed'), asset('t', 'blocked'))
    # A well-formed blocked result holds rather than publishes.
    assert_equal :held, app.discussion.submit('Ada', 'Hello')
    refute_includes app.discussion.replies.map { |reply| reply[:state] }, :published
  end

  def test_transport_failures_fail_closed_without_showing_the_error
    app, mock = live_app(asset('name-1', 'allowed'))
    mock.enqueue_error(Errno::ECONNRESET.new)
    error = assert_raises(CalmLens::ConnectionError) { app.discussion.submit('Ada', 'Hello') }
    assert_equal 'sdk/transport-error', error.code
    assert_empty app.discussion.replies
    mock.enqueue(body: CURSOR).enqueue_error(Errno::ECONNREFUSED.new)
    status = body = nil
    _, err = capture_io { status, _, body = post_reply(app) }
    assert_equal 502, status
    assert_includes err, 'sdk/transport-error'
    refute_includes body, 'ECONNREFUSED'
    refute_includes body, 'Connection refused'
    assert_empty app.discussion.replies
  end

  def test_demo_outcomes_run_through_the_sdk_mock
    app = demo_app
    expected = { 'clean' => :published, 'held' => :held, 'name-held' => :held, 'error' => :failed }
    expected.each { |choice, state| assert_equal state, app.discussion.submit("N-#{choice}", "T-#{choice}", choice), choice }
    held = app.discussion.replies.find { |reply| reply[:text] == 'T-name-held' }
    assert_equal [:name], held[:held_fields]
    stored = app.discussion.moderator.client.state.assets.fetch(held[:asset_ids][:name])
    assert_equal ["#{held[:id]}:name", 'blocked'], [stored['externalId'], stored.dig('classification', 'moderation', 'status')]
    assert_equal 'sdk/transport-error', assert_raises(CalmLens::Error) { app.discussion.submit('Ada', 'Hi', 'unavailable') }.code
    capture_io { assert_equal 502, post_reply(app, demo_result: 'unavailable').first }
    page = home(app)
    assert_includes page, 'T-clean'
    %w[T-held T-name-held T-error N-held N-name-held].each { |text| refute_includes page, text }
  end

  def test_validation_errors_show_only_the_apps_own_messages
    app = demo_app
    ['', '   ', 'x' * 41, "two\nlines"].each { |name| assert_raises(Calmthread::InputError) { app.discussion.submit(name, 'Hello') } }
    ['', '  ', 'x' * 1001].each { |text| assert_raises(Calmthread::InputError) { app.discussion.submit('Ada', text) } }
    assert_raises(Calmthread::InputError) { app.discussion.submit('Ada', 'Hello', 'allowed') }
    status, _, body = post_reply(app, name: '')
    assert_equal 400, status
    assert_includes body, 'Choose a display name'
  end
end

class ConfigurationTest < Minitest::Test
  def test_live_mode_needs_both_credentials_and_never_falls_back_to_demo
    [{}, { 'CALMLENS_API_KEY' => 'key' }, { 'CALMLENS_PROJECT_ID' => 'project' }].each do |env|
      assert_raises(ArgumentError, env.inspect) { Calmthread.moderator_from(env) }
    end
    live = Calmthread.moderator_from({ 'CALMLENS_API_KEY' => 'key', 'CALMLENS_PROJECT_ID' => 'project',
                                       'CALMLENS_API_URL' => 'http://127.0.0.1:6110/v1' })
    refute live.demo?
    assert_equal 'http://127.0.0.1:6110/v1', live.client.base_url
    live.client.close
  end

  def test_demo_mode_runs_when_requested
    assert Calmthread.moderator_from({ 'CALMLENS_DEMO' => '1' }).demo?
  end

  def test_the_demo_thread_starts_with_other_peoples_replies_one_approved_after_review
    app = Calmthread::App.new(Calmthread::Discussion.new(Calmthread::Demo::Moderator.new), webhooks: :manual)
    Calmthread::Demo.seed(app)
    replies = app.discussion.replies
    assert_equal [:published] * Calmthread::Demo::SEED.size, replies.map { |reply| reply[:state] }
    assert_equal replies.size, replies.map { |reply| reply[:author] }.compact.uniq.size, 'each from its own author'
    assert_equal ['allowed'], replies.filter_map { |reply| reply[:review]&.fetch(:decision) }
    assert_equal replies.sort_by { |reply| -reply[:created_at].to_f }, replies, 'newest first'
    # A new visitor sees every seeded reply, and none of them as their own.
    assert_equal replies.size, app.discussion.visible_to(Calmthread.author_id('a' * 43)).size
    refute(replies.any? { |reply| reply[:author] == Calmthread.author_id('a' * 43) })
  end

  def test_the_live_path_does_not_load_the_sdk_mock
    output = IO.popen([RbConfig.ruby, '-e', "require #{File.join(__dir__, 'app').dump}; print defined?(CalmLens::MockServerClient).inspect"],
                      err: File::NULL, &:read)
    assert_equal 'nil', output
  end
end

class ReviewTest < Minitest::Test
  include TestHelpers

  def test_reviewer_allowing_releases_the_reply_once_every_field_is_allowed
    app, mock = held_app
    # The event snapshot is stale on purpose; the retrieved assets decide.
    mock.enqueue(body: page_of(event('e1', 'asset.allowed', 'text-1', [{ 'key' => 'reviewer-name', 'value' => 'Sam' }], snapshot: 'blocked')))
        .enqueue(body: asset('text-1', 'allowed')).enqueue(body: asset('name-1', 'allowed'))
    _, headers, = sync(app)
    assert_equal '/?notice=applied&count=1', headers['location']
    assert_equal [:published], states(app)
    assert_equal [%w[GET /assets/text-1], %w[GET /assets/name-1]], calls(mock).last(2)
    assert_includes home(app), 'Held reply text'
    assert_equal({ decision: 'allowed', reviewer: 'Sam', note: nil }, app.discussion.replies.first[:review].except(:at))
    entry = app.discussion.activity.first
    assert_equal [:released, :feed, [{ label: 'Reviewer', value: 'Sam', url: nil }]], entry.values_at(:kind, :via, :facts)
    assert_equal 'c1', app.feed.cursor
  end

  def test_reviewer_limiting_releases_the_reply_like_allowing
    app, mock = held_app
    mock.enqueue(body: page_of(event('e1', 'asset.limited', 'text-1', snapshot: 'blocked')))
        .enqueue(body: asset('text-1', 'limited')).enqueue(body: asset('name-1', 'allowed'))
    sync(app)
    assert_equal [:published], app.discussion.replies.map { |reply| reply[:state] }
    assert_includes home(app), 'Held reply text'
    assert_equal [%w[GET /assets/text-1], %w[GET /assets/name-1]], calls(mock).last(2)
  end

  def test_allowed_event_releases_nothing_unless_the_retrieved_assets_are_allowed
    app, mock = held_app
    reply_id = app.discussion.replies.first[:id]
    mock.enqueue(body: page_of(event('e1', 'asset.allowed', 'text-1', snapshot: 'allowed')))
        .enqueue(body: asset('text-1', 'blocked')) # blocked again since the event
        .enqueue(body: page_of(event('e2', 'asset.allowed', 'text-1'), cursor: 'c2'))
        .enqueue(body: asset('text-1', 'allowed')).enqueue(body: asset('name-1', 'pending')) # another field is not allowed
        .enqueue(body: page_of(event('e3', 'asset.allowed', 'text-1'), cursor: 'c3'))
        .enqueue(body: asset('wrong-id', 'allowed')) # not the requested asset
        .enqueue(body: page_of(event('e4', 'asset.allowed', 'text-1'), cursor: 'c4'))
        .enqueue(body: asset('text-1', 'allowed').merge('externalId' => "#{reply_id}:name")) # another field's asset
    4.times { sync(app) }
    assert_equal 'c4', app.feed.cursor
    assert_equal [:held], app.discussion.replies.map { |reply| reply[:state] }
    refute_includes home(app), 'Held reply text'
    assert_equal 0, mock.remaining_responses
  end

  def test_reviewer_blocking_keeps_the_reply_out_and_deletes_its_stored_content
    app, mock = held_app
    mock.enqueue(body: page_of(event('e1', 'asset.blocked', 'text-1', [{ 'key' => 'note', 'value' => 'Off topic' }])))
        .enqueue(body: asset('text-1', 'blocked'))
        .enqueue(body: asset('name-1', 'allowed').merge('content' => { 'status' => 'removed', 'removalReason' => 'requested' }))
        .enqueue(body: asset('text-1', 'blocked').merge('content' => { 'status' => 'removed', 'removalReason' => 'requested' }))
    sync(app)
    assert_equal [%w[GET /assets/text-1], %w[DELETE /assets/name-1/content], %w[DELETE /assets/text-1/content]],
                 calls(mock).last(3)
    # The record stays for its author, without its name or text.
    reply = app.discussion.replies.first
    assert_equal [:removed, nil, nil], reply.values_at(:state, :name, :text)
    assert_equal({ decision: 'blocked', reviewer: nil, note: 'Off topic' }, reply[:review].except(:at))
    assert_equal [reply[:id]], app.discussion.visible_to(Calmthread.author_id(token(app))).map { |item| item[:id] }
    assert_empty app.discussion.visible_to(nil)
    refute_includes home_as_author(app), 'Held reply text'
    refute_includes home_as_author(app), 'Held Name'
    # A later allowed decision on the same asset cannot bring it back.
    mock.enqueue(body: page_of(event('e2', 'asset.allowed', 'text-1'), cursor: 'c2'))
    before = mock.requests.size
    sync(app)
    assert_equal before + 1, mock.requests.size, 'only the events page was requested'
    assert_equal [:removed], states(app)
  end

  def test_automated_decisions_neither_delete_nor_release_a_held_reply
    app, mock = held_app
    mock.enqueue(body: page_of(event('a1', 'asset.blocked', 'text-1', snapshot: 'blocked', decided_by: 'automated'),
                               event('a2', 'asset.allowed', 'name-1', snapshot: 'allowed', decided_by: 'automated')))
    before = mock.requests.size
    sync(app)
    assert_equal before + 1, mock.requests.size, 'only the events page was requested'
    assert_equal 'c1', app.feed.cursor
    assert_equal [:held], app.discussion.replies.map { |reply| reply[:state] }
  end

  def test_blocked_event_deletes_nothing_when_the_asset_is_allowed_again
    app, mock = held_app
    mock.enqueue(body: page_of(event('e1', 'asset.blocked', 'text-1', snapshot: 'blocked')))
        .enqueue(body: asset('text-1', 'allowed')).enqueue(body: asset('name-1', 'allowed'))
    sync(app)
    refute(calls(mock).any? { |method, _| method == 'DELETE' })
    assert_equal [:published], app.discussion.replies.map { |reply| reply[:state] }
  end

  def test_a_failed_deletion_retries_the_page_without_publishing
    app, mock = held_app
    blocked = page_of(event('e1', 'asset.blocked', 'text-1'))
    mock.enqueue(body: blocked).enqueue(body: asset('text-1', 'blocked'))
        .enqueue(status: 500, body: { 'code' => 'server/error', 'message' => 'Down' })
    capture_io { assert_equal 502, sync(app).first }
    assert_equal 'c0', app.feed.cursor
    assert_equal [:held], app.discussion.replies.map { |reply| reply[:state] }
    mock.enqueue(body: blocked).enqueue(body: asset('text-1', 'blocked'))
        .enqueue(body: asset('name-1', 'allowed')).enqueue(body: asset('text-1', 'blocked'))
    assert_equal 303, sync(app).first
    assert_equal 'c1', app.feed.cursor
    assert_equal [:removed], states(app)
    assert_equal 0, mock.remaining_responses
  end

  def test_replays_test_sends_and_unrelated_events_change_nothing
    app, mock = held_app
    mock.enqueue(body: page_of(event('t1', 'asset.allowed', 'text-1', [{ 'key' => 'test', 'value' => true }]),
                               event('o1', 'asset.classified', 'text-1'), event('o2', 'asset.allowed', 'someone-else'),
                               more: true))
        .enqueue(body: page_of(event('t1', 'asset.allowed', 'text-1', [{ 'key' => 'test', 'value' => true }]), cursor: 'c2'))
    before = mock.requests.size
    sync(app)
    assert_equal before + 2, mock.requests.size, 'no asset was retrieved'
    assert_equal({ 'cursor' => 'c1', 'pageSize' => '50' }, mock.requests.last.query)
    assert_equal 'c2', app.feed.cursor
    assert_equal [:held], app.discussion.replies.map { |reply| reply[:state] }
    assert_equal 1, app.discussion.activity.count { |entry| entry[:kind] == :test }
  end

  def test_a_running_check_never_blocks_another
    entered = Queue.new
    release = Queue.new
    mock = CalmLens::MockServerClient.new(max_retries: 0)
    gate = Object.new
    gate.define_singleton_method(:events) { entered << true; release.pop; mock.events }
    feed = Calmthread::ReviewFeed.new(Calmthread::Discussion.new(Calmthread::Moderator.new(client: mock)), cursor: 'mock_0')
    first = Thread.new { feed.sync(gate) }
    entered.pop
    assert_equal :busy, feed.sync(mock)
    release << true
    assert_equal 0, first.value
  end

  def test_first_live_sync_only_starts_the_cursor
    app, = live_app({ 'items' => [], 'nextCursor' => 'now', 'hasMore' => false })
    _, headers, = sync(app)
    assert_equal '/?notice=watching', headers['location']
    assert_equal 'now', app.feed.cursor
    assert_equal 400, sync(demo_app).first
  end

  def test_demo_reviewer_buttons_use_the_events_feed_path
    app = demo_app
    app.discussion.submit('Ada', 'Allow me', 'held')
    app.discussion.submit('Bo', 'Block me', 'name-held')
    allow, block = app.discussion.replies.reverse
    review = ->(reply, decision) { form(app, '/demo/review', { reply: reply[:id], decision: decision }).first }
    assert_equal 303, review.(allow, 'allow')
    assert_equal 303, review.(block, 'block')
    assert_equal [[block[:id], :removed], [allow[:id], :published]], app.discussion.replies.map { |reply| [reply[:id], reply[:state]] }
    content = app.discussion.moderator.client.state.content
    assert_equal [false, false], block[:asset_ids].values.map { |id| content.key?(id) }, 'blocked content was deleted'
    page = home(app)
    assert_includes page, 'Allow me'
    refute_includes page, 'Block me'
    assert_equal ['profanity'], app.discussion.replies.first[:flagged]
    released = app.discussion.activity.find { |entry| entry[:kind] == :released }
    assert_equal :demo, released[:via]
    assert_includes released[:facts], { label: 'Reviewer', value: 'Demo reviewer', url: nil }
    assert_equal 400, review.(allow, 'allow'), 'a published reply is no longer held'
    assert_equal 400, review.(block, 'block')
    app.discussion.submit('Cy', 'Held', 'held')
    assert_equal 400, review.(app.discussion.replies.first, 'publish')
  end
end

class WebhookTest < Minitest::Test
  include TestHelpers
  SECRET = 'a-local-development-secret'

  def deliver(app, body, delivery: "dlv_#{SecureRandom.alphanumeric(20)}", timestamp: Time.now.to_i,
              signature: CalmLens.create_webhook_signature_header(payload: body, timestamp: timestamp, secret: SECRET))
    request(app, 'POST', '/webhooks/calmlens', body: body, type: 'application/json',
                                               headers: { CalmLens::WEBHOOK_SIGNATURE_HEADER => signature,
                                                          CalmLens::WEBHOOK_TIMESTAMP_HEADER => timestamp.to_s,
                                                          CalmLens::WEBHOOK_DELIVERY_HEADER => delivery })
  end

  def delivery(id, type, asset_id, facts = [], decided_by: 'reviewer')
    JSON.generate('id' => id, 'type' => type, 'createdAt' => 1, 'projectId' => 'project-1',
                  'data' => { 'assetId' => asset_id, 'asset' => event_asset(asset_id, 'allowed'),
                              'facts' => decision_facts(type, facts, decided_by) })
  end

  def test_tampered_deliveries_are_rejected_and_verified_ones_are_acknowledged_before_any_request
    app, mock = held_app(webhook_secret: SECRET)
    body = delivery('evt-1', 'asset.allowed', 'text-1', [{ 'key' => 'reviewer-name', 'value' => 'Sam' }])
    before = mock.requests.size
    assert_equal 401, deliver(app, body, signature: 'v1=bad').first
    signed = CalmLens.create_webhook_signature_header(payload: body, timestamp: Time.now.to_i, secret: SECRET)
    assert_equal 401, deliver(app, body.sub('Sam', 'Eve'), signature: signed).first
    assert_equal 401, deliver(app, body, timestamp: Time.now.to_i - 3600).first
    assert_equal 400, deliver(app, '{"id":"evt-2"}').first
    assert_equal 400, deliver(app, 'not json').first
    assert_equal 204, deliver(app, body, delivery: 'dlv-1').first
    assert_equal 204, deliver(app, body, delivery: 'dlv-1').first
    assert_equal before, mock.requests.size, 'the response did not wait for CalmLens'
    mock.enqueue(body: asset('text-1', 'allowed')).enqueue(body: asset('name-1', 'allowed'))
    app.webhooks.drain
    assert_equal before + 2, mock.requests.size, 'a redelivery does not act again'
    assert_equal [:published], states(app)
    assert_equal [:released, :webhook], app.discussion.activity.first.values_at(:kind, :via)
  end

  def test_a_failed_webhook_is_retried_and_otherwise_left_to_the_events_feed
    app, mock = held_app(webhook_secret: SECRET)
    body = delivery('evt-1', 'asset.purged', 'text-1')
    assert_equal 204, deliver(app, body).first
    3.times { mock.enqueue_error(Errno::ECONNRESET.new) }
    _, err = capture_io { app.webhooks.drain }
    assert_includes err, 'sdk/transport-error'
    assert_equal [:held], app.discussion.replies.map { |reply| reply[:state] }
    # The same event arrives through the feed and applies there.
    mock.enqueue(body: page_of(event('evt-1', 'asset.purged', 'text-1')))
        .enqueue(body: asset('text-1', 'purged')).enqueue(body: asset('name-1', 'allowed')).enqueue(body: asset('text-1', 'purged'))
    sync(app)
    assert_equal [%w[DELETE /assets/name-1/content], %w[DELETE /assets/text-1/content]], calls(mock).last(2)
    assert_equal [:removed], states(app)
    assert_equal :feed, app.discussion.activity.first[:via]
  end

  def test_test_send_changes_nothing
    app, mock = held_app(webhook_secret: SECRET)
    before = mock.requests.size
    assert_equal 204, deliver(app, delivery('evt-t', 'asset.blocked', 'text-1', [{ 'key' => 'test', 'value' => true }])).first
    app.webhooks.drain
    assert_equal before, mock.requests.size
    assert_equal [:held], app.discussion.replies.map { |reply| reply[:state] }
  end

  def test_webhooks_need_live_mode_and_a_secret
    assert_equal 503, deliver(demo_app(webhook_secret: SECRET), '{}').first
    assert_equal 503, deliver(live_app.first, '{}').first
  end
end

class RequestTest < Minitest::Test
  include TestHelpers

  def test_html_is_escaped_and_notices_come_only_from_the_apps_list
    app = demo_app
    app.discussion.submit('<img src=x onerror=alert(1)>', '<script>alert("x")</script>', 'clean')
    status, headers, body = request(app, 'GET', '/?notice=%3Cscript%3Eboom%3C%2Fscript%3E')
    assert_equal 200, status
    refute_includes body, '<script>'
    refute_includes body, 'boom'
    refute_includes body, '<img src=x'
    assert_includes body, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    assert_match(/default-src 'none'/, headers['content-security-policy'])
    assert_equal 'nosniff', headers['x-content-type-options']
    refute_includes request(app, 'GET', '/?notice=Click%20evil.example').last, 'evil.example'
    assert_includes request(app, 'GET', '/?notice=held').last, 'role="status"'
  end

  def test_test_input_codes_are_shown_as_a_marker_and_stay_escaped
    tag = 'a' * 32
    html = Calmthread::View.new.body_html("Hi <b> <!calmlens-test #{tag} harassment>")
    refute_includes html, tag
    refute_includes html, '<b>'
    assert_includes html, '&lt;b&gt;'
    assert_includes html, 'harassment'
  end

  def test_fact_links_allow_only_http_urls_and_registered_keys
    facts = Calmthread.display_facts([
                                       { 'key' => 'note', 'value' => 'See', 'url' => 'https://portal.example/assets/1' },
                                       { 'key' => 'reviewer-name', 'value' => 'Sam', 'url' => 'javascript:alert(1)' },
                                       { 'key' => 'asset-name', 'value' => 'Calmthread reply', 'url' => '/portal/assets/1' },
                                       { 'key' => 'reviewer-user-id', 'value' => 'hidden-id' },
                                       { 'key' => 'unregistered', 'value' => 'x' }
                                     ])
    assert_equal [['Note', 'See', 'https://portal.example/assets/1'], ['Reviewer', 'Sam', nil],
                  ['Asset', 'Calmthread reply', nil]], facts.map(&:values)
  end

  def test_each_browser_gets_its_own_form_token
    app = demo_app
    first = request(app, 'GET', '/')[1]['set-cookie']
    second = request(app, 'GET', '/')[1]['set-cookie']
    assert_match(/HttpOnly; SameSite=Strict/, first)
    refute_equal first, second
    other = second[/calmthread_csrf=([^;]+)/, 1]
    # A token from one browser does not work with another browser's cookie, or without one.
    assert_equal 403, request(app, 'POST', '/replies', fields: { csrf: other, name: 'A', text: 'B' },
                                                       headers: { 'Cookie' => "calmthread_csrf=#{token(app)}" }).first
    assert_equal 403, request(app, 'POST', '/replies', fields: { csrf: token(app), name: 'A', text: 'B' }).first
    assert_empty app.discussion.replies
    status, headers, = post_reply(app, demo_result: 'held')
    assert_equal [303, '/?notice=held'], [status, headers['location']]
    assert_nil request(app, 'GET', '/', headers: { 'Cookie' => "calmthread_csrf=#{token(app)}" })[1]['set-cookie']
    assert_equal 1, app.discussion.replies.size
  end

  def test_requests_are_bounded
    app = demo_app
    assert_equal 303, post_reply(app).first
    assert_equal 415, request(app, 'POST', '/replies', body: 'name=a', type: 'text/plain').first
    assert_equal 413, request(app, 'POST', '/replies', body: "text=#{'x' * Calmthread::MAX_FORM_BYTES}").first
    assert_equal 413, request(app, 'POST', '/replies', body: '').first
    env_without_length = { 'REQUEST_METHOD' => 'POST', 'PATH_INFO' => '/replies', 'CONTENT_TYPE' => 'application/x-www-form-urlencoded',
                           'rack.input' => StringIO.new('name=a') }
    assert_equal 411, app.call(env_without_length).first
    too_many = Array.new(7) { |index| "f#{index}=1" }.join('&')
    assert_equal 400, request(app, 'POST', '/replies', body: too_many).first
    assert_equal 400, request(app, 'POST', '/replies', body: "name=%FF&csrf=#{token(app)}",
                                                       headers: { 'Cookie' => "calmthread_csrf=#{token(app)}" }).first
    assert_equal 404, request(app, 'GET', '/missing').first
    assert_equal 405, request(app, 'GET', '/replies').first
    assert_equal 1, app.discussion.replies.size # only the first, valid post above
  end

  def test_live_handler_ignores_demo_overrides
    app, mock = live_app({ 'items' => [], 'nextCursor' => 'start', 'hasMore' => false },
                         asset('n', 'allowed'), asset('t', 'allowed'))
    assert_equal 303, post_reply(app, demo_result: 'held').first
    assert_equal [:published], app.discussion.replies.map { |reply| reply[:state] }
    assert_equal 'start', app.feed.cursor, 'the events cursor starts before the first moderation request'
    assert_equal 3, mock.requests.size
    refute_includes home(app), 'demo_result'
    assert_equal 404, form(app, '/demo/review', {}).first
  end
end

class ServerTest < Minitest::Test
  include TestHelpers

  def serve
    server = Calmthread.server(demo_app, port: 0, logger: WEBrick::Log.new(File::NULL))
    thread = Thread.new { server.start }
    yield server.listeners.first.addr
  ensure
    server&.shutdown
    thread&.join(5)
  end

  def test_webrick_server_binds_loopback_and_bounds_bodies
    serve do |address|
      assert_equal '127.0.0.1', address[3]
      Net::HTTP.start('127.0.0.1', address[1]) do |http|
        response = http.get('/')
        assert_equal '200', response.code
        assert_equal 'nosniff', response['x-content-type-options']
        cookie = response['set-cookie'][/calmthread_csrf=[^;]+/]
        token = cookie.split('=', 2).last
        post = http.post('/replies', URI.encode_www_form(csrf: token, name: 'Ada', text: 'Hi'),
                         'Cookie' => cookie, 'Content-Type' => 'application/x-www-form-urlencoded')
        assert_equal '303', post.code
        assert post['location'].end_with?('/?notice=published'), post['location']
      end
      # The declared size is rejected before the server waits for, or reads, any body bytes.
      socket = TCPSocket.new('127.0.0.1', address[1])
      socket.write("POST /replies HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/x-www-form-urlencoded\r\n" \
                   "Content-Length: 1000000000\r\n\r\n")
      assert_match %r{\AHTTP/1\.1 413 }, socket.readpartial(4096)
      socket.close
    end
  end
end
