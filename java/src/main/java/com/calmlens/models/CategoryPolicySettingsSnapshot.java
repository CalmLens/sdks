package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * Historical category settings used to explain the saved decision.
 */
public final class CategoryPolicySettingsSnapshot extends CalmLensObject {
  @Required private PolicyAction action;
  @Required private List<PolicyRuleSnapshot> allowances;
  @Required private List<PolicyRuleSnapshot> restrictions;

  private CategoryPolicySettingsSnapshot() {}

  /** @return the category's default action when its policy score reaches 0.5 */
  public PolicyAction getAction() { return required(action, "action"); }

  /** @return the category's allowances then */
  public List<PolicyRuleSnapshot> getAllowances() { return required(allowances, "allowances"); }

  /** @return the category's restrictions then */
  public List<PolicyRuleSnapshot> getRestrictions() { return required(restrictions, "restrictions"); }
}
