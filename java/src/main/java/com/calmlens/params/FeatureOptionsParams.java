package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Whether a processing feature runs. */
public final class FeatureOptionsParams extends ApiParams {
  @Required private final @Nullable Boolean enabled;

  private FeatureOptionsParams(Builder builder) {
    super(builder);
    this.enabled = builder.enabled;
  }

  /**
   * @param enabled whether the feature runs
   * @return the options
   */
  public static FeatureOptionsParams of(boolean enabled) { return builder().setEnabled(enabled).build(); }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return whether the feature runs; empty when unset */
  public java.util.Optional<Boolean> getEnabled() { return java.util.Optional.ofNullable(enabled); }

  /** Builds {@link FeatureOptionsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Boolean enabled;

    private Builder() {}

    /**
     * @param value whether the feature runs
     * @return this builder
     */
    public Builder setEnabled(@Nullable Boolean value) { this.enabled = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public FeatureOptionsParams build() { return checkRequired(new FeatureOptionsParams(this)); }
  }
}
