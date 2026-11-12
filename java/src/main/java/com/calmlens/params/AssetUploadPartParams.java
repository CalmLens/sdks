package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code assets().uploadPart}: the next part of a multipart upload. */
public final class AssetUploadPartParams extends ApiParams {
  @Required private final @Nullable Content part;
  private final @Nullable Boolean wait;

  private AssetUploadPartParams(Builder builder) {
    super(builder);
    this.part = builder.part;
    this.wait = builder.wait;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the part, with its part number and {@code isFinal}; empty when unset */
  public java.util.Optional<Content> getPart() { return java.util.Optional.ofNullable(part); }

  /** @return for the final part, whether to wait for the decision; the choice saved when the upload started ({@code classify} waits, {@code create} doesn't) when unset; empty when unset */
  public java.util.Optional<Boolean> getWait() { return java.util.Optional.ofNullable(wait); }

  /** Builds {@link AssetUploadPartParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Content part;
    private @Nullable Boolean wait;

    private Builder() {}

    /**
     * @param value the part, with its part number and {@code isFinal}
     * @return this builder
     */
    public Builder setPart(@Nullable Content value) { this.part = value; return this; }

    /**
     * @param value for the final part, whether to wait for the decision; the choice saved when the upload started ({@code classify} waits, {@code create} doesn't) when unset; null unsets it
     * @return this builder
     */
    public Builder setWait(@Nullable Boolean value) { this.wait = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public AssetUploadPartParams build() { return checkRequired(new AssetUploadPartParams(this)); }
  }
}
