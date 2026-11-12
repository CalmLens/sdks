package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * 
 */
public final class EventAssetModeration extends CalmLensObject {
  private AssetModerationDecision decision;

  private EventAssetModeration() {}

  // NOTE: no facts (not in types.json)
  /** @return the moderation decision in force; empty when the API sends none */
  public Optional<AssetModerationDecision> getDecision() { return Optional.ofNullable(decision); }
}
