package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code uploadTokens().sign}. */
public final class UploadTokenSignParams extends ApiParams {
  @Required private final @Nullable String uploadPresetId;
  private final @Nullable String externalId;
  private final @Nullable Integer expiresIn;

  private UploadTokenSignParams(Builder builder) {
    super(builder);
    this.uploadPresetId = builder.uploadPresetId;
    this.externalId = builder.externalId;
    this.expiresIn = builder.expiresIn;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the upload preset the token may upload through; empty when unset */
  public java.util.Optional<String> getUploadPresetId() { return java.util.Optional.ofNullable(uploadPresetId); }

  /** @return the external ID the uploaded asset gets; must not be empty; empty when unset */
  public java.util.Optional<String> getExternalId() { return java.util.Optional.ofNullable(externalId); }

  /** @return the lifetime in seconds, from 1 to 3600 (default 600); empty when unset */
  public java.util.Optional<Integer> getExpiresIn() { return java.util.Optional.ofNullable(expiresIn); }

  /** Builds {@link UploadTokenSignParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String uploadPresetId;
    private @Nullable String externalId;
    private @Nullable Integer expiresIn;

    private Builder() {}

    /**
     * @param value the upload preset the token may upload through
     * @return this builder
     */
    public Builder setUploadPresetId(@Nullable String value) { this.uploadPresetId = value; return this; }

    /**
     * @param value the external ID the uploaded asset gets; must not be empty; null unsets it
     * @return this builder
     */
    public Builder setExternalId(@Nullable String value) { this.externalId = value; return this; }

    /**
     * @param value the lifetime in seconds, from 1 to 3600 (default 600); null unsets it
     * @return this builder
     */
    public Builder setExpiresIn(@Nullable Integer value) { this.expiresIn = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public UploadTokenSignParams build() { return checkRequired(new UploadTokenSignParams(this)); }
  }
}
