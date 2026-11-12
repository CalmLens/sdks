package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * Which automated decisions are sampled into the human review queue.
 */
public final class HumanReviewSettings extends CalmLensObject {
  @Required private Double allowedSamplePercent;
  @Required private Double restrictedSamplePercent;
  @Required private Double uncertaintyMarginPercent;
  @Required private Boolean reviewMissingEvidence;

  private HumanReviewSettings() {}

  /** @return percentage of allowed assets to sample */
  public double getAllowedSamplePercent() { return required(allowedSamplePercent, "allowedSamplePercent"); }

  /** @return percentage of restricted assets to sample */
  public double getRestrictedSamplePercent() { return required(restrictedSamplePercent, "restrictedSamplePercent"); }

  /** @return how close to a threshold a score queues the asset */
  public double getUncertaintyMarginPercent() { return required(uncertaintyMarginPercent, "uncertaintyMarginPercent"); }

  /** @return whether assets with missing evidence are queued */
  public boolean getReviewMissingEvidence() { return required(reviewMissingEvidence, "reviewMissingEvidence"); }

}
