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
    # @option options [String] :cursor the previous page's `next_cursor`
    # @option options [Integer] :page_size 1 to 100, default 50
    # @option options [String] :sort `createdAt` and `id`, comma-separated, descending when prefixed
    #   with `-`; `createdAt` by default
    # @return [PolicyPage] {Page#auto_paging_each} fetches the rest.
    def list(**options)
      call(options, __method__) do |api, request|
        page(PolicyPage, request('GET', '/policies', query: api, request_options: request), options) { list(**_1) }
      end
    end

    # @param policy_id [String]
    # @return [Policy]
    def retrieve(policy_id, **options)
      call(with_ids(options, policy_id: policy_id), __method__) do |api, request|
        build(Policy, request('GET', policy_path(api), request_options: request))
      end
    end

    # The policy the project moderates with.
    # @return [Policy]
    def retrieve_assigned(**options)
      call(options, __method__) { |_api, request| build(Policy, request('GET', project('policy'), request_options: request)) }
    end

    # Creates a policy from `settings` (defining every category) with a `name`, or a copy of the
    # latest release of a built-in preset with `preset_id`. It moderates nothing until it is
    # assigned to a project or named on an upload preset.
    # @option options [String] :name required with `settings`; a preset copy defaults to its name
    # @option options [String] :description
    # @option options [Hash, PolicySettings] :settings `category_settings` with every category, each
    #   with its `action`, `allowances` and `restrictions`, or another policy's `settings`
    # @option options [String] :preset_id `general-community`, `children-platform`, `education-support`
    #   or `wholesome-community`
    # @return [Policy]
    def create(**options)
      call(options, __method__) { |api, request| build(Policy, request('POST', '/policies', body: api, request_options: request)) }
    end

    # Changes the name, description or settings (complete, defining every category); later
    # moderation uses them. Saving a `live` policy pins it.
    # @param policy_id [String]
    # @option options [Integer] :revision the policy's current revision
    # @option options [String] :name
    # @option options [String] :description
    # @option options [Hash] :settings
    # @return [Policy]
    def update(policy_id, **options)
      call(with_ids(options, policy_id: policy_id), __method__) do |api, request|
        build(Policy, request('PATCH', policy_path(api), body: without(api, 'policyId'), request_options: request))
      end
    end

    # Restores the settings of the preset release a `pinned` or `copy` policy is pinned to.
    # @param policy_id [String]
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version the pinned `preset.version` you reviewed
    # @return [Policy]
    def reset(policy_id, **options)
      call(with_ids(options, policy_id: policy_id), __method__) do |api, request|
        build(Policy, request('POST', "#{policy_path(api)}/reset", body: without(api, 'policyId'), request_options: request))
      end
    end

    # Moves an unchanged `pinned` or `copy` policy to the latest release of its preset.
    # @param policy_id [String]
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version the `preset.latestVersion` you reviewed
    # @return [Policy]
    def upgrade(policy_id, **options)
      call(with_ids(options, policy_id: policy_id), __method__) do |api, request|
        build(Policy, request('POST', "#{policy_path(api)}/upgrade", body: without(api, 'policyId'), request_options: request))
      end
    end

    # Switches automatic updates on (mode `live`) or off (mode `pinned`) for the organisation's own
    # preset policy. Switching on replaces the saved settings with the latest preset settings under
    # the same ID; switching off pins the current preset version with unchanged settings.
    # @param policy_id [String]
    # @option options [Boolean] :enabled
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version the preset's `latestVersion`
    # @return [Policy]
    def set_automatic_updates(policy_id, **options)
      call(with_ids(options, policy_id: policy_id), __method__) do |api, request|
        build(Policy, request('PUT', "#{policy_path(api)}/automatic-updates", body: without(api, 'policyId'), request_options: request))
      end
    end

    # Deletes a policy that no project or upload preset uses.
    # @param policy_id [String]
    # @return [nil]
    def delete(policy_id, **options)
      call(with_ids(options, policy_id: policy_id), __method__) do |api, request|
        request('DELETE', policy_path(api), request_options: request)
        nil
      end
    end

    # Chooses the policy the project moderates with. Later uploads use it, except those through an
    # upload preset that names its own policy.
    # @option options [String] :policy_id
    # @return [Policy]
    def assign(**options)
      call(options, __method__) { |api, request| build(Policy, request('PUT', project('policy'), body: api, request_options: request)) }
    end

    private

    def policy_path(api) = "/policies/#{Internal.segment(api['policyId'])}"
  end
end
