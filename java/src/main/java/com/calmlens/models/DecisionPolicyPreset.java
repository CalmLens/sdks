package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * The built-in preset release a decision's policy used.
 */
public final class DecisionPolicyPreset extends CalmLensObject {
  @Required private PolicyPresetId id;
  @Required private Integer version;

  private DecisionPolicyPreset() {}

  /** @return the preset's ID */
  public PolicyPresetId getId() { return required(id, "id"); }

  /** @return the preset release */
  public int getVersion() { return required(version, "version"); }
}
