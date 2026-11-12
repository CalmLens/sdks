package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.PolicyAction;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** A policy rule: its qualifiers, together, decide its action. */
public final class PolicyRuleParams extends ApiParams {
  private final @Nullable String name;
  @Required private final @Nullable List<String> when;
  private final @Nullable List<String> unless;
  @Required private final @Nullable PolicyAction action;

  private PolicyRuleParams(Builder builder) {
    super(builder);
    this.name = builder.name;
    this.when = builder.when;
    this.unless = builder.unless;
    this.action = builder.action;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return a name for the rule; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return the qualifiers that must all apply; empty when unset */
  public java.util.Optional<List<String>> getWhen() { return java.util.Optional.ofNullable(when); }

  /** @return qualifiers that exclude the same content; empty when unset */
  public java.util.Optional<List<String>> getUnless() { return java.util.Optional.ofNullable(unless); }

  /** @return the rule's action; empty when unset */
  public java.util.Optional<PolicyAction> getAction() { return java.util.Optional.ofNullable(action); }

  /** Builds {@link PolicyRuleParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String name;
    private @Nullable List<String> when;
    private @Nullable List<String> unless;
    private @Nullable PolicyAction action;

    private Builder() {}

    /**
     * @param value a name for the rule; null unsets it
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @param value the qualifiers that must all apply
     * @return this builder
     */
    public Builder setWhen(@Nullable List<String> value) { this.when = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value qualifiers that exclude the same content; null unsets it
     * @return this builder
     */
    public Builder setUnless(@Nullable List<String> value) { this.unless = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value the rule's action
     * @return this builder
     */
    public Builder setAction(@Nullable PolicyAction value) { this.action = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public PolicyRuleParams build() { return checkRequired(new PolicyRuleParams(this)); }
  }
}
