package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * A detected person.
 */
public final class DetectedPerson extends CalmLensObject {
  @Required private BoundingBox box;
  @Required private Double confidence;

  private DetectedPerson() {}

  /** @return where the person is in the image */
  public BoundingBox getBox() { return required(box, "box"); }

  /** @return detection confidence from 0 to 1 */
  public double getConfidence() { return required(confidence, "confidence"); }
}
