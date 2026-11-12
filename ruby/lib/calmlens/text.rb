# frozen_string_literal: true

module CalmLens
  # Text moderation shortcuts. Reach it through {ServerClient#text}.
  class Text < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'text'

    # @api private
    def initialize(session, assets)
      super(session)
      @assets = assets
    end

    # Moderates a string as a `text/plain` asset and waits for the decision.
    # @option options [String] :text
    # @option options [String] :name defaults to `text`
    # @option options [String] :author_id who wrote the text, as for {Assets#create}
    # @option options [Hash] :context earlier posts in the conversation, as for {Assets#create}
    # @return [Asset] show it to everyone only when `classification.moderation.decision` is
    #   `allowed` or `limited` (reduce the reach of `limited` content).
    def classify(**options)
      call(options, __method__) { nil }
      text = options[:text]
      raise Internal.invalid('Text to classify must be a non-empty string') unless text.is_a?(String) && !text.strip.empty?

      @assets.classify(**options.except(:text), name: options.fetch(:name, 'text'),
                                                content: { plain_text: text, type: 'text/plain' })
    end
  end
end
