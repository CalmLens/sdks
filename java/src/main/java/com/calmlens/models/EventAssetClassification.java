package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * 
 */
public final class EventAssetClassification extends CalmLensObject {
  @Required private AssetClassificationStatus status;
  @Required private Boolean testInput;
  @Required private EventAssetModeration moderation;

  private EventAssetClassification() {}

  /** @return the asset's classification status */
  public AssetClassificationStatus getStatus() { return required(status, "status"); }

  /** @return whether the results came from one of the project's test inputs rather than analysing the content; never use test results, such as age ranges, for real decisions */
  public boolean getTestInput() { return required(testInput, "testInput"); }

  /** @return the moderation decision at the time */
  public EventAssetModeration getModeration() { return required(moderation, "moderation"); }
}
