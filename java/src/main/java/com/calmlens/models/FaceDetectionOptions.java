package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Options for face detection (preview). Faces are located, never identified.
 */
public final class FaceDetectionOptions extends CalmLensObject {
  @Required private Boolean enabled;
  private Boolean ageEstimation;

  private FaceDetectionOptions() {}

  /** @return whether face detection runs */
  public boolean getEnabled() { return required(enabled, "enabled"); }

  /** @return whether an age range is also estimated for each face; empty when the API sends none */
  public Optional<Boolean> getAgeEstimation() { return Optional.ofNullable(ageEstimation); }

}
