# frozen_string_literal: true

module CalmLens
  # The project's events feed. Reach it through {ServerClient#events}.
  class Events < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'events'

    # Lists events after a cursor, oldest first. Without `cursor`, returns no events and a
    # `next_cursor` for the current time: save it, then pass each page's `next_cursor` as `cursor`.
    # `types` and `asset_id` narrow the feed to some event types or one asset's events. A cursor
    # belongs to the filters it was issued with, so pass the same ones with each `cursor`.
    #
    # {Page#each_page} follows the feed until `has_more` is false; persist each page's
    # `next_cursor` once its events are handled, and resume from it later.
    # @option options [String] :cursor the `next_cursor` of a previous page
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [Array<String>] :types event types to list, such as `asset.blocked`
    # @option options [String] :asset_id list only this asset's events
    # @return [EventPage] `next_cursor` is never nil.
    def list(**options)
      call(options, __method__) do |api, request|
        response = request('GET', project('events'), query: feed_query(api), request_options: request)
        unless response.is_a?(Hash) && response['nextCursor'].is_a?(String)
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'Events page has no next cursor')
        end

        page(EventPage, response, options) { list(**_1) }
      end
    end

    private

    # The API takes the types as one comma-separated value; an empty list filters nothing.
    def feed_query(api)
      types = api['types']
      return api unless api.key?('types')
      raise Internal.invalid('types must be an Array of event type Strings') unless types.is_a?(Array) && types.all?(String)

      api.merge('types' => types.empty? ? nil : types.join(','))
    end
  end

  # A page of the events feed. The feed goes on while `has_more` is true, even past an empty page:
  # events can arrive in the meantime.
  class EventPage
    def next_page?
      cursor = self[:next_cursor]
      self[:has_more] == true && cursor.is_a?(String) && !cursor.empty?
    end
  end

  # Reads an event's facts: an {Events#list} item, a webhook delivery body or a {Event}.
  # {CalmLens.get_event_fact} and {CalmLens.get_event_facts} call it.
  module EventFacts
    module_function

    # The value of one of an event's facts, by key, such as `'flagged-categories'`, or nil when the
    # event doesn't carry it. A key the event repeats gives its first value. The fact's `url`, when
    # it has one, is on the fact in the event's `facts`.
    # @param event [Event, Hash] a parsed delivery, or an event or delivery body with string keys
    # @param key [String]
    # @return [Object, nil]
    def value(event, key)
      found = facts_of(event).find { |fact| fact['key'] == key }
      found && found['value']
    end

    # An event's facts as a Hash of values by key, such as `{ 'flagged-categories' => ['hate'] }`.
    # A key the event repeats keeps its first value, as {.value} reads it.
    # @param event [Event, Hash] a parsed delivery, or an event or delivery body with string keys
    # @return [Hash{String => Object}]
    def values(event)
      facts_of(event).each_with_object({}) { |fact, found| found[fact['key']] = fact['value'] unless found.key?(fact['key']) }
    end

    # The well-formed facts of an event, in order.
    def facts_of(event)
      facts = event['facts']
      facts.is_a?(Array) ? facts.select { |fact| (fact.is_a?(Hash) || fact.is_a?(Model)) && fact['key'].is_a?(String) } : []
    end
    private_class_method :facts_of
  end
end
