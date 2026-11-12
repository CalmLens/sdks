# frozen_string_literal: true

require 'json'

# The one loader of the shared SDK contract fixtures in testdata (packages/sdk-contract/README.md,
# "Runners"). contract_test.rb, contract_client_test.rb and contract_webhooks_test.rb each replay
# their own fixtures and read them through it.
module ContractFixtures
  DIR = File.expand_path('../testdata', __dir__)

  # The parsed testdata/<name>.json. A key given twice in one object fails rather than the last
  # one winning, so a duplicated scenario or detection key cannot pass as one field.
  def fixture(name) = JSON.parse(File.read("#{DIR}/#{name}.json", encoding: 'UTF-8'), allow_duplicate_key: false)

  # The Ruby class of each error kind (surface.json `errorKinds`) with its ancestors' classes,
  # nearest first: `not-found` → [NotFoundError, APIError, Error].
  def error_kind_classes
    kinds = fixture('surface')['errorKinds'].to_h { |kind| [kind['id'], kind] }
    kinds.transform_values do |kind|
      chain = []
      while kind
        chain << Object.const_get(kind['names']['ruby'])
        kind = kinds[kind['parent']]
      end
      chain
    end
  end

  # The Ruby method of each list iterator surface.json names, by operation: `hash_lists.each_entry`
  # for `hashLists.iterateEntries`. Events iterate by page (`events.each_page`).
  def iterators
    fixture('surface')['capabilities'].select { |capability| capability['id'].split('.').last.start_with?('iterate') }
                                      .to_h { |capability| [capability['id'], capability['names']['ruby']] }
  end
end
