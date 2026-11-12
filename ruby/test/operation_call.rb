# frozen_string_literal: true

# Calls a client method the way the shared fixtures name it: a JavaScript operation such as
# `hashLists.addEntry` with JavaScript (camelCase) options. The Ruby method takes its path IDs as
# arguments and the other options as snake_case keywords, so the IDs the method declares move out
# of the options. Iterator operations (`assets.iterate`) call the list and page through it.
module OperationCall
  def snake_name(name) = name.to_s.gsub(/([a-z\d])([A-Z])/, '\1_\2').downcase

  # Every key as a snake_case Symbol, except inside `metadata`, whose keys are the caller's.
  def snake_keys(value)
    case value
    when Hash then value.to_h { |key, item| [snake_name(key).to_sym, key.to_s == 'metadata' ? item : snake_keys(item)] }
    when Array then value.map { |item| snake_keys(item) }
    else value
    end
  end

  # The list behind an iterator capability: `assets.iterateChildren` lists with `assets.listChildren`.
  def list_operation(operation)
    *resources, method = operation.split('.')
    [*resources, method.sub(/\Aiterate/, 'list')].join('.')
  end

  # Calls `operation` on `client` with fixture `options`. `nested: :snake` also writes nested option
  # names in snake_case, as Ruby callers do; otherwise they keep the API's camelCase.
  def call_operation(client, operation, options, nested: :camel, &)
    *resources, method = operation.split('.')
    target = resources.reduce(client) { |value, resource| value.public_send(snake_name(resource)) }
    name = snake_name(method)
    return target.public_send(name, &) if options.nil?
    return target.public_send(name, options, &) unless options.is_a?(Hash)

    keywords = options.to_h do |key, item|
      [snake_name(key).to_sym, nested == :snake && key.to_s != 'metadata' ? snake_keys(item) : item]
    end
    if keywords.key?(:idempotency_key)
      keywords[:request_options] = { idempotency_key: keywords.delete(:idempotency_key) }.merge(keywords.fetch(:request_options, {}))
    end
    parameters = target.class.instance_method(name).parameters
    positional = parameters.filter_map { |kind, parameter| parameter if %i[req opt].include?(kind) }
    arguments = positional.map { |parameter| keywords.delete(parameter) }
    target.public_send(name, *arguments, **keywords, &)
  end
end
