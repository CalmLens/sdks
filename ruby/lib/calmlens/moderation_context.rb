# frozen_string_literal: true

module CalmLens
  # Earlier posts in a conversation, sent with an upload as `context: { items: [{ text:, author_id: }] }`
  # (oldest first) so CalmLens can tell who the content addresses and what it refers to. CalmLens
  # moderates only the uploaded content; it uses the most recent {USED_ITEMS} posts that fit in
  # {USED_CHARACTERS} characters, and the SDK sends only those.
  module ModerationContext
    # The most recent earlier posts CalmLens uses.
    USED_ITEMS = 5
    # The most characters of earlier posts CalmLens uses, counted as Unicode code points.
    USED_CHARACTERS = 2_000

    module_function

    # The earlier posts CalmLens uses: the most recent ones, newest first, while at most
    # {USED_ITEMS} posts and {USED_CHARACTERS} characters allow, returned oldest first. The newest
    # post is always kept, so the API can reject one that is too long.
    # @param items [Array<Hash>] posts oldest first, each with `text` and optionally `author_id`
    #   (Symbol or String keys, snake_case or camelCase).
    # @return [Array<Hash>] the kept posts as `{'text' => String, 'authorId' => String}`, without
    #   `authorId` when a post has none.
    # @raise [InvalidArgumentError] when `items` is not an Array of posts with String text.
    def select_items(items)
      raise Internal.invalid('context.items must be an array of earlier posts') unless items.is_a?(Array)

      selected = []
      characters = 0
      items.reverse_each do |item|
        break if selected.size == USED_ITEMS

        post = post(item)
        length = post['text'].length
        break if !selected.empty? && characters + length > USED_CHARACTERS

        selected.unshift(post)
        characters += length
      end
      selected
    end

    # One post as the API takes it.
    def post(item)
      fields = item.is_a?(Hash) ? Internal.normalize(item) : nil
      text = fields&.fetch('text', nil)
      raise Internal.invalid('Each earlier post needs its text as a String') unless text.is_a?(String)

      author = fields['authorId']
      raise Internal.invalid("An earlier post's author_id must be a String") unless author.nil? || author.is_a?(String)

      author.nil? ? { 'text' => text } : { 'text' => text, 'authorId' => author }
    end
    private_class_method :post
  end
end
