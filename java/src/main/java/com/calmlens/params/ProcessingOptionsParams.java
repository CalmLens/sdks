package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Processing options for an upload or an upload preset. */
public final class ProcessingOptionsParams extends ApiParams {
  private final @Nullable Patch<Boolean> retainContent;
  private final @Nullable Patch<Boolean> storeSensitiveMetadata;
  private final @Nullable Patch<ProcessingFeaturesParams> features;

  private ProcessingOptionsParams(Builder builder) {
    super(builder);
    this.retainContent = builder.retainContent;
    this.storeSensitiveMetadata = builder.storeSensitiveMetadata;
    this.features = builder.features;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return whether CalmLens keeps the content: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<Boolean> getRetainContent() { return java.util.Optional.ofNullable(retainContent == null ? null : retainContent.get()); }

  /** @return whether to keep sensitive file metadata, such as location: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<Boolean> getStoreSensitiveMetadata() { return java.util.Optional.ofNullable(storeSensitiveMetadata == null ? null : storeSensitiveMetadata.get()); }

  /** @return which processing features run: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<ProcessingFeaturesParams> getFeatures() { return java.util.Optional.ofNullable(features == null ? null : features.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("retainContent") && retainContent != null && retainContent.isClear()) || (name.equals("storeSensitiveMetadata") && storeSensitiveMetadata != null && storeSensitiveMetadata.isClear()) || (name.equals("features") && features != null && features.isClear()); }

  /** Builds {@link ProcessingOptionsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Patch<Boolean> retainContent;
    private @Nullable Patch<Boolean> storeSensitiveMetadata;
    private @Nullable Patch<ProcessingFeaturesParams> features;

    private Builder() {}

    /**
     * @param value whether CalmLens keeps the content; null unsets it
     * @return this builder
     */
    public Builder setRetainContent(@Nullable Boolean value) { this.retainContent = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for retainContent, clearing it.
     *
     * @return this builder
     */
    public Builder clearRetainContent() { this.retainContent = Patch.clear(); return this; }

    /**
     * @param value whether to keep sensitive file metadata, such as location; null unsets it
     * @return this builder
     */
    public Builder setStoreSensitiveMetadata(@Nullable Boolean value) { this.storeSensitiveMetadata = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for storeSensitiveMetadata, clearing it.
     *
     * @return this builder
     */
    public Builder clearStoreSensitiveMetadata() { this.storeSensitiveMetadata = Patch.clear(); return this; }

    /**
     * @param value which processing features run; null unsets it
     * @return this builder
     */
    public Builder setFeatures(@Nullable ProcessingFeaturesParams value) { this.features = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for features, clearing it.
     *
     * @return this builder
     */
    public Builder clearFeatures() { this.features = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public ProcessingOptionsParams build() { return checkRequired(new ProcessingOptionsParams(this)); }
  }
}
