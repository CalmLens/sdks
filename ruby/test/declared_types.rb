# frozen_string_literal: true

require 'json'
require 'rbs'

# Walks an RBS type alongside a types.json schema (packages/sdk-contract/README.md, "Declared
# types") and names every difference as `$.<path>: <problem>`. Only type_contract_test.rb uses it.
#
# Options are records of snake_case Symbol keys (or of the API's String keys, where an option takes a
# result back); results keep the API's camelCase String keys. A
# union of records the API tags (or splits by `status`) is one RBS record with every branch's keys,
# because Steep cannot narrow a union of records on a key's value: such a record is compared with
# the branches merged, each key's types from every branch, required only when every branch
# requires it.
class DeclaredTypes
  OPEN_ALIASES = %w[::CalmLens::json_value ::CalmLens::json_input].freeze

  Flat = Struct.new(:branches, :nullable, :open)

  def initialize(env, definitions)
    @builder = RBS::DefinitionBuilder.new(env: env)
    @definitions = definitions
  end

  # The differences between `type` and `schema`. `mode` is :input for options and :output for
  # results; `patch` makes option nullability exact. `extras` are top-level keys the SDK may add.
  def compare(schema, type, path = '$', mode:, patch: false, extras: [])
    @mode = mode
    @patch = patch
    walk(schema, type, path, [], extras)
  end

  # The client method `name` (`hash_lists.add_entry`) names, from ServerClient through its accessors.
  def method_type(name)
    *accessors, method = name.split('.')
    type_name = accessors.reduce(RBS::TypeName.parse('::CalmLens::ServerClient')) do |owner, accessor|
      instance_method(owner, accessor).type.return_type.name
    end
    instance_method(type_name, method)
  end

  # A JSON Schema key as `record` writes it: as is in a record of String keys (results, and inputs
  # that take a result back), else as a snake_case Symbol.
  def self.key_for(name, record = nil)
    return name if record && !record.all_fields.empty? && record.all_fields.keys.all?(String)

    name.gsub(/([a-z\d])([A-Z])/, '\1_\2').downcase.to_sym
  end

  private

  def instance_method(type_name, method)
    method_definition = @builder.build_instance(type_name).methods[method.to_sym]
    raise ArgumentError, "#{type_name} has no method #{method}" unless method_definition

    method_definition.method_types.first
  end

  def walk(schema, type, path, refs, extras = [])
    expected = schema_flat(schema, refs)
    return [] if expected == :recursive

    declared = declared_flat(type)
    return declared.open ? [] : ["#{path}: should be any JSON value"] if expected.open || json_value?(expected)
    return ["#{path}: declared as any JSON value, the API has a type"] if declared.open

    null_errors(expected, declared, path) + kind_errors(expected.branches, declared.branches, path, extras)
  end

  def null_errors(expected, declared, path)
    if expected.nullable && !declared.nullable
      @mode == :input && !@patch ? [] : ["#{path}: not nullable, the API allows null"]
    elsif !expected.nullable && declared.nullable
      ["#{path}: nullable, the API never allows null"]
    else
      []
    end
  end

  # The recursive JSON value schema (metadata values): every kind of JSON value.
  def json_value?(expected)
    (%w[string number boolean array object] - expected.branches.map { |schema, _| schema_kind(schema) }).empty?
  end

  # ---- The schema side: non-null branches of [schema, refs], with `null` and open values noted.

  def schema_flat(schema, refs, flat = Flat.new([], false, false))
    if schema.key?('$ref')
      name = schema['$ref'].delete_prefix('#/definitions/')
      return :recursive if refs.include?(name)

      return schema_flat(@definitions.fetch(name), refs + [name], flat)
    end
    union = schema['anyOf'] || schema['oneOf']
    return union.reduce(flat) { |acc, branch| acc == :recursive ? acc : schema_flat(branch, refs, acc) } if union

    schema_branch(schema, refs, flat)
  end

  def schema_branch(schema, refs, flat)
    values = schema.key?('const') ? [schema['const']] : schema['enum']
    types = Array(schema['type'])
    if values
      flat.nullable ||= values.include?(nil)
      flat.branches << [schema.merge('enum' => values.compact).except('const'), refs] unless values.compact.empty?
    elsif types.empty?
      flat.open = true
    else
      flat.nullable ||= types.include?('null')
      (types - ['null']).each { |type| flat.branches << [schema.merge('type' => type), refs] }
    end
    flat
  end

  def schema_kind(schema)
    return schema['type'] if schema['type'] && schema['type'] != 'string'
    return 'string' unless schema['enum']

    case schema['enum'].first
    when true, false then 'boolean'
    when Integer then 'integer'
    else 'string'
    end
  end

  # ---- The declared side: non-nil members, with `nil` and open values noted.

  def declared_flat(type, flat = Flat.new([], false, false))
    case type
    when RBS::Types::Alias
      return flat.tap { flat.open = true } if OPEN_ALIASES.include?(type.name.to_s)

      declared_flat(@builder.expand_alias2(type.name, type.args), flat)
    when RBS::Types::Optional then declared_flat(type.type, flat.tap { flat.nullable = true })
    when RBS::Types::Union then type.types.reduce(flat) { |acc, member| declared_flat(member, acc) }
    when RBS::Types::Bases::Nil then flat.tap { flat.nullable = true }
    when RBS::Types::Bases::Any then flat.tap { flat.open = true }
    else flat.tap { flat.branches << type }
    end
  end

  def declared_kind(type)
    case type
    when RBS::Types::Literal then literal_kind(type.literal)
    when RBS::Types::Bases::Bool then 'boolean'
    when RBS::Types::Record, RBS::Types::Tuple then type.is_a?(RBS::Types::Record) ? 'object' : 'array'
    when RBS::Types::ClassInstance
      { '::String' => 'string', '::Symbol' => 'string', '::Integer' => 'integer', '::Float' => 'number',
        '::Numeric' => 'number', '::Array' => 'array', '::Hash' => 'object' }[type.name.to_s]
    end
  end

  def literal_kind(value)
    case value
    when true, false then 'boolean'
    when Integer then 'integer'
    else 'string'
    end
  end

  # ---- Kinds

  def kind_errors(expected, declared, path, extras)
    schemas = expected.group_by { |schema, _| schema_kind(schema) }
    types = declared.group_by { |type| declared_kind(type) }
    errors = types.fetch(nil, []).map { |type| "#{path}: cannot compare #{type}" }
    errors += numeric_errors(schemas, types, path)
    errors += string_errors(schemas['string'], types['string'], path) if schemas['string'] || types['string']
    errors += boolean_errors(schemas['boolean'], types['boolean'], path) if schemas['boolean'] || types['boolean']
    errors += array_errors(schemas['array'], types['array'], path) if schemas['array'] || types['array']
    errors += object_errors(schemas['object'], types['object'], path, extras) if schemas['object'] || types['object']
    errors
  end

  def numeric_errors(schemas, types, path)
    declared = types.values_at('integer', 'number').flatten.compact
    integer = declared.any? { |type| declared_kind(type) == 'integer' }
    fractions = declared.any? { |type| declared_kind(type) == 'number' }
    if schemas['number']
      fractions ? [] : ["#{path}: should accept fractions (Float or number)"]
    elsif schemas['integer']
      integer || fractions ? [] : ["#{path}: should be an Integer"]
    else
      declared.empty? ? [] : ["#{path}: declares a number the API lacks"]
    end
  end

  def string_errors(schemas, types, path)
    return ["#{path}: declares a String the API lacks"] unless schemas
    return ["#{path}: should be a String"] unless types

    open = schemas.any? { |schema, _| !schema['enum'] }
    literals = types.filter_map { |type| type.literal.to_s if type.is_a?(RBS::Types::Literal) }.uniq
    open_declared = types.any?(RBS::Types::ClassInstance)
    return open_declared ? [] : ["#{path}: lists only #{literals.join(', ')}, the API takes any string"] if open

    values = schemas.flat_map { |schema, _| schema['enum'] }.uniq
    return ["#{path}: is an open String, the API lists #{values.join(', ')}"] if open_declared && literals.empty?

    errors = (values - literals).map { |value| "#{path}: does not accept #{value}" }
    errors += (literals - values).map { |value| "#{path}: lists #{value}, which the API lacks" }
    errors << "#{path}: also accepts any String, the API lists #{values.join(', ')}" if open_declared
    errors
  end

  def boolean_errors(schemas, types, path)
    return ["#{path}: declares a boolean the API lacks"] unless schemas
    return ["#{path}: should be a boolean"] unless types

    values = schemas.flat_map { |schema, _| schema['enum'] || [true, false] }.uniq.sort_by(&:to_s)
    declared = types.flat_map { |type| type.is_a?(RBS::Types::Literal) ? [type.literal] : [true, false] }.uniq.sort_by(&:to_s)
    return [] if values == declared

    ["#{path}: should be #{values.size == 2 ? 'bool' : values.first}, not #{declared.join(' | ')}"]
  end

  def array_errors(schemas, types, path)
    return ["#{path}: declares an Array the API lacks"] unless schemas
    return ["#{path}: should be an Array"] unless types
    return ["#{path}: the runner compares one declared Array, not #{types.size}"] if types.size > 1

    type = types.first
    # Arrays from merged branches (each event type's facts) hold any of their items.
    schema, refs = schemas.size == 1 ? schemas.first : merge_arrays(schemas)
    return tuple_errors(schema, type, path, refs) if schema['prefixItems']
    return ["#{path}: should be an Array, not a tuple"] if type.is_a?(RBS::Types::Tuple)

    walk(schema['items'] || {}, type.args[0], "#{path}[]", refs)
  end

  def merge_arrays(schemas)
    [{ 'items' => { 'anyOf' => schemas.map { |item, _| item['items'] || {} } } }, schemas.flat_map(&:last).uniq]
  end

  def tuple_errors(schema, type, path, refs)
    items = schema['prefixItems']
    return ["#{path}: should be a tuple of #{items.size}"] unless type.is_a?(RBS::Types::Tuple) && type.types.size == items.size

    items.zip(type.types).each_with_index.flat_map { |(item, member), index| walk(item, member, "#{path}[#{index}]", refs) }
  end

  # ---- Objects

  def object_errors(schemas, types, path, extras)
    return ["#{path}: declares a record the API lacks"] unless schemas
    return ["#{path}: should be a record"] unless types

    return types.flat_map { |type| record_errors(*schemas.first, type, path, extras) } if schemas.size == 1
    return record_errors(*merge(schemas), types.first, path, extras) if types.size == 1

    tag = tag_key(schemas)
    tag ? tagged_errors(schemas, types, tag, path, extras) : untagged_errors(schemas, types, path, extras)
  end

  # The key whose constant tells a union's branches apart: `type` (events, extracted text), `key`
  # (event facts), `kind` (category sources) or `status` (results by outcome).
  def tag_key(schemas)
    %w[type key kind status].find { |key| schemas.all? { |schema, refs| tag_of(schema, refs, key) } }
  end

  def tag_of(schema, refs, key)
    property = schema.dig('properties', key)
    return unless property

    flat = schema_flat(property, refs)
    flat.branches.first[0]['enum'].first if flat != :recursive && flat.branches.size == 1 && flat.branches.first[0]['enum']&.size == 1
  end

  # The tag values a declared record lists; a record may stand for several branches.
  def declared_tags(type, key)
    field = type.is_a?(RBS::Types::Record) && type.all_fields[DeclaredTypes.key_for(key, type)]
    members = field ? declared_flat(field[0]).branches : []
    members.filter_map { |member| member.literal.to_s if member.is_a?(RBS::Types::Literal) }
  end

  # Each declared record against the API branches whose tags it lists, merged when it lists several.
  def tagged_errors(schemas, types, key, path, extras)
    covered = []
    errors = types.flat_map do |type|
      tags = declared_tags(type, key)
      branches = schemas.select { |schema, refs| tags.include?(tag_of(schema, refs, key)) }
      next ["#{path}<#{tags.join('|')}>: not in the API"] if branches.empty?

      covered.concat(branches)
      label = "#{path}<#{branches.map { |schema, refs| tag_of(schema, refs, key) }.join('|')}>"
      record_errors(*(branches.size == 1 ? branches.first : merge(branches)), type, label, extras)
    end
    errors + (schemas - covered).map { |schema, refs| "#{path}<#{tag_of(schema, refs, key)}>: missing" }
  end

  def untagged_errors(schemas, types, path, extras)
    attempts = schemas.map { |schema, refs| types.map { |type| record_errors(schema, refs, type, path, extras) } }
    errors = attempts.each_with_index.flat_map do |results, index|
      results.any?(&:empty?) ? [] : ["#{path}: no declared record matches API branch #{index + 1}"] + results.min_by(&:size)
    end
    unmatched = types.each_index.reject { |index| attempts.any? { |results| results[index].empty? } }
    errors + unmatched.map { |index| "#{path}: declares a record the API lacks: #{types[index]}" }
  end

  # The branches of a union of objects as one object (see the class comment).
  def merge(schemas)
    names = schemas.flat_map { |schema, _| (schema['properties'] || {}).keys }.uniq
    properties = names.to_h do |name|
      branches = schemas.filter_map { |schema, _| schema.dig('properties', name) }.uniq
      [name, branches.size == 1 ? branches.first : { 'anyOf' => branches }]
    end
    required = names.select { |name| schemas.all? { |schema, _| Array(schema['required']).include?(name) } }
    [{ 'type' => 'object', 'properties' => properties, 'required' => required }, schemas.flat_map(&:last).uniq]
  end

  def record_errors(schema, refs, type, path, extras = [])
    properties = schema['properties']
    additional = schema['additionalProperties']
    if properties.nil? || properties.empty?
      return [] if additional.nil? || additional == {} # An open record: any declared object fits.

      return map_errors(schema, refs, type, path)
    end
    return ["#{path}: should be a record with fields #{properties.keys.join(', ')}"] unless type.is_a?(RBS::Types::Record)

    fields = type.all_fields
    required = Array(schema['required'])
    errors = properties.flat_map do |name, property|
      field = fields[DeclaredTypes.key_for(name, type)]
      next ["#{path}.#{name}: missing"] unless field

      required_errors(property, required.include?(name), field[1], "#{path}.#{name}") +
        walk(property, field[0], "#{path}.#{name}", refs)
    end
    undeclared = fields.keys - properties.keys.map { |name| DeclaredTypes.key_for(name, type) } - extras
    errors + undeclared.map { |key| "#{path}.#{key}: not in the API" }
  end

  def required_errors(property, required, declared_required, path)
    return [] if property == {} || required == declared_required # An open value's presence isn't typed.

    [required ? "#{path}: optional, the API requires it" : "#{path}: required, the API makes it optional"]
  end

  # A record of values keyed by any string, or by the `propertyNames` enum.
  def map_errors(schema, refs, type, path)
    names = schema.dig('propertyNames', 'enum')
    if type.is_a?(RBS::Types::Record)
      return ["#{path}: should be a Hash"] unless names

      keyed = { 'type' => 'object', 'properties' => names.to_h { |name| [name, schema['additionalProperties']] } }
      return record_errors(keyed, refs, type, path)
    end
    return ["#{path}: should be a Hash, not #{type}"] unless type.is_a?(RBS::Types::ClassInstance) && type.name.to_s == '::Hash'

    key_type, value_type = type.args
    key_schema = names ? { 'type' => 'string', 'enum' => names } : { 'type' => 'string' }
    walk(key_schema, key_type, "#{path}{key}", refs) + walk(schema['additionalProperties'], value_type, "#{path}{}", refs)
  end
end
