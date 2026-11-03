# frozen_string_literal: true

module CalmLens
  # Moderation policies belong to the project's organisation and its projects share them. Every
  # change sends the policy's `revision`, so a policy changed since is refused with
  # `policy/revision-conflict`. Through a project's key you can change only policies no other
  # project uses or owns. Reach it through {ServerClient#policies}.
  class Policies < Resource
    # Lists the organisation's policies, oldest first, and the ID of the one the project uses.
    # @return [Hash] `policies` and `projectPolicyId`
    def list(options = {})
      call(options) { |_api, request| request('GET', project('policies'), request_options: request) }
    end

    # @option options [String] :policy_id
    # @return [Hash] the policy
    def retrieve(options)
      call(options) { |api, request| request('GET', policy_path(api), request_options: request) }
    end

    # Creates a policy from `settings` (defining every category) with a `name`, or a copy of the
    # latest release of a built-in preset with `preset_id`. It moderates nothing until it is
    # assigned to a project or named on an upload preset.
    # @option options [String] :name required with `settings`; a preset copy defaults to its name
    # @option options [String] :description
    # @option options [Hash] :settings
    # @option options [String] :preset_id `general-community`, `children-platform`, `education-support`
    #   or `wholesome-community`
    # @return [Hash] the policy
    def create(options)
      call(options) { |api, request| request('POST', project('policies'), body: api, request_options: request) }
    end

    # Changes the name, description or settings (complete, defining every category); later
    # moderation uses them. Saving a policy that follows automatic updates pins it as a copy.
    # @option options [String] :policy_id
    # @option options [Integer] :revision the policy's current revision
    # @option options [String] :name
    # @option options [String] :description
    # @option options [Hash] :settings
    # @return [Hash] the policy
    def update(options)
      call(options) do |api, request|
        request('PATCH', policy_path(api), body: without(api, 'policyId'), request_options: request)
      end
    end

    # Resets a preset copy to its pinned preset version, or updates an unchanged copy to the latest
    # preset release.
    # @option options [String] :policy_id
    # @option options [String] :operation `reset` or `update`
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version `preset.version` to reset, `preset.latestVersion` to update
    # @return [Hash] the policy
    def apply_preset(options)
      call(options) do |api, request|
        request('POST', "#{policy_path(api)}/preset", body: without(api, 'policyId'), request_options: request)
      end
    end

    # Switches automatic updates on or off for the project's preset policy. Switching on replaces
    # the saved copy with the latest preset settings under the same ID; switching off pins the
    # current preset version as a copy with unchanged settings.
    # @option options [String] :policy_id
    # @option options [Boolean] :enabled
    # @option options [Integer] :revision the policy's current revision
    # @option options [Integer] :preset_version the preset's `latestVersion`
    # @return [Hash] the policy
    def set_automatic_updates(options) # rubocop:disable Naming/AccessorMethodName -- the shared SDK surface name
      call(options) do |api, request|
        request('PUT', "#{policy_path(api)}/automatic-updates", body: without(api, 'policyId'), request_options: request)
      end
    end

    # Deletes a policy that no project or upload preset uses.
    # @option options [String] :policy_id
    # @return [nil]
    def delete(options)
      call(options) do |api, request|
        request('DELETE', policy_path(api), request_options: request)
        nil
      end
    end

    # Chooses the policy the project moderates with. Later uploads use it, except those through an
    # upload preset that names its own policy.
    # @option options [String] :policy_id
    # @return [Hash] the policy
    def assign(options)
      call(options) { |api, request| request('PUT', project('policy'), body: api, request_options: request) }
    end

    private

    def policy_path(api) = project("policies/#{Internal.segment(api['policyId'])}")
  end
end
