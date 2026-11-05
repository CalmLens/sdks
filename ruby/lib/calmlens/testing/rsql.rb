# frozen_string_literal: true

require_relative 'asset_filters'

module CalmLens
  module Testing
    # Asset list filters as the API reads them (zodbase/rsql with @rsql/parser): comparisons joined
    # by `;` or `and` (binding tighter), `,` or `or`, and grouped with parentheses. A filter names
    # only {MockAssetFilters::FIELDS} with only {MockAssetFilters::OPERATORS}; anything else, or
    # bad syntax, answers 400 `validation/invalid-filter`. A number field's value must be a number,
    # and `null` is a missing value only on a nullable field. `*` in an `==` or `!=` text value
    # matches any run of characters regardless of case; without it `==` is exact. As in SQL, a
    # comparison never matches a missing value.
    # @api private
    module RSQL
      module_function

      # A filter the API refuses, answered as `validation/invalid-filter`.
      class Invalid < StandardError; end

      def filter(items, expression)
        return items if expression.nil? || expression.to_s.empty?

        test = Parser.new(Lexer.new(expression.to_s).tokens).parse
        items.select { |item| test.call(item) }
      rescue Invalid
        raise Failure.new(ErrorCodes::INVALID_FILTER, 'Invalid filter', status: 400)
      end

      # A test for one comparison, refusing a field or operator the API doesn't accept.
      def comparison(field, operator, raw_values)
        rule = MockAssetFilters::FIELDS[field]
        raise Invalid unless rule && MockAssetFilters::OPERATORS.include?(operator)

        values = raw_values.map { |raw| typed(rule, raw) }
        pattern = values.first.is_a?(String) && values.first.include?('*') ? wildcard(values.first) : nil
        lambda do |item|
          actual = field.split('.').reduce(item) { |object, key| object.is_a?(Hash) ? object[key] : nil }
          # Only `==null` matches a missing value.
          next operator == '==' && values.first.nil? if actual.nil?

          compare(rule[:kind] == 'list' ? Array(actual) : [actual], operator, values, pattern)
        end
      end

      def compare(entries, operator, values, pattern)
        first = values.first
        case operator
        when '==' then pattern ? entries.any? { |entry| pattern.match?(entry.to_s) } : !first.nil? && entries.include?(first)
        when '!=' then pattern ? entries.none? { |entry| pattern.match?(entry.to_s) } : first.nil? || !entries.include?(first)
        when '=in=' then values.compact.any? { |value| entries.include?(value) }
        when '=out=' then values.none?(&:nil?) && values.none? { |value| entries.include?(value) }
        else !first.nil? && entries.any? { |entry| ordered?(entry, operator, first) }
        end
      end

      # A value as the API reads it for the field: `null` is missing on a nullable field, a number
      # field's value must be a finite number (as JavaScript's `Number` reads it), and text stays text.
      def typed(rule, raw)
        return nil if raw == 'null' && rule[:nullable]
        return raw unless rule[:kind] == 'number'

        number(raw) || raise(Invalid)
      end

      RADIXES = { 'x' => 16, 'o' => 8, 'b' => 2 }.freeze

      def number(raw)
        text = raw.strip
        return 0 if text.empty?
        return Integer(text[2..], RADIXES.fetch(text[1].downcase)) if text.match?(/\A0(?:[xX]\h+|[oO][0-7]+|[bB][01]+)\z/)
        return unless text.match?(/\A[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\z/)

        value = Float(text)
        value.finite? ? value : nil
      end

      # `*` matches any run of characters, ignoring case; every other character matches itself.
      def wildcard(value)
        Regexp.new("\\A#{value.split('*', -1).map { |part| Regexp.escape(part) }.join('.*')}\\z",
                   Regexp::IGNORECASE | Regexp::MULTILINE)
      end

      # Numbers compare as numbers, text by code point.
      def ordered?(entry, operator, value)
        return false unless entry.is_a?(Numeric) == value.is_a?(Numeric)

        entry.public_send(operator, value)
      end

      # Tokens like @rsql/parser's lexer: quoted values (with backslash escapes), parentheses, `;`
      # and `,` (or `and ` and `or `), comparison operators (`==`, `!=`, `<`, `<=`, `>`, `>=` and
      # `=word=`) and unquoted runs up to a reserved character.
      class Lexer
        RESERVED = ['"', "'", '(', ')', ';', ',', '=', '!', '~', '<', '>', ' ', "\n", "\t", "\r"].freeze
        WHITESPACE = [' ', "\n", "\t", "\r"].freeze

        attr_reader :tokens

        def initialize(input)
          @input = input
          @index = 0
          @tokens = []
          @tokens << next_token while token_ahead?
        end

        private

        # Skips whitespace; true while input remains.
        def token_ahead?
          @index += 1 while @index < @input.length && WHITESPACE.include?(@input[@index])
          @index < @input.length
        end

        def next_token
          char = @input[@index]
          case char
          when '"', "'" then quoted(char)
          when '(', ')' then single(:paren, char)
          when ';', ',' then single(:logic, char)
          when '=', '!', '~', '<', '>' then operator
          else verbose || unquoted
          end
        end

        def single(type, char)
          @index += 1
          [type, char]
        end

        def quoted(quote)
          finish = @index
          loop do
            finish = @input.index(quote, finish + 1)
            raise Invalid if finish.nil?

            slashes = 0
            slashes += 1 while @input[finish - 1 - slashes] == '\\' && finish - 1 - slashes > @index
            break if slashes.even?
          end
          token = [:quoted, @input[(@index + 1)...finish].gsub(/\\([\s\S])/, '\1')]
          @index = finish + 1
          token
        end

        def operator
          match = @input[@index..].match(/\A(?:==|!=|<=|>=|<|>|=[a-z]*=)/)
          raise Invalid unless match

          @index += match[0].length
          [:operator, match[0]]
        end

        def verbose
          match = @input[@index..].match(/\A(and|or) /)
          return unless match

          @index += match[1].length
          [:logic, match[1] == 'and' ? ';' : ',']
        end

        def unquoted
          finish = @index + 1
          finish += 1 while finish < @input.length && !RESERVED.include?(@input[finish])
          token = [:unquoted, @input[@index...finish]]
          @index = finish
          token
        end
      end

      # Builds the test for a whole filter: `,` (or) of `;` (and) of comparisons and groups.
      class Parser
        def initialize(tokens)
          @tokens = tokens
          @position = 0
        end

        def parse
          test = disjunction
          raise Invalid unless @position == @tokens.size

          test
        end

        private

        def peek = @tokens[@position]

        def take
          token = @tokens[@position] || raise(Invalid)
          @position += 1
          token
        end

        def take_if(token) = peek == token && take

        def disjunction
          alternatives = [conjunction]
          alternatives << conjunction while take_if([:logic, ','])
          ->(item) { alternatives.any? { |test| test.call(item) } }
        end

        def conjunction
          terms = [term]
          terms << term while take_if([:logic, ';'])
          ->(item) { terms.all? { |test| test.call(item) } }
        end

        def term
          if take_if([:paren, '('])
            test = disjunction
            raise Invalid unless take == [:paren, ')']

            return test
          end
          selector = take
          operator = take
          raise Invalid unless selector[0] == :unquoted && operator[0] == :operator

          RSQL.comparison(selector[1], operator[1], arguments)
        end

        def arguments
          return [value] unless take_if([:paren, '('])

          values = [value]
          values << value while take_if([:logic, ','])
          raise Invalid unless take == [:paren, ')']

          values
        end

        def value
          token = take
          raise Invalid unless %i[unquoted quoted].include?(token[0])

          token[1]
        end
      end
    end
  end
end
