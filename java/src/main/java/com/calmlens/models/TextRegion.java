package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * A text region found by OCR.
 */
public final class TextRegion extends CalmLensObject {
  @Required private BoundingBox box;
  @Required private Boolean personalInformation;

  private TextRegion() {}

  /** @return where the text is in the image */
  public BoundingBox getBox() { return required(box, "box"); }

  /** @return whether the region holds personal information */
  public boolean getPersonalInformation() { return required(personalInformation, "personalInformation"); }
}
