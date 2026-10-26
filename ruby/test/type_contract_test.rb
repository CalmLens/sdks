# frozen_string_literal: true

require 'minitest/autorun'
require 'rbs'
require_relative 'contract_fixtures'

# The type contract (packages/sdk-contract/README.md, "Type contract"): the client returns plain
# hashes, so the replay in contract_client_test.rb passes whatever sig/ declares. This test checks
# every requests.json response, including the full models generated from the shared schemas,
# against the RBS return type of the method it calls, and every request's processing options
# against the method's option types, so a field the API sends but sig/ leaves out fails.
class TypeContractTest < Minitest::Test
  extend ContractFixtures

  # Walks a JSON value through an RBS type and collects a message, at its JSON path, for each
  # mismatch: an undeclared or missing record key, a literal or class that doesn't match, or a
  # value that matches no member of a union. With `complete: false` a record's required keys may be
  # absent, for the behaviour fixtures whose responses carry only the fields their case reads.
  class Checker
    def initialize(env, complete: true)
      @builder = RBS::DefinitionBuilder.new(env: env)
      @complete = complete
    end

    # The mismatches of `value` against `type`, or an empty Array when it conforms.
    def errors(value, type, path = '$')
      case type
      when RBS::Types::Alias then errors(value, @builder.expand_alias2(type.name, type.args), path)
      when RBS::Types::Optional then value.nil? ? [] : errors(value, type.type, path)
      when RBS::Types::Union then union_errors(value, type, path)
      when RBS::Types::Record then record_errors(value, type, path)
      when RBS::Types::Literal then value == type.literal ? [] : ["#{path}: #{value.inspect} is not #{type}"]
      when RBS::Types::ClassInstance then instance_errors(value, type, path)
      when RBS::Types::Bases::Bool then [true, false].include?(value) ? [] : ["#{path}: #{value.inspect} is not bool"]
      when RBS::Types::Bases::Nil then value.nil? ? [] : ["#{path}: #{value.inspect} is not nil"]
      when RBS::Types::Bases::Any then []
      else ["#{path}: the checker does not handle #{type.class} (#{type})"]
      end
    end

    private

    # A union accepts a value one member accepts; otherwise the closest member's mismatches show.
    def union_errors(value, type, path)
      candidates = type.types.map { |member| errors(value, member, path) }
      return [] if candidates.any?(&:empty?)

      # A structured value shows its closest member's mismatches; a scalar just names the union.
      return candidates.min_by(&:size) if value.is_a?(Hash) || value.is_a?(Array)

      ["#{path}: #{value.inspect} matches no member of #{type}"]
    end

    def record_errors(value, type, path)
      return ["#{path}: #{value.inspect} is not a record #{type}"] unless value.is_a?(Hash)

      undeclared = (value.keys - type.all_fields.keys).map { |key| "#{path}#{segment(key)}: not declared in the signature" }
      absent = @complete ? type.fields.keys - value.keys : []
      missing = absent.map { |key| "#{path}#{segment(key)}: required by the signature but missing" }
      present = value.filter_map { |key, item| [item, type.all_fields[key][0], "#{path}#{segment(key)}"] if type.all_fields.key?(key) }
      undeclared + missing + present.flat_map { |item, item_type, item_path| errors(item, item_type, item_path) }
    end

    def instance_errors(value, type, path)
      case type.name.to_s
      when '::Hash' then hash_errors(value, *type.args, path)
      when '::Array'
        return ["#{path}: #{value.inspect} is not an Array"] unless value.is_a?(Array)

        value.each_with_index.flat_map { |item, index| errors(item, type.args[0], "#{path}[#{index}]") }
      else
        klass = Object.const_get(type.name.to_s)
        value.is_a?(klass) ? [] : ["#{path}: #{value.inspect} is not #{type}"]
      end
    end

    def hash_errors(value, key_type, value_type, path)
      return ["#{path}: #{value.inspect} is not a Hash"] unless value.is_a?(Hash)

      value.flat_map do |key, item|
        item_path = "#{path}#{segment(key)}"
        errors(key, key_type, "#{item_path} (key)") + errors(item, value_type, item_path)
      end
    end

    def segment(key) = key.to_s.match?(/\A[A-Za-z_][A-Za-z0-9_]*\z/) ? ".#{key}" : "[#{key.to_s.inspect}]"
  end

  ENVIRONMENT = begin
    loader = RBS::EnvironmentLoader.new
    loader.add(path: Pathname(File.expand_path('../sig', __dir__)))
    RBS::Environment.from_loader(loader).resolve_type_names
  end

  def checker(complete: true) = Checker.new(ENVIRONMENT, complete: complete)

  # The client method a fixture operation calls, such as `hashLists.addEntry` → HashLists#add_entry.
  def method_type(operation)
    *resources, method = operation.split('.')
    snake = ->(name) { name.gsub(/([a-z])([A-Z])/, '\1_\2').downcase }
    class_name = resources.empty? ? 'ServerClient' : resources.map { |name| name.sub(/\A./, &:upcase) }.join
    definition = RBS::DefinitionBuilder.new(env: ENVIRONMENT).build_instance(RBS::TypeName.parse("::CalmLens::#{class_name}"))
    method_definition = definition.methods.fetch(snake.call(method).to_sym) { flunk "No signature for #{operation}" }
    method_definition.method_types.first
  end

  # The value the client returns for a fixture: nothing for deletes, the lenses for ensureLenses.
  def result(fixture)
    case fixture['operation']
    when /\.(delete|removeEntry)\z/ then nil
    when 'ensureLenses' then fixture['response']['lenses']
    else fixture['response']
    end
  end

  # Option names as Ruby callers write them: snake_case Symbols.
  def snake_options(value)
    case value
    when Hash then value.to_h { |key, item| [key.gsub(/([a-z])([A-Z])/, '\1_\2').downcase.to_sym, snake_options(item)] }
    when Array then value.map { |item| snake_options(item) }
    else value
    end
  end

  def assert_conforms(value, type, label, complete: true)
    errors = checker(complete: complete).errors(value, type)
    assert_empty errors, "#{label} does not match #{type}:\n#{errors.join("\n")}"
  end

  # The checker itself: an undeclared key, a missing required key and a value outside a union fail.
  def test_the_checker_reports_undeclared_missing_and_mismatched_fields
    type = RBS::Parser.parse_type('{ "id" => ::String, ?"tags" => ::Array["a" | "b"]?, "size" => ::CalmLens::number }')
    assert_empty checker.errors({ 'id' => 'x', 'tags' => nil, 'size' => 1.5 }, type)
    assert_equal ['$.extra: not declared in the signature', '$.size: required by the signature but missing'],
                 checker.errors({ 'id' => 'x', 'extra' => 1 }, type)
    assert_equal ['$.tags[1]: "c" matches no member of "a" | "b"'], checker.errors({ 'id' => 'x', 'tags' => %w[a c], 'size' => 1 }, type)
  end

  # Type-contract cases are marked `fullModel`: their responses carry every field, so every required
  # key must be present. Behaviour cases carry only the fields their case reads.
  fixture('requests').each_with_index do |fixture, index|
    label = fixture['operation'].gsub(/[^A-Za-z0-9]+/, '_')
    complete = fixture['fullModel'] == true
    define_method("test_response_#{index + 1}_#{label}_matches_the_signature") do
      assert_conforms result(fixture), method_type(fixture['operation']).type.return_type,
                      "#{fixture['operation']} response (requests.json case #{index + 1})", complete: complete
    end
    next unless fixture['options'].is_a?(Hash) && fixture['options'].key?('processingOptions')

    define_method("test_options_#{index + 1}_#{label}_match_the_signature") do
      options = snake_options(fixture['options'])
      type = method_type(fixture['operation']).type
      assert_conforms options, (type.required_positionals + type.optional_positionals).first.type,
                      "#{fixture['operation']} options (requests.json case #{index + 1})"
    end
  end
end
