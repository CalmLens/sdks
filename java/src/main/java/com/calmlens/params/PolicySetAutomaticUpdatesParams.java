package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code policies().setAutomaticUpdates}. */
public final class PolicySetAutomaticUpdatesParams extends ApiParams {
  @Required private final @Nullable Boolean enabled;
  @Required private final @Nullable Integer revision;
  @Required private final @Nullable Integer presetVersion;

  private PolicySetAutomaticUpdatesParams(Builder builder) {
    super(builder);
    this.enabled = builder.enabled;
    this.revision = builder.revision;
    this.presetVersion = builder.presetVersion;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return whether the policy follows the latest preset version; empty when unset */
  public java.util.Optional<Boolean> getEnabled() { return java.util.Optional.ofNullable(enabled); }

  /** @return the revision you read; empty when unset */
  public java.util.Optional<Integer> getRevision() { return java.util.Optional.ofNullable(revision); }

  /** @return the preset version you read; empty when unset */
  public java.util.Optional<Integer> getPresetVersion() { return java.util.Optional.ofNullable(presetVersion); }

  /** Builds {@link PolicySetAutomaticUpdatesParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Boolean enabled;
    private @Nullable Integer revision;
    private @Nullable Integer presetVersion;

    private Builder() {}

    /**
     * @param value whether the policy follows the latest preset version
     * @return this builder
     */
    public Builder setEnabled(@Nullable Boolean value) { this.enabled = value; return this; }

    /**
     * @param value the revision you read
     * @return this builder
     */
    public Builder setRevision(@Nullable Integer value) { this.revision = value; return this; }

    /**
     * @param value the preset version you read
     * @return this builder
     */
    public Builder setPresetVersion(@Nullable Integer value) { this.presetVersion = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public PolicySetAutomaticUpdatesParams build() { return checkRequired(new PolicySetAutomaticUpdatesParams(this)); }
  }
}
