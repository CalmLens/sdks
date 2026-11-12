package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code policies().reset}. */
public final class PolicyResetParams extends ApiParams {
  @Required private final @Nullable Integer revision;
  @Required private final @Nullable Integer presetVersion;

  private PolicyResetParams(Builder builder) {
    super(builder);
    this.revision = builder.revision;
    this.presetVersion = builder.presetVersion;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the revision you read; empty when unset */
  public java.util.Optional<Integer> getRevision() { return java.util.Optional.ofNullable(revision); }

  /** @return the preset version you read; empty when unset */
  public java.util.Optional<Integer> getPresetVersion() { return java.util.Optional.ofNullable(presetVersion); }

  /** Builds {@link PolicyResetParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Integer revision;
    private @Nullable Integer presetVersion;

    private Builder() {}

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
    public PolicyResetParams build() { return checkRequired(new PolicyResetParams(this)); }
  }
}
