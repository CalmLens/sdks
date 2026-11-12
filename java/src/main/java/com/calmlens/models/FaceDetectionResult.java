package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * A face detection result. {@code faces} is set only for {@code evaluated}; {@code reason} only
 * for {@code not-evaluated}.
 */
public final class FaceDetectionResult extends CalmLensObject {
  @Required private EvaluationStatus status;
  private FeatureNotEvaluatedReason reason;
  private List<DetectedFace> faces;

  private FaceDetectionResult() {}

  /** @return {@code evaluated} or {@code not-evaluated} */
  public EvaluationStatus getStatus() { return required(status, "status"); }

  /** @return why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}; empty when the API sends none */
  public Optional<FeatureNotEvaluatedReason> getReason() { return Optional.ofNullable(reason); }

  /** @return detected faces; empty when the API sends none */
  public Optional<List<DetectedFace>> getFaces() { return Optional.ofNullable(faces); }
}
