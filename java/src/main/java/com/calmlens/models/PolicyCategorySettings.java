package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * What a policy does with one category.
 */
public final class PolicyCategorySettings extends CalmLensObject {
  @Required private PolicyAction action;
  @Required private List<PolicyRuleSnapshot> allowances;
  @Required private List<PolicyRuleSnapshot> restrictions;

  private PolicyCategorySettings() {}

  /** @return the action when the category's policy score reaches 0.5: {@code allow}, {@code limit}, {@code age-restrict}, {@code block} or {@code purge} */
  public PolicyAction getAction() { return required(action, "action"); }

  /** @return contexts that let content through, or act on it more softly; send an empty list for none */
  public List<PolicyRuleSnapshot> getAllowances() { return required(allowances, "allowances"); }

  /** @return conditions that act on matching content; they outweigh allowances; send an empty list for none */
  public List<PolicyRuleSnapshot> getRestrictions() { return required(restrictions, "restrictions"); }
}
