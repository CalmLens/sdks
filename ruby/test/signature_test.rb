# frozen_string_literal: true

require 'minitest/autorun'
require 'rbs'
require 'calmlens'
require 'calmlens/testing'

# The RBS signatures in sig/ must resolve and cover the public API that the gem defines.
class SignatureTest < Minitest::Test
  PUBLIC_CLASSES = %w[ServerClient Assets Folders HashLists Text Events CDN Response Error WebhookEvent MockServerClient
                      MockServerClient::Request Transport::Request Transport::NetHTTP].freeze

  def self.environment
    @environment ||= begin
      loader = RBS::EnvironmentLoader.new
      loader.add(path: Pathname(File.expand_path('../sig', __dir__)))
      RBS::Environment.from_loader(loader).resolve_type_names
    end
  end

  def builder = RBS::DefinitionBuilder.new(env: self.class.environment)
  def type_name(name) = RBS::TypeName.parse("::CalmLens::#{name}")

  def test_every_public_method_has_a_signature
    PUBLIC_CLASSES.each do |name|
      klass = CalmLens.const_get(name)
      defined = klass.public_instance_methods(false) - Object.public_instance_methods
      defined -= Struct.new(:x).public_instance_methods(false) if klass < Struct
      declared = builder.build_instance(type_name(name)).methods.keys
      assert_empty defined - declared - %i[inspect pretty_print], "#{name} methods without a signature"
    end
    declared = builder.build_singleton(RBS::TypeName.parse('::CalmLens')).methods.keys
    assert_empty CalmLens.singleton_methods - declared, 'CalmLens module functions without a signature'
  end

  def test_signatures_resolve_every_type_they_name
    env = self.class.environment
    validator = RBS::Validator.new(env: env)
    env.type_alias_decls.each do |name, entry|
      validator.validate_type(entry.decl.type, context: nil) if name.namespace.path.first == :CalmLens
    end
    PUBLIC_CLASSES.each do |name|
      builder.build_instance(type_name(name)).methods.each_value do |method|
        method.method_types.each { |method_type| method_type.each_type { |type| validator.validate_type(type, context: nil) } }
      end
    end
  end

  def test_error_code_constants_match_the_generated_module
    declared = self.class.environment.constant_decls.keys
                   .select { |name| name.namespace.to_s == '::CalmLens::ErrorCodes::' }.map(&:name)
    assert_equal CalmLens::ErrorCodes.constants.sort, declared.sort
  end
end
