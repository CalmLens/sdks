# frozen_string_literal: true

module CalmLens
  # Text moderation shortcuts. Reach it through {ServerClient#text}.
  class Text < Resource
    # @api private
    def initialize(session, assets)
      super(session)
      @assets = assets
    end

    # Moderates a string as a `text/plain` asset and waits for the decision.
    # @option options [String] :text
    # @option options [String] :name defaults to `text`
    # @return [Hash] the asset; show it to everyone only when `classification.moderation.status` is
    #   `allowed` or `limited` (reduce the reach of `limited` content).
    def classify(options)
      api, request = call(options) { |*split| split }
      text = api['text']
      unless text.is_a?(String) && !text.strip.empty?
        raise Internal.invalid('Text to classify must be a non-empty string', ErrorCodes::INVALID_UPLOAD_PAYLOAD)
      end

      @assets.classify(without(api, 'text').merge('name' => api.fetch('name', 'text'),
                                                  'content' => { 'plainText' => text, 'type' => 'text/plain' },
                                                  'request_options' => request))
    end
  end
end
