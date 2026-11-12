package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code hashLists().addEntry}: a perceptual hash, or an asset whose hash to add. */
public final class HashListAddEntryParams extends ApiParams {
  private final @Nullable String hash;
  private final @Nullable Patch<Integer> quality;
  private final @Nullable String assetId;
  private final @Nullable Patch<String> label;

  private HashListAddEntryParams(Builder builder) {
    super(builder);
    this.hash = builder.hash;
    this.quality = builder.quality;
    this.assetId = builder.assetId;
    this.label = builder.label;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return a perceptual hash; empty when unset */
  public java.util.Optional<String> getHash() { return java.util.Optional.ofNullable(hash); }

  /** @return the hash's quality: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<Integer> getQuality() { return java.util.Optional.ofNullable(quality == null ? null : quality.get()); }

  /** @return an asset whose hash to add instead of {@code hash}; empty when unset */
  public java.util.Optional<String> getAssetId() { return java.util.Optional.ofNullable(assetId); }

  /** @return a label for the entry: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getLabel() { return java.util.Optional.ofNullable(label == null ? null : label.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("quality") && quality != null && quality.isClear()) || (name.equals("label") && label != null && label.isClear()); }

  /** Builds {@link HashListAddEntryParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String hash;
    private @Nullable Patch<Integer> quality;
    private @Nullable String assetId;
    private @Nullable Patch<String> label;

    private Builder() {}

    /**
     * @param value a perceptual hash; null unsets it
     * @return this builder
     */
    public Builder setHash(@Nullable String value) { this.hash = value; return this; }

    /**
     * @param value the hash's quality; null unsets it
     * @return this builder
     */
    public Builder setQuality(@Nullable Integer value) { this.quality = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for quality, clearing it.
     *
     * @return this builder
     */
    public Builder clearQuality() { this.quality = Patch.clear(); return this; }

    /**
     * @param value an asset whose hash to add instead of {@code hash}; null unsets it
     * @return this builder
     */
    public Builder setAssetId(@Nullable String value) { this.assetId = value; return this; }

    /**
     * @param value a label for the entry; null unsets it
     * @return this builder
     */
    public Builder setLabel(@Nullable String value) { this.label = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for label, clearing it.
     *
     * @return this builder
     */
    public Builder clearLabel() { this.label = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public HashListAddEntryParams build() { return checkRequired(new HashListAddEntryParams(this)); }
  }
}
