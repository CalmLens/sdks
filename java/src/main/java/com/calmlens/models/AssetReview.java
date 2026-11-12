package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * One reviewer decision in an asset's review history.
 */
public final class AssetReview extends CalmLensObject {
  @Required private String id;
  @Required private AssetModerationDecision decision;
  private String note;
  @Required private ReviewDecider decidedBy;
  @Required @JsonAdapter(EpochMillis.class) private Instant reviewedAt;
  @Required private Boolean applied;

  private AssetReview() {}

  /** @return id */
  public String getId() { return required(id, "id"); }

  /** @return the reviewer's decision */
  public AssetModerationDecision getDecision() { return required(decision, "decision"); }

  /** @return why the reviewer decided this; empty when the API sends none */
  public Optional<String> getNote() { return Optional.ofNullable(note); }

  /** @return who made the decision */
  public ReviewDecider getDecidedBy() { return required(decidedBy, "decidedBy"); }

  /** @return reviewedAt */
  public Instant getReviewedAt() { return required(reviewedAt, "reviewedAt"); }

  /** @return whether the decision was applied to the asset */
  public boolean getApplied() { return required(applied, "applied"); }
}
