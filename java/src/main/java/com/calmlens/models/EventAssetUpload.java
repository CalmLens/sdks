package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * 
 */
public final class EventAssetUpload extends CalmLensObject {
  @Required private UploadStatus status;

  private EventAssetUpload() {}

  /** @return the asset's classification status */
  public UploadStatus getStatus() { return required(status, "status"); }
}
