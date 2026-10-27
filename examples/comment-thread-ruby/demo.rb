# frozen_string_literal: true

# Demo mode for Calmthread, loaded only when CALMLENS_DEMO=1 (and by the tests). It uses the
# SDK's offline MockServerClient, which the live code path never loads.
require 'calmlens/testing'
require 'securerandom'
# app.rb loads this file after defining the app; required on its own (tests), it loads app.rb.
require_relative 'app' unless defined?(Calmthread::App)

module Calmthread
  module Demo
    # The outcome each field gets for each demo outcome.
    OUTCOMES = {
      'clean' => %w[allowed allowed],
      'held' => %w[allowed blocked],
      'name-held' => %w[blocked allowed],
      'error' => %w[allowed failed]
    }.freeze
    # The category the demo's simulated policy flags for a blocked field.
    FLAGGED = { 'held' => 'harassment', 'name-held' => 'profanity' }.freeze
    NOTES = { 'allowed' => 'Friendly banter in context.', 'blocked' => 'Personal attack on another member.' }.freeze

    # Replies the demo thread starts with, posted by other people through the same submit path.
    # [name, text, outcome, minutes ago]; the held one is then approved by the simulated reviewer.
    SEED = [
      ['Jonas Weber', 'A ten-minute walk before opening the laptop. No podcast, no music, just the street waking up.', 'clean', 82],
      ['Theo', 'Honestly, my coffee machine dying. Walking to the café forced me outside every morning. ' \
               'Ten out of ten, would break an appliance again.', 'held', 48],
      ['Sam Okafor', 'Batch-cooking lunches on Sunday. Not glamorous, but I stopped losing every lunch break to deciding what to eat.', 'clean', 26]
    ].freeze

    # Fills a new demo thread with other people's replies, one of them held and then approved.
    def self.seed(app)
      discussion = app.discussion
      SEED.each do |name, text, outcome, minutes|
        discussion.submit(name, text, outcome, author: "demo-#{name}", at: Time.now - (minutes * 60))
        reply = discussion.replies.first
        discussion.moderator.review(reply, 'allow', app.feed) if reply[:state] == :held
      end
    end

    # Moderates through the SDK's stateful offline mock: uploads are stored, retrieved and
    # deleted by the real client code, but the outcome is the one chosen in the form. Nothing is
    # classified: there is no keyword matching and no moderation model.
    class Moderator < Calmthread::Moderator
      def initialize
        @outcomes = {}
        @outcome_lock = Mutex.new
        super(client: CalmLens::MockServerClient.new(analyzed_outcome: method(:outcome)))
      end

      def demo? = true

      # The feed starts at the mock's current cursor, so only simulated decisions are read.
      def start_cursor = client.events.list['cursor']

      def moderate_reply(reply_id, fields, demo_result = 'clean')
        @outcome_lock.synchronize { @outcomes[reply_id] = demo_result }
        super
      ensure
        @outcome_lock.synchronize { @outcomes.delete(reply_id) }
      end

      # Simulates a portal decision: the mock's asset statuses change and an `asset.allowed`
      # or `asset.blocked` event joins its events feed. The app then applies it through the
      # same events-feed code it uses in live mode. Returns the notice key.
      def review(reply, decision, feed)
        status = { 'allow' => 'allowed', 'block' => 'blocked' }[decision]
        raise InputError, 'Choose allow or block.' unless status

        type = "asset.#{status}"
        ids = reply[:asset_ids]
        note = NOTES.fetch(status)
        targets = status == 'allowed' ? reply[:held_fields] : reply[:held_fields].first(1)
        targets.each do |field|
          id = ids.fetch(field)
          moderation = client.state.assets.fetch(id)['classification']['moderation']
          moderation['status'] = status
          moderation['manualReviews'] << { 'id' => "rev_#{SecureRandom.alphanumeric(20)}", 'decision' => status, 'note' => note,
                                           'reviewerUserId' => 'demo-reviewer', 'reviewerName' => 'Demo reviewer',
                                           'reviewedAt' => (Time.now.to_f * 1000).to_i, 'appliedToAsset' => true }
          client.enqueue_event(type: type, asset_id: id, title: EVENT_LABELS[type], facts: [
                                 { key: 'asset-type', value: 'text' },
                                 { key: 'decided-by', value: 'reviewer' },
                                 { key: 'reviewer-name', value: 'Demo reviewer' },
                                 { key: 'note', value: note }
                               ])
        end
        feed.sync(client)
        "demo-#{status}"
      end

      private

      # "CalmLens unavailable" runs against a separate mock whose only response is a
      # connection failure, so it never disturbs the shared one.
      def client_for(reply_id)
        return @client unless @outcome_lock.synchronize { @outcomes[reply_id] } == 'unavailable'

        CalmLens::MockServerClient.new(max_retries: 0).enqueue_error(Errno::ECONNREFUSED.new)
      end

      def outcome(asset)
        reply_id, field = asset['externalId'].to_s.split(':', 2)
        choice = @outcome_lock.synchronize { @outcomes[reply_id] } || 'clean'
        outcome = OUTCOMES.fetch(choice, OUTCOMES['clean'])[field == 'name' ? 0 : 1]
        return outcome if outcome == 'failed'

        # A blocked field is one the `block` policy acted on; the report names the flagged category.
        flagged = outcome == 'blocked' ? [FLAGGED.fetch(choice)] : []
        { 'classification' => { 'moderation' => { 'status' => outcome, 'categories' => {},
                                                   'policy' => { 'decision' => { 'source' => 'asset-override', 'action' => 'block',
                                                                                 'flaggedCategories' => flagged } } } } }
      end
    end
  end
end
