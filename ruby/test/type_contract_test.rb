# frozen_string_literal: true

require 'minitest/autorun'
require 'rbs'
require 'calmlens'
require_relative 'contract_fixtures'
require_relative 'declared_types'
require_relative '../script/generate_models'

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

    def required_keys(type)
      case type
      when RBS::Types::Alias then required_keys(@builder.expand_alias2(type.name, type.args))
      when RBS::Types::Record then type.fields.keys
      when RBS::Types::Union then type.types.map { |member| required_keys(member) }.reduce(:&)
      else []
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
        return record_errors(value, model_record(klass, type.name), path) if klass.is_a?(Class) && klass < CalmLens::Model

        value.is_a?(klass) ? [] : ["#{path}: #{value.inspect} is not #{type}"]
      end
    end

    # The JSON a model reads, as a record of its API keys: a field whose reader can't return nil is
    # required. A field without a reader (`hash`, a Ruby method) takes any value.
    def model_record(klass, type_name)
      readers = @builder.build_instance(type_name).methods
      fields = klass.fields.to_h do |reader, (key, _)|
        method = readers[reader]
        next [key, [RBS::Types::Bases::Any.new(location: nil), false]] unless method&.defined_in == type_name

        returned = method.method_types.first.type.return_type
        [key, [returned, !nullable?(returned)]]
      end
      RBS::Types::Record.new(all_fields: fields, location: nil)
    end

    def nullable?(type)
      case type
      when RBS::Types::Optional, RBS::Types::Bases::Nil then true
      when RBS::Types::Union then type.types.any? { |member| nullable?(member) }
      when RBS::Types::Alias then nullable?(@builder.expand_alias2(type.name, type.args))
      else false
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

  CHECKERS = { true => Checker.new(ENVIRONMENT, complete: true), false => Checker.new(ENVIRONMENT, complete: false) }.freeze

  def checker(complete: true) = CHECKERS.fetch(complete)

  # The Ruby name of a fixture operation, such as `hashLists.addEntry` → `hash_lists.add_entry`.
  def ruby_name(operation) = operation.split('.').map { |part| part.gsub(/([a-z])([A-Z])/, '\1_\2').downcase }.join('.')

  def walker = WALKER

  # The client method a fixture operation calls.
  def method_type(operation) = walker.method_type(ruby_name(operation))

  # The value the client returns for a fixture: nothing for deletes, the lenses for ensureLenses,
  # and the fixture's `result` when it isn't the response body.
  def result(fixture)
    case fixture['operation']
    when /\.(delete|removeEntry)\z/ then nil
    when 'ensureLenses' then fixture['response']['lenses']
    else fixture.fetch('result', fixture['response'])
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
    next unless fixture['inputContract'] || (fixture['options'].is_a?(Hash) && fixture['options'].key?('processingOptions'))

    define_method("test_options_#{index + 1}_#{label}_match_the_signature") do
      options = snake_options(fixture['options'])
      parameter = walker.options_type(ruby_name(fixture['operation']))
      assert_conforms options, parameter, "#{fixture['operation']} options (requests.json case #{index + 1})"
      required = snake_options(fixture.fetch('inputContract', {}).fetch('requiredKeys', []).to_h { |key| [key, true] }).keys
      assert_empty required - checker.required_keys(parameter),
                   "#{fixture['operation']}: required inputs must be required by its options type"
    end
  end

  # The declared-type contract (packages/sdk-contract/README.md, "Declared types"): every operation
  # in types.json against the RBS types of its client method's options and result.
  TYPES = fixture('types')
  # One walker builds each RBS definition once for every test.
  WALKER = DeclaredTypes.new(ENVIRONMENT, TYPES['definitions'])

  # Differences Ruby keeps on purpose, each matched against a full mismatch line, with the reason.
  ALLOWED = [
    [/\Aassets\.create options \$\.processingOptions\.[A-Za-z.]+: should be a String\z/,
     'The multipart upload form also takes these booleans as "true"/"false" strings; Ruby sends JSON booleans.'],
    # Policy settings the API leaves out of its schemas while ENABLE_LINK_SAFETY in
    # packages/shared/src/SharedConstants.ts is off; the input keeps them for when it is switched on.
    [/\.(linkSafety|link_safety): not in the API\z/, 'ENABLE_LINK_SAFETY'],
    [/\AhashLists\.(addEntry|listEntries) result \$(\.items\[\])?\.hash: has no reader\z/,
     'A model has no `hash` reader, which would replace Object#hash; read the entry hash with `entry[:hash]`.']
  ].freeze

  # The models in lib/calmlens/models.rb and sig/models.rbs are what script/generate_models.rb
  # writes from types.json; run `ruby script/generate_models.rb` after regenerating it.
  def test_the_generated_models_match_types_json
    ruby, rbs = CalmLens::ModelGenerator.new(TYPES).sources
    root = File.expand_path('..', __dir__)
    assert_equal ruby, File.read(File.join(root, 'lib/calmlens/models.rb'), encoding: 'UTF-8'), 'lib/calmlens/models.rb is stale'
    assert_equal rbs, File.read(File.join(root, 'sig/models.rbs'), encoding: 'UTF-8'), 'sig/models.rbs is stale'
  end

  # Options types.json leaves out (README "Declared types"): `project_id` (signed URLs name a
  # project), `wait` and the upload payload, which
  # have Ruby-native forms, and the `request_options:` every method takes.
  PAYLOAD_OPTIONS = %w[projectId wait content part url sizeInBytes totalSizeInBytes isFinal requestOptions].freeze

  # Every mismatch of `operation`'s options and result, as `<operation> <options|result> $.<path>: <problem>`.
  def self.mismatches(operation)
    walker = WALKER
    method_type = walker.method_type(operation['names']['ruby']).type
    parameter = walker.options_type(operation['names']['ruby'])
    options = operation['options']
    schema = { 'type' => 'object', 'properties' => options['properties'].transform_values { |property| property['schema'] },
               'required' => options['required'] }
    extras = (options['clientOptions'] + PAYLOAD_OPTIONS).map { |name| DeclaredTypes.key_for(name) }
    found = if parameter
              walker.compare(schema, parameter, mode: :input, patch: operation['method'] == 'PATCH', extras: extras)
            else
              options['properties'].empty? ? [] : ['$: the method takes no options']
            end
    lines = found.map { |line| "#{operation['id']} options #{line}" }
    return lines unless operation['result']

    lines + walker.compare(operation['result'], method_type.return_type, mode: :output).map { |line| "#{operation['id']} result #{line}" }
  end

  # The walker itself: an optional field the API requires and the reverse, a missing enum value, a
  # nullable field the API never sends as null, an Integer for a number, tagged branches the API
  # lacks or the type misses, and an undeclared field.
  def test_the_declared_type_walker_reports_each_kind_of_difference
    schema = { 'type' => 'object', 'required' => %w[id kind],
               'properties' => { 'id' => { 'type' => 'string' }, 'kind' => { 'enum' => %w[a b] }, 'label' => { 'type' => 'string' },
                                 'size' => { 'type' => 'number' },
                                 'item' => { 'oneOf' => [{ 'type' => 'object', 'properties' => { 'type' => { 'const' => 'x' } } },
                                                         { 'type' => 'object', 'properties' => { 'type' => { 'const' => 'y' } } }] } } }
    type = RBS::Parser.parse_type('{ ?"id" => ::String, "kind" => "a", ?"label" => ::String?, ?"size" => ::Integer, "extra" => bool, ' \
                                  '?"item" => { "type" => "x" } | { "type" => "z" } }')
    assert_equal ['$.id: optional, the API requires it', '$.kind: does not accept b', '$.label: nullable, the API never allows null',
                  '$.size: should accept fractions (Float or number)', '$.item<x>.type: required, the API makes it optional',
                  '$.item<z>: not in the API', '$.item<y>: missing', '$.extra: not in the API'],
                 DeclaredTypes.new(ENVIRONMENT, {}).compare(schema, type, mode: :output)
  end

  MISMATCHES = TYPES['operations'].to_h { |operation| [operation['id'], mismatches(operation)] }

  TYPES['operations'].each do |operation|
    define_method("test_declared_types_of_#{operation['id'].gsub(/[^A-Za-z0-9]+/, '_')}_match_types_json") do
      unexpected = MISMATCHES.fetch(operation['id']).reject { |line| ALLOWED.any? { |pattern, _| pattern.match?(line) } }
      assert_empty unexpected, "Declared types differ from types.json:\n#{unexpected.join("\n")}"
    end
  end

  def test_every_allowed_type_difference_still_occurs
    unused = ALLOWED.reject { |pattern, _| MISMATCHES.values.flatten.any? { |line| pattern.match?(line) } }
    assert_empty unused.map(&:first), 'Allowed differences that no longer occur'
  end
end
