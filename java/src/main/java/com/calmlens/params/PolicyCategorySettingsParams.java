package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.PolicyAction;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** One category's settings. */
public final class PolicyCategorySettingsParams extends ApiParams {
  @Required private final @Nullable PolicyAction action;
  @Required private final @Nullable List<PolicyRuleParams> allowances;
  @Required private final @Nullable List<PolicyRuleParams> restrictions;

  private PolicyCategorySettingsParams(Builder builder) {
    super(builder);
    this.action = builder.action;
    this.allowances = builder.allowances;
    this.restrictions = builder.restrictions;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the category's action; empty when unset */
  public java.util.Optional<PolicyAction> getAction() { return java.util.Optional.ofNullable(action); }

  /** @return rules that relax the action; empty when unset */
  public java.util.Optional<List<PolicyRuleParams>> getAllowances() { return java.util.Optional.ofNullable(allowances); }

  /** @return rules that tighten it; empty when unset */
  public java.util.Optional<List<PolicyRuleParams>> getRestrictions() { return java.util.Optional.ofNullable(restrictions); }

  /** Builds {@link PolicyCategorySettingsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable PolicyAction action;
    private @Nullable List<PolicyRuleParams> allowances;
    private @Nullable List<PolicyRuleParams> restrictions;

    private Builder() {}

    /**
     * @param value the category's action
     * @return this builder
     */
    public Builder setAction(@Nullable PolicyAction value) { this.action = value; return this; }

    /**
     * @param value rules that relax the action
     * @return this builder
     */
    public Builder setAllowances(@Nullable List<PolicyRuleParams> value) { this.allowances = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value rules that tighten it
     * @return this builder
     */
    public Builder setRestrictions(@Nullable List<PolicyRuleParams> value) { this.restrictions = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public PolicyCategorySettingsParams build() { return checkRequired(new PolicyCategorySettingsParams(this)); }
  }
}
