package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Map;
import java.util.Optional;

/**
 * One category result. {@code score} is set only for {@code evaluated} and {@code partial}.
 */
public final class CategoryResult extends CalmLensObject {
  @Required private CategoryEvaluationStatus status;
  private Double score;
  private Likelihood likelihood;
  private CategoryNotEvaluatedReason reason;
  private Map<String, QualifierResult> qualifiers;

  private CategoryResult() {}

  /** @return {@code evaluated}, {@code partial} or {@code not-evaluated} */
  public CategoryEvaluationStatus getStatus() { return required(status, "status"); }

  /** @return score from 0 to 1; empty when the API sends none */
  public Optional<Double> getScore() { return Optional.ofNullable(score); }

  /** @return likelihood bucket; empty when the API sends none */
  public Optional<Likelihood> getLikelihood() { return Optional.ofNullable(likelihood); }

  /** @return why the category was not evaluated; empty when the API sends none */
  public Optional<CategoryNotEvaluatedReason> getReason() { return Optional.ofNullable(reason); }

  /** @return qualifier results; empty when the API sends none */
  public Optional<Map<String, QualifierResult>> getQualifiers() { return Optional.ofNullable(qualifiers); }
}
