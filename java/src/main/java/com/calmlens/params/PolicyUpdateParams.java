package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code policies().update}; unset options keep their value. */
public final class PolicyUpdateParams extends ApiParams {
  @Required private final @Nullable Integer revision;
  private final @Nullable String name;
  private final @Nullable String description;
  private final @Nullable PolicySettingsParams settings;

  private PolicyUpdateParams(Builder builder) {
    super(builder);
    this.revision = builder.revision;
    this.name = builder.name;
    this.description = builder.description;
    this.settings = builder.settings;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the revision you read, so a concurrent edit is refused; empty when unset */
  public java.util.Optional<Integer> getRevision() { return java.util.Optional.ofNullable(revision); }

  /** @return the policy name; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return the description; empty when unset */
  public java.util.Optional<String> getDescription() { return java.util.Optional.ofNullable(description); }

  /** @return the new settings; empty when unset */
  public java.util.Optional<PolicySettingsParams> getSettings() { return java.util.Optional.ofNullable(settings); }

  /** Builds {@link PolicyUpdateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Integer revision;
    private @Nullable String name;
    private @Nullable String description;
    private @Nullable PolicySettingsParams settings;

    private Builder() {}

    /**
     * @param value the revision you read, so a concurrent edit is refused
     * @return this builder
     */
    public Builder setRevision(@Nullable Integer value) { this.revision = value; return this; }

    /**
     * @param value the policy name; null unsets it
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @param value the description; null unsets it
     * @return this builder
     */
    public Builder setDescription(@Nullable String value) { this.description = value; return this; }

    /**
     * @param value the new settings; null unsets it
     * @return this builder
     */
    public Builder setSettings(@Nullable PolicySettingsParams value) { this.settings = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public PolicyUpdateParams build() { return checkRequired(new PolicyUpdateParams(this)); }
  }
}
