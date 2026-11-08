# frozen_string_literal: true

require 'minitest/autorun'
require 'calmlens'
require 'calmlens/testing'

# What the decision builder refuses beyond the shared scenarios.
class MockDecisionTest < Minitest::Test
  def test_pending_review_refuses_uncertain_categories_that_are_not_a_list
    error = assert_raises(CalmLens::InvalidArgumentError) { CalmLens::MockDecision.of('allowed').pending_review('uncertain', 'hate') }
    assert_equal 'sdk/invalid-argument', error.code
  end
end
