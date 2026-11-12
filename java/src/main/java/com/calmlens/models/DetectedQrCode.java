package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * A QR code found in an image.
 */
public final class DetectedQrCode extends CalmLensObject {
  @Required private String value;
  @Required private BoundingBox box;

  private DetectedQrCode() {}

  /** @return the decoded value */
  public String getValue() { return required(value, "value"); }

  /** @return where the code is in the image */
  public BoundingBox getBox() { return required(box, "box"); }
}
