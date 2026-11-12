package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * Turns one optional feature on or off. Link detection runs unless {@code enabled} is false; the
 * other features are off unless it is true.
 */
public final class FeatureOptions extends CalmLensObject {
  @Required private Boolean enabled;

  private FeatureOptions() {}

  /** @return whether the feature runs */
  public boolean getEnabled() { return required(enabled, "enabled"); }

}
