# frozen_string_literal: true

require_relative 'classification'

module CalmLens
  # A moderation decision for {MockServerClient}'s `moderate:` option or
  # {MockServerClient#complete_processing}, started with {.of}: flag the categories it found, with
  # their scores and qualifiers, mark the categories it couldn't assess, and leave it waiting for
  # human review. Each call checks its names and scores and raises `sdk/invalid-argument` for one
  # CalmLens doesn't have.
  #
  # @example
  #   CalmLens::MockDecision.of('blocked').flag('violence', 0.9, 'violence-threat' => 0.9).not_evaluated('profanity')
  #   CalmLens::MockDecision.of('limited').flag('violence', 0.5).pending_review('uncertain', ['violence'])
  class MockDecision
    # Where the mock's moderation leaves an upload: `pending` (still processing), `failed`
    # (processing failed, retryable), or a decision with that moderation status (`purged` also
    # removes the content).
    STATUSES = %w[pending failed allowed limited age-restricted blocked purged].freeze
    # The policy action that gives each decided status.
    STATUS_ACTIONS = { 'allowed' => 'allow', 'limited' => 'limit', 'age-restricted' => 'age-restrict', 'blocked' => 'block',
                       'purged' => 'purge' }.freeze
    private_constant :STATUS_ACTIONS
    # Why a decision waits for human review.
    PENDING_REVIEW_REASONS = %w[sampled uncertain].freeze
    private_constant :PENDING_REVIEW_REASONS

    # @return [String]
    attr_reader :status

    # Starts a decision with this status.
    # @param status [String] one of {STATUSES}
    # @return [MockDecision]
    def self.of(status) = new(status)

    # A `moderate:` answer or {MockServerClient#complete_processing} decision as a checked decision.
    # @api private
    def self.from(value)
      return value if value.is_a?(MockDecision)
      return new(value) if value.is_a?(String)

      raise Internal.invalid("A decision must be a status or a CalmLens::MockDecision (got #{value.inspect})")
    end

    # @param status [String] one of {STATUSES}
    # @raise [InvalidArgumentError] for an unknown status
    def initialize(status)
      raise Internal.invalid("status must be one of #{STATUSES.join(', ')} (got #{status.inspect})") unless STATUSES.include?(status)

      @status = status
      @flags = {}
      @not_evaluated = []
    end

    # Records findings in `category` with its `score` (0 to 1) and, optionally, scores for its
    # qualifiers, such as `{ 'violence-threat' => 0.9 }`. The policy acts on a category at 0.5 and
    # above, so `flaggedCategories` lists it there unless the status is `allowed`.
    # @param category [String]
    # @param score [Numeric]
    # @param qualifiers [Hash{String => Numeric}]
    # @return [self]
    # @raise [InvalidArgumentError] for an unknown category or qualifier, a score outside 0 to 1, a
    #   category already in the decision, or a `pending` or `failed` decision
    def flag(category, score, qualifiers = {})
      category = check_category(category)
      raise Internal.invalid("#{category}'s score must be from 0 to 1") unless score?(score)

      checked = qualifiers.to_h do |qualifier, qualifier_score|
        qualifier = qualifier.to_s
        known = MockClassification::QUALIFIERS[category].include?(qualifier)
        raise Internal.invalid("#{qualifier} is not a qualifier of #{category}") unless known
        raise Internal.invalid("#{qualifier}'s score must be from 0 to 1") unless score?(qualifier_score)

        [qualifier, qualifier_score]
      end
      @flags[category] = { score: score, qualifiers: checked }
      self
    end

    # Marks `category` as not assessed (`not-evaluated` for reason `not-supported`).
    # @param category [String]
    # @return [self]
    # @raise [InvalidArgumentError] like {#flag}
    def not_evaluated(category)
      @not_evaluated << check_category(category)
      self
    end

    # Leaves the decision waiting for human review, as `classification.moderation.pendingReview`
    # reports: `sampled`, or `uncertain` with the `uncertain_categories` that made it so.
    # {MockServerClient#decide} clears it; {Assets#decide} doesn't, as with the API.
    # @param reason [String] `sampled` or `uncertain`
    # @param uncertain_categories [Array<String>]
    # @return [self]
    # @raise [InvalidArgumentError] for a `pending` or `failed` decision, another reason, a `sampled`
    #   reason with uncertain categories, or an unknown category
    def pending_review(reason, uncertain_categories = [])
      raise Internal.invalid("a #{@status} decision can't wait for review") if undecided?

      reason = reason.to_s
      raise Internal.invalid("reason must be one of #{PENDING_REVIEW_REASONS.join(', ')}") unless PENDING_REVIEW_REASONS.include?(reason)
      raise Internal.invalid('uncertain_categories must be an Array') unless uncertain_categories.is_a?(Array)
      raise Internal.invalid('a sampled review has no uncertain categories') if reason == 'sampled' && !uncertain_categories.empty?

      @pending_review = { 'reason' => reason, 'uncertainCategories' => uncertain_categories.map { |category| known_category(category) } }
      self
    end

    # The report a decided asset gets, as the API sends it: every category (unflagged ones
    # evaluated with score 0), the policy's actions, the automated status and `flaggedCategories`.
    # @param requested_at [Integer] when a pending review joined the queue, in epoch milliseconds
    # @return [Hash{String => Object}, nil] `categories`, `score` and `policy`; nil for `pending` and `failed`
    def report(requested_at = 0)
      return if undecided?

      evaluated = (MockClassification::CATEGORIES - @not_evaluated).map { |category| [category, @flags.dig(category, :score) || 0] }
      { 'raw' => { 'categories' => MockClassification::CATEGORIES.to_h { |category| [category, category_report(category)] },
                   'hashMatches' => [] },
        'categories' => evaluated.to_h { |category, value| [category, policy_result(value)] },
        # The mock keeps no policies, so no policy is named.
        'explanationComplete' => true, 'policy' => nil, 'source' => 'policy', 'rule' => nil, 'automatedStatus' => @status,
        'pendingReview' => @pending_review && { 'requestedAt' => requested_at, **@pending_review },
        'regions' => [], 'linkSafety' => nil, 'flaggedCategories' => evaluated.reject { |_, value| action(value) == 'allow' }.map(&:first) }
    end

    def inspect = "#<#{self.class.name} #{@status}>"

    private

    def undecided? = %w[pending failed].include?(@status)

    def known_category(category)
      category = category.to_s
      raise Internal.invalid("#{category} is not a CalmLens category") unless MockClassification::CATEGORIES.include?(category)

      category
    end

    def check_category(category)
      category = known_category(category)
      raise Internal.invalid("a #{@status} decision has no findings") if undecided?
      raise Internal.invalid("#{category} is already in this decision") if @flags.key?(category) || @not_evaluated.include?(category)

      category
    end

    def score?(score) = score.is_a?(Numeric) && score.real? && score.finite? && score >= 0 && score <= 1

    def action(score) = @status != 'allowed' && score >= 0.5 ? STATUS_ACTIONS[@status] : 'allow'

    # A category's policy result. The mock keeps no policies: the category's setting is the
    # decision's own action.
    def policy_result(score)
      { 'score' => score, 'action' => action(score), 'source' => { 'kind' => score >= 0.5 ? 'default' : 'below-threshold' },
        'settings' => { 'action' => STATUS_ACTIONS[@status], 'allowances' => [], 'restrictions' => [] } }
    end

    # The API's likelihood for a score (ClassificationCategories.ts, scoreToLikelihood).
    def likelihood(score)
      if score >= 0.8 then 'very-likely'
      elsif score >= 0.6 then 'likely'
      elsif score >= 0.4 then 'possible'
      elsif score >= 0.2 then 'unlikely'
      else 'very-unlikely'
      end
    end

    def category_report(category)
      return { 'status' => 'not-evaluated', 'reason' => 'not-supported' } if @not_evaluated.include?(category)

      flag = @flags.fetch(category, { score: 0, qualifiers: {} })
      result = { 'status' => 'evaluated', 'likelihood' => likelihood(flag[:score]), 'score' => flag[:score] }
      unless flag[:qualifiers].empty?
        result['qualifiers'] = flag[:qualifiers].to_h do |qualifier, some|
          [qualifier, { 'status' => 'evaluated', 'someScore' => some, 'likelihood' => likelihood(some) }]
        end
      end
      result
    end
  end

  # What {MockServerClient}'s `moderate:` callback receives for each asset the mock moderates.
  #
  # - `asset` [Hash] the asset as stored, still processing (a copy).
  # - `content` [Content] the uploaded bytes and, for a `plaintext-document`, their text.
  # - `trigger` [String] why the mock is moderating it: `upload` (`assets.create`, `assets.classify`,
  #   `text.classify` or a final part), `retry` (`assets.retry`), `rerun` (`assets.explain` with
  #   `rerun: true`) or `complete` ({MockServerClient#complete_processing} without a decision).
  # - `queued` [Boolean] true when the API would queue the work rather than answer with the
  #   decision: queued uploads, retries, reruns and `complete`.
  MockModerationInput = Struct.new(:asset, :content, :trigger, :queued, keyword_init: true) do
    # @return [Boolean]
    def queued? = queued
  end

  # The content of a {MockModerationInput}: `bytes` is the uploaded bytes (binary; nil without
  # stored content, such as a website or removed content, and multipart parts joined in order),
  # and `text` is them decoded as UTF-8 for a `plaintext-document` (else nil).
  MockModerationInput::Content = Struct.new(:bytes, :text, keyword_init: true)
end
