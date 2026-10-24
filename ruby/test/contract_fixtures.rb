# frozen_string_literal: true

require 'json'

# The one loader of the shared SDK contract fixtures in testdata (packages/sdk-contract/README.md,
# "Runners"). contract_test.rb, contract_client_test.rb and contract_webhooks_test.rb each replay
# their own fixtures and read them through it.
module ContractFixtures
  DIR = File.expand_path('../testdata', __dir__)

  # The parsed testdata/<name>.json.
  def fixture(name) = JSON.parse(File.read("#{DIR}/#{name}.json", encoding: 'UTF-8'))
end
