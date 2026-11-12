# frozen_string_literal: true

require 'json'

module CalmLens
  # What the API answered to the request that returned a result: its HTTP status, its headers
  # (lowercase names) and its `X-Request-Id`. Quote the request ID when contacting support.
  LastResponse = Data.define(:status, :headers, :request_id)

  # A read-only API object, such as an {Asset} or a {Folder}. Every result is one.
  #
  # Fields have snake_case readers (`asset.classification.moderation.decision`) and can also be read
  # with `[]`, by the reader's Symbol or the API's camelCase String. A field the API added after this
  # release has no reader but is kept: read it with `[]` and it appears in {#to_h}. Records whose
  # keys are data, such as `categories` (keyed by category) and `metadata` values, are frozen Hashes
  # with the API's String keys. A reader returns nil both for a field the API left out and for a
  # null one; {#key?} tells them apart.
  #
  #   case asset
  #   in { classification: { moderation: { status: 'allowed' } } } then publish(asset)
  #   end
  class Model
    # The model classes, generated from the API's schemas in lib/calmlens/models.rb.
    @fields = {}.freeze

    class << self
      # The fields this class declares: reader => [API key, conversion].
      # @api private
      attr_reader :fields

      # The reader name of an API key: `projectId` → `project_id`, `self-harm` → `self_harm`.
      # @api private
      def field_name(key) = key.to_s.gsub(/([a-z\d])([A-Z])/, '\1_\2').tr('-', '_').downcase

      # Declares the fields of a generated class and their readers. A field whose name is already a
      # public method (`hash`) has no reader; read it with `[]`.
      # @api private
      def declare(fields)
        @fields = fields.freeze
        fields.each_key do |name|
          define_method(name) { @values[name] } unless method_defined?(name)
        end
      end

      # Converts a JSON value for a field: a model, an Array or Hash of them, or a frozen value.
      # @api private
      def convert(conversion, value)
        case conversion
        in [:model, name] then value.is_a?(Hash) ? CalmLens.const_get(name).new(value) : frozen(value)
        in [:array, inner] then value.is_a?(Array) ? value.map { |item| convert(inner, item) }.freeze : frozen(value)
        in [:map, inner] then value.is_a?(Hash) ? value.to_h { |key, item| [key, convert(inner, item)] }.freeze : frozen(value)
        else frozen(value)
        end
      end

      # A deep-frozen copy of a JSON value.
      # @api private
      def frozen(value)
        case value
        when Hash then value.to_h { |key, item| [key.frozen? ? key : key.dup.freeze, frozen(item)] }.freeze
        when Array then value.map { |item| frozen(item) }.freeze
        when String then value.frozen? ? value : value.dup.freeze
        else value
        end
      end

      # A value back in the API's JSON form.
      # @api private
      def wire(value)
        case value
        when Model then value.to_h
        when Array then value.map { |item| wire(item) }
        when Hash then value.transform_values { |item| wire(item) }
        else value
        end
      end
    end

    # The response that returned this result, or nil for an object inside one.
    # @return [LastResponse, nil]
    attr_reader :last_response

    # @param values [Hash{String => Object}] the API's JSON object
    # @param last_response [LastResponse, nil]
    def initialize(values, last_response: nil)
      raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, "Expected an object for #{self.class}") unless values.is_a?(Hash)

      @last_response = last_response
      @values = {}
      @keys = {}
      fields = self.class.fields
      values.each do |key, value|
        name = Model.field_name(key).to_sym
        @keys[name] = key.to_s.frozen? ? key.to_s : key.to_s.dup.freeze
        @values[name] = Model.convert(fields.dig(name, 1), value)
      end
      @values.freeze
      @keys.freeze
      freeze
    end

    # The value of a field, by reader name (`:project_id`) or API key (`'projectId'`), or nil.
    def [](key) = @values[name_of(key)]

    # The value at a path of fields, as Hash#dig and Struct#dig read one:
    # `asset.dig(:classification, :moderation, :decision)`. Array indexes and map keys work too.
    def dig(key, *rest)
      value = self[key]
      rest.empty? || value.nil? ? value : value.dig(*rest)
    end

    # The values of several fields, by reader name or API key.
    def values_at(*keys) = keys.map { |key| self[key] }

    # Whether the API sent the field, even as null.
    def key?(key) = @values.key?(name_of(key))

    # The fields the API sent, as reader names.
    def keys = @values.keys

    # The object in the API's JSON form: camelCase String keys, every field the API sent.
    # @return [Hash{String => Object}]
    def to_h = @keys.to_h { |name, key| [key, Model.wire(@values[name])] }

    # The fields by reader name, for pattern matching (`in { status: 'allowed' }`).
    def deconstruct_keys(keys) = keys ? @values.slice(*keys) : @values

    def to_json(*) = to_h.to_json(*)

    def ==(other) = other.instance_of?(self.class) && other.to_h == to_h
    alias eql? ==

    def hash = [self.class, to_h].hash

    def inspect
      fields = @values.map { |name, value| "#{name}=#{value.inspect}" }
      "#<#{self.class.name} #{fields.join(', ')}>"
    end

    def pretty_print(printer) = printer.text(inspect)

    private

    def name_of(key) = key.is_a?(Symbol) && @values.key?(key) ? key : Model.field_name(key).to_sym
  end

  # One page of a list, such as {Assets#list}'s. Enumerating it yields this page's items;
  # {#auto_paging_each} fetches the following pages as it goes, with the same options.
  #
  #   client.assets.list(page_size: 100).auto_paging_each { |asset| index(asset) }
  class Page < Model
    include Enumerable

    # @api private
    # @param fetch [Proc, nil] fetches the page after a cursor, with the options of this one
    # @param cursor [String, nil] the cursor this page was fetched with
    def initialize(values, fetch: nil, cursor: nil, last_response: nil)
      @fetch = fetch
      @cursor = cursor
      super(values, last_response: last_response)
    end

    # The page in the API's JSON form, as for any model (not Enumerable#to_h).
    def to_h = Model.instance_method(:to_h).bind_call(self)

    # Yields each item on this page; fetches no more pages.
    def each(&)
      return enum_for(:each) unless block_given?

      page_items.each(&)
      self
    end

    # Whether this page has no items.
    def empty? = page_items.empty?

    # Whether there is a page after this one.
    def next_page?
      cursor = self[:next_cursor]
      self[:has_more] == true && cursor.is_a?(String) && !cursor.empty? && !page_items.empty?
    end

    # The page after this one, fetched with this page's options; an empty page when there is none.
    def next_page
      return _ = self.class.new({ 'items' => [], 'hasMore' => false, 'nextCursor' => self[:next_cursor] }) unless next_page? && @fetch

      @fetch.call(self[:next_cursor])
    end

    # Yields this page and each one after it, fetching them as needed. Raises `sdk/invalid-response`
    # (with `details['cursor']`) instead of repeating pages when the API hands back a cursor it
    # already returned.
    def each_page
      return enum_for(:each_page) unless block_given?

      page = self
      sent = [@cursor].compact
      loop do
        following = page.next_page?
        if following
          cursor = page[:next_cursor]
          if sent.include?(cursor)
            raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE,
                                           'The API returned a cursor it had already returned, with more pages to follow',
                                           details: { 'cursor' => cursor })
          end
          sent << cursor
        end
        yield page
        break unless following

        page = page.next_page
      end
      nil
    end

    # Yields every item on this page and the pages after it, fetching them as needed.
    def auto_paging_each(&block)
      return enum_for(:auto_paging_each) unless block

      each_page { |page| page.each(&block) }
    end

    private

    def page_items
      value = self[:items]
      raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, "#{self.class} has no items") unless value.is_a?(Array)

      value
    end
  end
end
