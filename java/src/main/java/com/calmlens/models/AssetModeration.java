package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Content-safety findings, policy assessment and reviewer decision.
 */
public final class AssetModeration extends CalmLensObject {
  private AssetModerationDecision decision;
  @Required private List<AssetReview> manualReviews;
  private AssetModerationDecision automatedStatus;
  private DecisionPolicy policy;
  private AssetPendingReview pendingReview;
  private ModerationSource source;
  private String rule;
  @Required private List<ModerationCategory> flaggedCategories;
  private LinkSafetyDecision linkSafety;
  @Required private List<RegionalDecision> regions;
  private Boolean explanationComplete;
  private Map<String, CategoryPolicyScore> categories;
  private ModerationRaw raw;
  private ModerationTimeline timeline;

  private AssetModeration() {}

  /** @return the moderation decision in force, which also decides delivery; empty when the API sends none */
  public Optional<AssetModerationDecision> getDecision() { return Optional.ofNullable(decision); }

  /** @return manualReviews */
  public List<AssetReview> getManualReviews() { return required(manualReviews, "manualReviews"); }

  /** @return the policy's own outcome before any reviewer decision: {@code allowed}, {@code limited}, {@code age-restricted}, {@code blocked} or {@code purged}; null before a decision; empty when the API sends none */
  public Optional<AssetModerationDecision> getAutomatedStatus() { return Optional.ofNullable(automatedStatus); }

  /** @return the policy that made the automated decision, as it was then; null before a decision; empty when the API sends none */
  public Optional<DecisionPolicy> getPolicy() { return Optional.ofNullable(policy); }

  /** @return the review the human review queue is waiting for, set with the automated decision that joined the queue; null when no review is waiting; empty when the API sends none */
  public Optional<AssetPendingReview> getPendingReview() { return Optional.ofNullable(pendingReview); }

  /** @return source; empty when the API sends none */
  public Optional<ModerationSource> getSource() { return Optional.ofNullable(source); }

  /** @return rule; empty when the API sends none */
  public Optional<String> getRule() { return Optional.ofNullable(rule); }

  /** @return flaggedCategories */
  public List<ModerationCategory> getFlaggedCategories() { return required(flaggedCategories, "flaggedCategories"); }

  // NOTE: no facts (not in types.json)
  /** @return (preview) what the policy's link safety settings made of the asset's links; null when the policy doesn't act on links; empty when the API sends none */
  public Optional<LinkSafetyDecision> getLinkSafety() { return Optional.ofNullable(linkSafety); }

  /** @return the regions where the asset is restricted, each with its own status */
  public List<RegionalDecision> getRegions() { return required(regions, "regions"); }

  /** @return explanationComplete; empty when the API sends none */
  public Optional<Boolean> getExplanationComplete() { return Optional.ofNullable(explanationComplete); }

  /** @return categories; empty when the API sends none */
  public Optional<Map<String, CategoryPolicyScore>> getCategories() { return Optional.ofNullable(categories); }

  /** @return raw; empty when the API sends none */
  public Optional<ModerationRaw> getRaw() { return Optional.ofNullable(raw); }

  /** @return the audio or video asset's findings timeline, which {@code assets.listTimeline} pages through; null for other assets and before analysis; empty when the API sends none */
  public Optional<ModerationTimeline> getTimeline() { return Optional.ofNullable(timeline); }
}
