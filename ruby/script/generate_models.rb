# frozen_string_literal: true

# Writes the result models (lib/calmlens/models.rb) and their signatures (sig/models.rbs) from the
# API's schemas in testdata/types.json. Run it after regenerating types.json:
#
#   ruby script/generate_models.rb
#
# test/type_contract_test.rb fails when the committed files differ from what it writes.

require 'json'
require 'rbs'
require_relative '../lib/calmlens'

module CalmLens
  # Builds the model classes: one per object schema, nested under the class that first uses it,
  # with a union of objects (event types, results by `status`) merged into one class.
  class ModelGenerator
    ROOT = File.expand_path('..', __dir__)

    # The class of each operation's result. Operations returning the same schema share its class.
    RESULTS = {
      'folders.list' => 'FolderPage', 'folders.retrieve' => 'Folder',
      'assets.create' => 'Asset', 'assets.list' => 'AssetPage', 'assets.search' => 'AssetSearchResult',
      'assets.listTimeline' => 'AssetTimelinePage', 'assets.batch' => 'AssetBatch',
      'cdn.signAssetUrl' => 'SignedAssetUrl',
      'lenses.list' => 'LensPage', 'lenses.create' => 'Lens',
      'events.list' => 'EventPage',
      'hashLists.list' => 'HashListPage', 'hashLists.retrieve' => 'HashList',
      'hashLists.listEntries' => 'HashListEntryPage', 'hashLists.addEntry' => 'HashListEntry',
      'policies.list' => 'PolicyPage', 'policies.retrieve' => 'Policy',
      'uploadPresets.list' => 'UploadPresetPage', 'uploadPresets.ensure' => 'UploadPresetsEnsured',
      'projectSettings.get' => 'ProjectSettingsResource', 'metadataFields.list' => 'MetadataFieldsResource'
    }.freeze

    # Class names for fields whose derived name (parent class + field) would mislead:
    # `Parent::Class.field` => name. A name without `::` is a top-level class.
    NAMES = {
      'AssetTimelinePage.items' => 'MediaSegment',
      'Asset.classification' => 'Classification',
      'Classification.moderation' => 'Moderation',
      'Moderation.categories' => 'CategoryPolicyScore',
      'CategoryPolicyScore.settings' => 'CategoryPolicySettings',
      'CategoryPolicySettings.allowances' => 'PolicyRule',
      'Policy.settings' => 'PolicySettings',
      'PolicySettings.categorySettings' => 'CategorySettings',
      'CategorySettings.sexual' => 'CategoryPolicySettings',
      'Moderation::Raw.categories' => 'CategoryReports',
      'CategoryReports.sexual' => 'CategoryReport',
      'CategoryReport.qualifiers' => 'QualifierResult',
      'Classification::PersonDetection.people' => 'Classification::PersonDetection::Person',
      'Asset.metadata' => 'MetadataItem',
      'Asset::Content.metadata' => 'Asset::Content::FileMetadata',
      'UploadPreset::ProcessingOptions::Features.ocr' => 'UploadPreset::ProcessingOptions::Feature'
    }.freeze

    # Names for enums longer than LONG_ENUM that sig/types.rbs has no alias for, by their first value.
    # models.rbs declares them as type aliases.
    ENUMS = {
      'sexual-pornographic-media' => 'moderation_qualifier',
      'asset.uploaded' => 'event_type',
      'asset-name' => 'event_fact_key'
    }.freeze
    LONG_ENUM = 10

    def self.write
      types = JSON.parse(File.read(File.join(ROOT, 'testdata/types.json'), encoding: 'UTF-8'))
      ruby, rbs = new(types).sources
      File.write(File.join(ROOT, 'lib/calmlens/models.rb'), ruby)
      File.write(File.join(ROOT, 'sig/models.rbs'), rbs)
    end

    def initialize(types)
      @definitions = types['definitions']
      @operations = types['operations']
      @aliases = literal_aliases(File.read(File.join(ROOT, 'sig/types.rbs'), encoding: 'UTF-8'))
      @classes = {}
      @names = {}
      @enums = {}
    end

    # The generated Ruby and RBS sources.
    def sources
      @operations.each do |operation|
        next unless operation['result']

        hint = RESULTS.fetch(operation['id']) { existing(operation['result']) || raise("Name the result of #{operation['id']}") }
        build(objects(operation['result']), hint, page: hint.end_with?('Page'))
      end
      ordered = @classes.values.sort_by { |model| [model[:name].count(':'), model[:name]] }
      [ruby_source(ordered), rbs_source(ordered)]
    end

    private

    def existing(schema) = @names[key(objects(schema))]

    # ---- Schemas

    def resolve(schema, refs = [])
      while schema.key?('$ref')
        name = schema['$ref'].delete_prefix('#/definitions/')
        return [nil, refs] if refs.include?(name)

        refs += [name]
        schema = @definitions.fetch(name)
      end
      [schema, refs]
    end

    # The non-null branches of a schema, with whether it allows null. A branch that refers back to
    # one it is inside is open.
    def flatten(schema, refs = [], acc = { branches: [], nullable: false })
      schema, refs = resolve(schema, refs)
      return acc.tap { acc[:branches] << {} } unless schema

      if (union = schema['anyOf'] || schema['oneOf'])
        union.each { |branch| flatten(branch, refs, acc) }
        return acc
      end
      values = schema.key?('const') ? [schema['const']] : schema['enum']
      if values
        acc[:nullable] ||= values.include?(nil)
        acc[:branches] << { 'enum' => values.compact, 'refs' => refs } unless values.compact.empty?
      elsif schema['type'].nil?
        acc[:branches] << {}
      else
        types = Array(schema['type'])
        acc[:nullable] ||= types.include?('null')
        (types - ['null']).each { |type| acc[:branches] << schema.merge('type' => type, 'refs' => refs) }
      end
      acc
    end

    def kind(branch)
      return branch['type'] if branch['type']
      return 'open' unless branch['enum']

      case branch['enum'].first
      when true, false then 'boolean'
      when Integer then 'integer'
      else 'string'
      end
    end

    def objects(schema) = flatten(schema)[:branches].select { |branch| branch['type'] == 'object' }

    # The identity of a set of object branches. Each operation has its own copy of the recursive
    # JSON value schema (`<operation>.__schema0`), so those references count as one.
    def key(branches)
      branches.map { |branch| JSON.generate(canonical(branch.except('refs'))).gsub(%r{"#/definitions/[^"]+\.__schema\d+"}, '"json"') }
              .sort.join("\n")
    end

    # A schema with its keys (and `required`) sorted, so property order doesn't matter.
    def canonical(value)
      case value
      when Hash then value.sort.to_h { |name, item| [name, name == 'required' ? item.sort : canonical(item)] }
      when Array then value.map { |item| canonical(item) }
      else value
      end
    end

    # ---- Classes

    # The class of a set of object branches, built on first use.
    def build(branches, hint, page: false)
      key = key(branches)
      return @names[key] if @names.key?(key)

      name = hint
      raise "Two schemas are both named #{name}; add a NAMES entry\n#{key}\n#{key(@classes[name][:branches])}" if @classes.key?(name)

      @names[key] = name
      model = @classes[name] = { name: name, page: page, fields: {}, branches: branches }
      merge(branches).each do |field, (schema, required)|
        model[:fields][field] = field_type(schema, *child_name(name, field), required)
      end
      model[:item] = model.dig(:fields, 'items', :item) if page
      name
    end

    # Each field of a union of objects: its schemas from every branch, required when all require it.
    def merge(branches)
      fields = branches.flat_map { |branch| (branch['properties'] || {}).keys }.uniq
      fields.to_h do |field|
        schemas = branches.filter_map { |branch| branch.dig('properties', field) }
        schemas = schemas.uniq { |schema| JSON.generate(schema) }
        required = branches.all? { |branch| Array(branch['required']).include?(field) }
        [field, [schemas.size == 1 ? schemas.first : { 'anyOf' => schemas }, required]]
      end
    end

    # A page's items are named after the page (`FolderPage` lists `Folder`s); other fields nest under
    # their class.
    # Returns the name and whether it is exact; an inexact name of a list field is made singular.
    def child_name(parent, field)
      return [NAMES["#{parent}.#{field}"], true] if NAMES.key?("#{parent}.#{field}")
      return [parent.delete_suffix('Page'), true] if parent.end_with?('Page') && field == 'items'

      ["#{parent}::#{camel(field)}", false]
    end

    def camel(field) = field.split(/[-_]/).map { |part| part[0].upcase + part[1..] }.join

    def singular(name)
      head, _, last = name.rpartition('::')
      last = if last.end_with?('ies') then "#{last[0...-3]}y"
             elsif last.end_with?('sses', 'ches', 'shes', 'xes') then last[0...-2]
             elsif last.end_with?('s') && !last.end_with?('ss', 'us', 'is') then last[0...-1]
             else last
             end
      head.empty? ? last : "#{head}::#{last}"
    end

    # ---- Fields: [conversion, RBS type, item class]

    def field_type(schema, hint, exact, required)
      conversion, type, item = value_type(schema, hint, exact: exact)
      nullable = flatten(schema)[:nullable] || !required
      { conversion: conversion, rbs: nullable ? optional(type) : type, item: item }
    end

    def value_type(schema, hint, exact: false)
      branches = flatten(schema)[:branches]
      kinds = branches.map { |branch| kind(branch) }
      return [nil, 'json_value'] if kinds.include?('open') || (%w[string number boolean array object] - kinds).empty?

      models = branches.select { |branch| branch['type'] == 'object' && branch['properties']&.any? }
      maps = branches.select { |branch| branch['type'] == 'object' && !branch['properties']&.any? }
      arrays = branches.select { |branch| branch['type'] == 'array' }
      structured = []
      structured << model_type(models, hint) if models.any?
      structured.concat(maps.map { |map| map_type(map, exact ? hint : singular(hint), exact) })
      structured << array_type(arrays, exact ? hint : singular(hint), exact) unless arrays.empty?
      conversion = structured.filter_map(&:first).first
      item = structured.filter_map { |entry| entry[2] }.first
      [conversion, (structured.map { |entry| entry[1] } + scalar_types(branches)).uniq.join(' | '), item]
    end

    def model_type(models, hint)
      name = build(models, hint)
      [[:model, "CalmLens::#{name}"], name]
    end

    # A record keyed by data: open values are any JSON; others convert each value.
    def map_type(map, hint, exact)
      values = map['additionalProperties']
      return [nil, 'Hash[String, json_value]'] if values.nil? || values == {} || values == true

      inner_conversion, inner_type = value_type(values, hint, exact: exact)
      [[:map, inner_conversion], "Hash[#{key_type(map['propertyNames'])}, #{inner_type}]"]
    end

    def array_type(arrays, hint, exact)
      items = arrays.map { |array| array['items'] || {} }
      inner_conversion, inner_type = value_type(items.size == 1 ? items.first : { 'anyOf' => items }, hint, exact: exact)
      [[:array, inner_conversion], "Array[#{inner_type}]", inner_type]
    end

    def key_type(names)
      values = names && names['enum']
      values ? literals(values) : 'String'
    end

    def scalar_types(branches)
      types = []
      strings = branches.select { |branch| kind(branch) == 'string' }
      if strings.any? { |branch| !branch['enum'] }
        types << 'String'
      elsif strings.any?
        types << literals(strings.flat_map { |branch| branch['enum'] }.uniq)
      end
      kinds = branches.map { |branch| kind(branch) }
      types << 'number' if kinds.include?('number')
      types << 'Integer' if kinds.include?('integer') && !kinds.include?('number')
      booleans = branches.select { |branch| kind(branch) == 'boolean' }.flat_map { |branch| branch['enum'] || [true, false] }.uniq
      types << (booleans.size == 2 ? 'bool' : booleans.first.to_s) unless booleans.empty?
      types
    end

    # An enum as the alias sig/types.rbs gives the same values, or as a literal union.
    def literals(values)
      @aliases.fetch(values.sort) do
        next values.map(&:inspect).join(' | ') if values.size <= LONG_ENUM

        name = ENUMS.fetch(values.first) { raise "Name the enum starting #{values.first} in ENUMS" }
        @enums[name] = values
        name
      end
    end

    def optional(type) = type.include?(' ') ? "(#{type})?" : "#{type}?"

    # The type aliases in sig/types.rbs that list String literals, by their sorted values.
    def literal_aliases(source)
      _, _, declarations = RBS::Parser.parse_signature(source)
      decls = declarations.flat_map { |declaration| declaration.respond_to?(:members) ? declaration.members : [declaration] }
                          .grep(RBS::AST::Declarations::TypeAlias)
      types = decls.to_h { |decl| [decl.name.name.to_s, decl.type] }
      values = types.transform_values { |type| literal_values(type, types) }
      values.compact.each_with_object({}) { |(name, list), map| map[list.sort] ||= name }
    end

    def literal_values(type, types, seen = [])
      case type
      when RBS::Types::Literal then type.literal.is_a?(String) ? [type.literal] : nil
      when RBS::Types::Union
        lists = type.types.map { |member| literal_values(member, types, seen) }
        lists.all? ? lists.flatten.uniq : nil
      when RBS::Types::Alias
        name = type.name.name.to_s
        return nil if seen.include?(name) || !types.key?(name)

        literal_values(types[name], types, seen + [name])
      end
    end

    # ---- Output

    def reader?(model, field)
      base = model[:page] ? Page : Model
      !base.method_defined?(Model.field_name(field).to_sym)
    end

    def ruby_source(models)
      lines = ['# frozen_string_literal: true', '',
               '# Generated by script/generate_models.rb from testdata/types.json; do not edit.', 'module CalmLens']
      # Every class first, so a declaration can name any of them.
      declarations = []
      models.each do |model|
        lines << "  class #{model[:name]} < #{model[:page] ? 'Page' : 'Model'}; end"
        fields = model[:fields].map do |field, type|
          "    #{Model.field_name(field)}: [#{field.inspect}, #{type[:conversion].inspect}]"
        end
        declarations << '' << "  #{model[:name]}.declare(" << fields.join(",\n") << '  )'
      end
      lines.concat(declarations)
      lines << 'end' << ''
      lines.join("\n")
    end

    def rbs_source(models)
      lines = ['# Generated by script/generate_models.rb from testdata/types.json; do not edit.', 'module CalmLens']
      @enums.each do |name, values|
        lines << "  type #{name} = #{values.map(&:inspect).join(' | ')}"
      end
      models.each do |model|
        parent = model[:page] ? "Page[#{model[:item]}]" : 'Model'
        lines << "  class #{model[:name]} < #{parent}"
        model[:fields].each do |field, type|
          next unless reader?(model, field)

          returned = type[:rbs].include?(' | ') && !type[:rbs].end_with?(')?') ? "(#{type[:rbs]})" : type[:rbs]
          lines << "    def #{Model.field_name(field)}: () -> #{returned}"
        end
        lines << '  end'
      end
      lines << 'end' << ''
      lines.join("\n")
    end
  end
end

CalmLens::ModelGenerator.write if $PROGRAM_NAME == __FILE__
