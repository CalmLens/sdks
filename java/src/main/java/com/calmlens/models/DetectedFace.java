package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * A detected face. Faces are not identified or stored as biometric templates.
 */
public final class DetectedFace extends CalmLensObject {
  @Required private BoundingBox box;
  @Required private Double confidence;
  private AgeRange ageRange;

  private DetectedFace() {}

  /** @return where the face is in the image */
  public BoundingBox getBox() { return required(box, "box"); }

  /** @return detection confidence from 0 to 1 */
  public double getConfidence() { return required(confidence, "confidence"); }

  /** @return estimated age range, set when age estimation was requested; empty when the API sends none */
  public Optional<AgeRange> getAgeRange() { return Optional.ofNullable(ageRange); }
}
