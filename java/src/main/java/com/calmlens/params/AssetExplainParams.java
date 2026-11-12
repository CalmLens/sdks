package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code assets().explain}. */
public final class AssetExplainParams extends ApiParams {
  private final @Nullable Boolean rerun;

  private AssetExplainParams(Builder builder) {
    super(builder);
    this.rerun = builder.rerun;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return whether to moderate the asset again with the project's current policy instead of explaining the decision as made; empty when unset */
  public java.util.Optional<Boolean> getRerun() { return java.util.Optional.ofNullable(rerun); }

  /** Builds {@link AssetExplainParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Boolean rerun;

    private Builder() {}

    /**
     * @param value whether to moderate the asset again with the project's current policy instead of explaining the decision as made; null unsets it
     * @return this builder
     */
    public Builder setRerun(@Nullable Boolean value) { this.rerun = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public AssetExplainParams build() { return checkRequired(new AssetExplainParams(this)); }
  }
}
