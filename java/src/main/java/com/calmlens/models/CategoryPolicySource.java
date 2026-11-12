package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * The rule that decided the outcome, or that the policy score stayed below 50%.
 */
public final class CategoryPolicySource extends CalmLensObject {
  @Required private PolicySourceKind kind;
  private List<Integer> indexes;
  private Double conditionScore;

  private CategoryPolicySource() {}

  /** @return {@code default}, {@code below-threshold}, {@code allowance} or {@code restriction} */
  public PolicySourceKind getKind() { return required(kind, "kind"); }

  /** @return for {@code allowance} and {@code restriction}, the positions of the deciding rules in the category's settings, the decisive rule first; empty otherwise; empty when the API sends none */
  public Optional<List<Integer>> getIndexes() { return Optional.ofNullable(indexes); }

  /** @return for {@code allowance} and {@code restriction}, the evidence that triggered the rules, from 0 to 1: a restriction's same-content presence or the allowances' coverage. A rule with {@code unless} qualifiers, or several {@code when} qualifiers, is assessed as a whole, so its qualifiers can be missing from {@code raw}; null otherwise; empty when the API sends none */
  public Optional<Double> getConditionScore() { return Optional.ofNullable(conditionScore); }
}
