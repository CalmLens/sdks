package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.PolicyPresetId;
import org.jspecify.annotations.Nullable;

/** Options for {@code policies().create}: a copy of a preset, or settings of your own. */
public final class PolicyCreateParams extends ApiParams {
  private final @Nullable String name;
  private final @Nullable String description;
  private final @Nullable PolicySettingsParams settings;
  private final @Nullable PolicyPresetId presetId;

  private PolicyCreateParams(Builder builder) {
    super(builder);
    this.name = builder.name;
    this.description = builder.description;
    this.settings = builder.settings;
    this.presetId = builder.presetId;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the policy name; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return the description; empty when unset */
  public java.util.Optional<String> getDescription() { return java.util.Optional.ofNullable(description); }

  /** @return the settings; the preset's when unset; empty when unset */
  public java.util.Optional<PolicySettingsParams> getSettings() { return java.util.Optional.ofNullable(settings); }

  /** @return the preset to start from; empty when unset */
  public java.util.Optional<PolicyPresetId> getPresetId() { return java.util.Optional.ofNullable(presetId); }

  /** Builds {@link PolicyCreateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String name;
    private @Nullable String description;
    private @Nullable PolicySettingsParams settings;
    private @Nullable PolicyPresetId presetId;

    private Builder() {}

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
     * @param value the settings; the preset's when unset; null unsets it
     * @return this builder
     */
    public Builder setSettings(@Nullable PolicySettingsParams value) { this.settings = value; return this; }

    /**
     * @param value the preset to start from; null unsets it
     * @return this builder
     */
    public Builder setPresetId(@Nullable PolicyPresetId value) { this.presetId = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public PolicyCreateParams build() { return checkRequired(new PolicyCreateParams(this)); }
  }
}
