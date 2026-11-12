package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Human review settings. */
public final class HumanReviewSettingsParams extends ApiParams {
  private final @Nullable Double allowedSamplePercent;
  private final @Nullable Double restrictedSamplePercent;
  private final @Nullable Double uncertaintyMarginPercent;
  private final @Nullable Boolean reviewMissingEvidence;

  private HumanReviewSettingsParams(Builder builder) {
    super(builder);
    this.allowedSamplePercent = builder.allowedSamplePercent;
    this.restrictedSamplePercent = builder.restrictedSamplePercent;
    this.uncertaintyMarginPercent = builder.uncertaintyMarginPercent;
    this.reviewMissingEvidence = builder.reviewMissingEvidence;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the percentage of allowed assets sampled for review; empty when unset */
  public java.util.Optional<Double> getAllowedSamplePercent() { return java.util.Optional.ofNullable(allowedSamplePercent); }

  /** @return the percentage of restricted assets sampled for review; empty when unset */
  public java.util.Optional<Double> getRestrictedSamplePercent() { return java.util.Optional.ofNullable(restrictedSamplePercent); }

  /** @return how close to a threshold a score must be to count as uncertain; empty when unset */
  public java.util.Optional<Double> getUncertaintyMarginPercent() { return java.util.Optional.ofNullable(uncertaintyMarginPercent); }

  /** @return whether assets with missing evidence are reviewed; empty when unset */
  public java.util.Optional<Boolean> getReviewMissingEvidence() { return java.util.Optional.ofNullable(reviewMissingEvidence); }

  /** Builds {@link HumanReviewSettingsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Double allowedSamplePercent;
    private @Nullable Double restrictedSamplePercent;
    private @Nullable Double uncertaintyMarginPercent;
    private @Nullable Boolean reviewMissingEvidence;

    private Builder() {}

    /**
     * @param value the percentage of allowed assets sampled for review; null unsets it
     * @return this builder
     */
    public Builder setAllowedSamplePercent(@Nullable Double value) { this.allowedSamplePercent = value; return this; }

    /**
     * @param value the percentage of restricted assets sampled for review; null unsets it
     * @return this builder
     */
    public Builder setRestrictedSamplePercent(@Nullable Double value) { this.restrictedSamplePercent = value; return this; }

    /**
     * @param value how close to a threshold a score must be to count as uncertain; null unsets it
     * @return this builder
     */
    public Builder setUncertaintyMarginPercent(@Nullable Double value) { this.uncertaintyMarginPercent = value; return this; }

    /**
     * @param value whether assets with missing evidence are reviewed; null unsets it
     * @return this builder
     */
    public Builder setReviewMissingEvidence(@Nullable Boolean value) { this.reviewMissingEvidence = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public HumanReviewSettingsParams build() { return checkRequired(new HumanReviewSettingsParams(this)); }
  }
}
