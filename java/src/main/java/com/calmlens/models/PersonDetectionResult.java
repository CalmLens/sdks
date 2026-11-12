package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * A person detection result. {@code people} is set only for {@code evaluated}; {@code reason}
 * only for {@code not-evaluated}.
 */
public final class PersonDetectionResult extends CalmLensObject {
  @Required private EvaluationStatus status;
  private FeatureNotEvaluatedReason reason;
  private List<DetectedPerson> people;

  private PersonDetectionResult() {}

  /** @return {@code evaluated} or {@code not-evaluated} */
  public EvaluationStatus getStatus() { return required(status, "status"); }

  /** @return why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}; empty when the API sends none */
  public Optional<FeatureNotEvaluatedReason> getReason() { return Optional.ofNullable(reason); }

  /** @return detected people; empty when the API sends none */
  public Optional<List<DetectedPerson>> getPeople() { return Optional.ofNullable(people); }
}
