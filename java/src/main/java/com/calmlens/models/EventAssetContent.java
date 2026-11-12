package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * 
 */
public final class EventAssetContent extends CalmLensObject {
  @Required private AssetContentStatus status;

  private EventAssetContent() {}

  /** @return whether CalmLens held the content */
  public AssetContentStatus getStatus() { return required(status, "status"); }
}
