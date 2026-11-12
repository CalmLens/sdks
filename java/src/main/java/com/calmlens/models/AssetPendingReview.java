package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * A review the human review queue is waiting for.
 */
public final class AssetPendingReview extends CalmLensObject {
  @Required private Long requestedAt;
  @Required private PendingReviewReason reason;
  @Required private List<ModerationCategory> uncertainCategories;

  private AssetPendingReview() {}

  /** @return when the asset joined the queue, in Unix milliseconds */
  public long getRequestedAt() { return required(requestedAt, "requestedAt"); }

  /** @return {@code sampled} or {@code uncertain} */
  public PendingReviewReason getReason() { return required(reason, "reason"); }

  /** @return the categories that made the decision uncertain; empty for a sampled decision */
  public List<ModerationCategory> getUncertainCategories() { return required(uncertainCategories, "uncertainCategories"); }
}
