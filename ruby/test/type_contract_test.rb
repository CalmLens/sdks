# frozen_string_literal: true

require 'minitest/autorun'
require 'rbs'
require_relative 'contract_fixtures'
require_relative 'declared_types'

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
    class_names = resources.map { |name| name == 'cdn' ? 'CDN' : name.sub(/\A./, &:upcase) }
    class_name = resources.empty? ? 'ServerClient' : class_names.join
    definition = RBS::DefinitionBuilder.new(env: ENVIRONMENT).build_instance(RBS::TypeName.parse("::CalmLens::#{class_name}"))
    method_definition = definition.methods.fetch(snake.call(method).to_sym) { flunk "No signature for #{operation}" }
    method_definition.method_types.first
  end

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
      type = method_type(fixture['operation']).type
      parameter = (type.required_positionals + type.optional_positionals).first
      if parameter
        assert_conforms options, parameter.type, "#{fixture['operation']} options (requests.json case #{index + 1})"
        required = snake_options(fixture.fetch('inputContract', {}).fetch('requiredKeys', []).to_h { |key| [key, true] }).keys
        assert_empty required - checker.required_keys(parameter.type),
                     "#{fixture['operation']}: required inputs must be required by its options type"
      else
        assert_empty options, "#{fixture['operation']} has no options parameter"
      end
    end
  end

  # The declared-type contract (packages/sdk-contract/README.md, "Declared types"): every operation
  # in types.json against the RBS types of its client method's options and result.
  TYPES = fixture('types')

  # Differences Ruby keeps on purpose, each matched against a full mismatch line, with the reason.
  ALLOWED = [
    [/\Aassets\.create options \$\.processingOptions\.[A-Za-z.]+: should be a String\z/,
     'The multipart upload form also takes these booleans as "true"/"false" strings; Ruby sends JSON booleans.'],
    [/\.(when|unless)\[\]: is an open String, the API lists sexual-pornographic-media, /,
     'Qualifier names are generated into sig/qualifiers.rbs (the qualifier_results keys) by ' \
     'packages/sdk-contract/generate.ts; a literal union of them belongs in that generator, not a hand-written copy.'],
    # Features the API leaves out of its schemas while their switch in packages/shared/src/SharedConstants.ts is
    # off; the SDK keeps them so they need no SDK release when switched on.
    [/\.aiGeneratedDetection: not in the API\z/, 'ENABLE_AI_GENERATED_DETECTION'],
    [/\.(linkSafety|link_safety): not in the API\z/, 'ENABLE_LINK_SAFETY'],
    [/: lists (asset\.link-flagged|link-safety), which the API lacks\z/, 'ENABLE_LINK_SAFETY'],
    [/: lists appeal\.(submitted|resolved), which the API lacks\z/, 'ENABLE_APPEALS']
  ].freeze

  # Options types.json leaves out (README "Declared types"): `project_id` (signed URLs name a
  # project), `wait` and the upload payload, which
  # have Ruby-native forms, and the `request_options:` every method takes.
  PAYLOAD_OPTIONS = %w[projectId wait content part url sizeInBytes totalSizeInBytes isFinal requestOptions].freeze

  # Every mismatch of `operation`'s options and result, as `<operation> <options|result> $.<path>: <problem>`.
  def self.mismatches(operation)
    walker = DeclaredTypes.new(ENVIRONMENT, TYPES['definitions'])
    method_type = walker.method_type(operation['names']['ruby']).type
    parameter = (method_type.required_positionals + method_type.optional_positionals).first&.type
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
