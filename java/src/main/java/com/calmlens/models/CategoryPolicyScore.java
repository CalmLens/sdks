package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * How strongly a category meets the policy and what the policy does with it.
 */
public final class CategoryPolicyScore extends CalmLensObject {
  @Required private Double score;
  @Required private PolicyAction action;
  private CategoryPolicySource source;
  private CategoryPolicySettingsSnapshot settings;

  private CategoryPolicyScore() {}

  /** @return policy score from 0 to 1 */
  public double getScore() { return required(score, "score"); }

  /** @return {@code allow}, {@code limit}, {@code age-restrict}, {@code block} or {@code purge} */
  public PolicyAction getAction() { return required(action, "action"); }

  /** @return source; empty when the API sends none */
  public Optional<CategoryPolicySource> getSource() { return Optional.ofNullable(source); }

  /** @return settings; empty when the API sends none */
  public Optional<CategoryPolicySettingsSnapshot> getSettings() { return Optional.ofNullable(settings); }
}
