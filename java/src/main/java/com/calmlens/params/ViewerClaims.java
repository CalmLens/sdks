package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** What your app asserts about the viewer of an asset URL. Viewer claims are your app's assertions and CalmLens doesn't verify them; to control who loads an age-restricted asset, make it private and sign its URL only for viewers whose age you confirmed. */
public final class ViewerClaims extends ApiParams {
  private final @Nullable String region;
  private final @Nullable Boolean ageConfirmed;

  private ViewerClaims(Builder builder) {
    super(builder);
    this.region = builder.region;
    this.ageConfirmed = builder.ageConfirmed;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the viewer's country, an ISO 3166-1 alpha-2 code such as {@code DE}; empty when unset */
  public java.util.Optional<String> getRegion() { return java.util.Optional.ofNullable(region); }

  /** @return whether your platform confirmed the viewer's age; false when unset; empty when unset */
  public java.util.Optional<Boolean> getAgeConfirmed() { return java.util.Optional.ofNullable(ageConfirmed); }

  /** Builds {@link ViewerClaims}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String region;
    private @Nullable Boolean ageConfirmed;

    private Builder() {}

    /**
     * @param value the viewer's country, an ISO 3166-1 alpha-2 code such as {@code DE}; null unsets it
     * @return this builder
     */
    public Builder setRegion(@Nullable String value) { this.region = value; return this; }

    /**
     * @param value whether your platform confirmed the viewer's age; false when unset; null unsets it
     * @return this builder
     */
    public Builder setAgeConfirmed(@Nullable Boolean value) { this.ageConfirmed = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public ViewerClaims build() { return checkRequired(new ViewerClaims(this)); }
  }
}
