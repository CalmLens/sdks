package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * A category qualifier result.
 */
public final class QualifierResult extends CalmLensObject {
  private Double allScore;
  @Required private EvaluationStatus status;
  private Double someScore;
  private Likelihood likelihood;
  private CategoryNotEvaluatedReason reason;

  private QualifierResult() {}

  /** @return confidence that the content is only this qualifier; never above someScore; empty when the API sends none */
  public Optional<Double> getAllScore() { return Optional.ofNullable(allScore); }

  /** @return evaluation status */
  public EvaluationStatus getStatus() { return required(status, "status"); }

  /** @return confidence that some of the content is this qualifier; empty when the API sends none */
  public Optional<Double> getSomeScore() { return Optional.ofNullable(someScore); }

  /** @return likelihood bucket; empty when the API sends none */
  public Optional<Likelihood> getLikelihood() { return Optional.ofNullable(likelihood); }

  /** @return reason when not evaluated; empty when the API sends none */
  public Optional<CategoryNotEvaluatedReason> getReason() { return Optional.ofNullable(reason); }
}
