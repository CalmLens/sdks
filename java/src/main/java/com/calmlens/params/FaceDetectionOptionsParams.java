package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Whether face detection runs. */
public final class FaceDetectionOptionsParams extends ApiParams {
  @Required private final @Nullable Boolean enabled;
  private final @Nullable Boolean ageEstimation;

  private FaceDetectionOptionsParams(Builder builder) {
    super(builder);
    this.enabled = builder.enabled;
    this.ageEstimation = builder.ageEstimation;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return whether face detection runs; empty when unset */
  public java.util.Optional<Boolean> getEnabled() { return java.util.Optional.ofNullable(enabled); }

  /** @return whether it estimates ages; empty when unset */
  public java.util.Optional<Boolean> getAgeEstimation() { return java.util.Optional.ofNullable(ageEstimation); }

  /** Builds {@link FaceDetectionOptionsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Boolean enabled;
    private @Nullable Boolean ageEstimation;

    private Builder() {}

    /**
     * @param value whether face detection runs
     * @return this builder
     */
    public Builder setEnabled(@Nullable Boolean value) { this.enabled = value; return this; }

    /**
     * @param value whether it estimates ages; null unsets it
     * @return this builder
     */
    public Builder setAgeEstimation(@Nullable Boolean value) { this.ageEstimation = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public FaceDetectionOptionsParams build() { return checkRequired(new FaceDetectionOptionsParams(this)); }
  }
}
