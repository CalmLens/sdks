# frozen_string_literal: true

# Demo mode for Calmthread, loaded only when CALMLENS_DEMO=1 (and by the tests). It uses the
# SDK's offline MockServerClient, which the live code path never loads.
require 'calmlens/testing'
require 'securerandom'
require_relative 'app'

module Calmthread
  module Demo
    # The outcome each field gets for each demo outcome.
    OUTCOMES = {
      'clean' => %w[approved approved],
      'held' => %w[approved rejected],
      'name-held' => %w[rejected approved],
      'error' => %w[approved failed]
    }.freeze

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

      # Simulates a portal decision: the mock's asset statuses change and an `asset.approved`
      # or `asset.rejected` event joins its events feed. The app then applies it through the
      # same events-feed code it uses in live mode. Returns the notice key.
      def review(reply, decision, feed)
        type = { 'approve' => 'asset.approved', 'reject' => 'asset.rejected' }[decision]
        raise InputError, 'Choose approve or reject.' unless type

        ids = reply[:asset_ids]
        targets = type == 'asset.approved' ? reply[:held_fields] : reply[:held_fields].first(1)
        targets.each do |field|
          id = ids.fetch(field)
          decision = type == 'asset.approved' ? 'approved' : 'rejected'
          client.state.assets.fetch(id)['moderation'].merge!('status' => decision, 'reviewerAction' => decision,
                                                             'reviewerUserId' => 'demo-reviewer')
          client.enqueue_event(type: type, asset_id: id, title: EVENT_LABELS[type], facts: [
                                 { key: 'asset-type', value: 'text' },
                                 { key: 'decided-by', value: 'reviewer' },
                                 { key: 'reviewer-name', value: 'Demo reviewer' },
                                 { key: 'note', value: 'Simulated portal decision' }
                               ])
        end
        feed.sync(client)
        type == 'asset.approved' ? 'demo-approved' : 'demo-rejected'
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

        # A rejected field is one the `hide` policy acted on.
        { 'moderation' => { 'status' => outcome, 'action' => outcome == 'rejected' ? 'hide' : nil, 'report' => { 'categories' => {} } } }
      end
    end
  end
end
