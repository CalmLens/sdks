# frozen_string_literal: true

module CalmLens
  # Moderation policies belong to the API key's organisation and its projects share them. Every
  # change sends the policy's `revision`, so a policy changed since is refused with
  # `policy/revision-conflict`. Through a project's key you can change only policies no other
  # project uses. Reach it through {ServerClient#policies}.
  class Policies < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'policies'

    # Lists one page of the organisation's policies, oldest first unless `sort` says otherwise.
    # @option options [String] :cursor the previous page's `nextCursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `createdAt` by default
    # @return [Hash] a cursor page: items, nextCursor and hasMore.
    def list(options = {})
      call(options, __method__) do |api, request|
        cursor_page(request('GET', '/policies', query: api, request_options: request), 'policy')
      end
    end

    # Iterates every policy of the organisation, fetching pages as needed.
    # @param options [Hash] the options of {#list}; `cursor` sets the starting position.
    # @yieldparam policy [Hash]
    # @return [Enumerator, nil] an Enumerator when no block is given.
    def each(options = {}, &block)
      return enum_for(:each, options) unless block

      each_item(options, __method__, method(:list), &block)
    end

    # @option options [String] :policy_id
    # @return [Hash] the policy
    def retrieve(options)
      call(options, __method__) { |api, request| request('GET', policy_path(api), request_options: request) }
    end

    # The policy the project moderates with.
    # @return [Hash] the policy
    def retrieve_assigned(options = {})
      call(options, __method__) { |_api, request| request('GET', project('policy'), request_options: request) }
    end

    # Creates a policy from `settings` (defining every category) with a `name`, or a copy of the
    # latest release of a built-in preset with `preset_id`. It moderates nothing until it is
    # assigned to a project or named on an upload preset.
    # @option options [String] :name required with `settings`; a preset copy defaults to its name
    # @option options [String] :description
    # @option options [Hash] :settings `categorySettings` with every category, each with its
    #   `action`, `allowances` and `restrictions`
    # @option options [String] :preset_id `general-community`, `children-platform`, `education-support`
    #   or `wholesome-community`
    # @return [Hash] the policy
    def create(options)
      call(options, __method__) { |api, request| request('POST', '/policies', body: api, request_options: request) }
    end

    # Changes the name, description or settings (complete, defining every category); later
    # moderation uses them. Saving a `live` policy pins it.
    # @option options [String] :policy_id
    # @option options [Integer] :revision the policy's current revision
    # @option options [String] :name
    # @option options [String] :description
    # @option options [Hash] :settings
    # @return [Hash] the policy
    def update(options)
      call(options, __method__) do |api, request|
        request('PATCH', policy_path(api), body: without(api, 'policyId'), request_options: request)
      end
    end

    # Restores the settings of the preset release a `pinned` or `copy` policy is pinned to.
    # @option options [String] :policy_id
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version the pinned `preset.version` you reviewed
    # @return [Hash] the policy
    def reset(options)
      call(options, __method__) do |api, request|
        request('POST', "#{policy_path(api)}/reset", body: without(api, 'policyId'), request_options: request)
      end
    end

    # Moves an unchanged `pinned` or `copy` policy to the latest release of its preset.
    # @option options [String] :policy_id
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version the `preset.latestVersion` you reviewed
    # @return [Hash] the policy
    def upgrade(options)
      call(options, __method__) do |api, request|
        request('POST', "#{policy_path(api)}/upgrade", body: without(api, 'policyId'), request_options: request)
      end
    end

    # Switches automatic updates on (mode `live`) or off (mode `pinned`) for the organisation's own
    # preset policy. Switching on replaces the saved settings with the latest preset settings under
    # the same ID; switching off pins the current preset version with unchanged settings.
    # @option options [String] :policy_id
    # @option options [Boolean] :enabled
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version the preset's `latestVersion`
    # @return [Hash] the policy
    def set_automatic_updates(options) # rubocop:disable Naming/AccessorMethodName -- the shared SDK surface name
      call(options, __method__) do |api, request|
        request('PUT', "#{policy_path(api)}/automatic-updates", body: without(api, 'policyId'), request_options: request)
      end
    end

    # Deletes a policy that no project or upload preset uses.
    # @option options [String] :policy_id
    # @return [nil]
    def delete(options)
      call(options, __method__) do |api, request|
        request('DELETE', policy_path(api), request_options: request)
        nil
      end
    end

    # Chooses the policy the project moderates with. Later uploads use it, except those through an
    # upload preset that names its own policy.
    # @option options [String] :policy_id
    # @return [Hash] the policy
    def assign(options)
      call(options, __method__) { |api, request| request('PUT', project('policy'), body: api, request_options: request) }
    end

    private

    def policy_path(api) = "/policies/#{Internal.segment(api['policyId'])}"
  end
end
