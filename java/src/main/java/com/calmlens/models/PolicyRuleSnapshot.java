package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * A named allowance or restriction of a category: the qualifiers that must all hold for the same
 * content ({@code when}), the qualifiers that exclude it ({@code unless}, restrictions only) and
 * its action. A decision keeps its rules as configured then.
 */
public final class PolicyRuleSnapshot extends CalmLensObject {
  private String name;
  @Required private List<String> when;
  @Required private PolicyAction action;
  private List<String> unless;

  private PolicyRuleSnapshot() {}

  /** @return name; empty when the API sends none */
  public Optional<String> getName() { return Optional.ofNullable(name); }

  /** @return when */
  public List<String> getWhen() { return required(when, "when"); }

  /** @return action */
  public PolicyAction getAction() { return required(action, "action"); }

  /** @return unless; empty when the API sends none */
  public Optional<List<String>> getUnless() { return Optional.ofNullable(unless); }
}
