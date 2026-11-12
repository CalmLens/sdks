package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.Visibility;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Options for {@code assets().update}; unset options keep their value, and {@code clearX()} clears one. */
public final class AssetUpdateParams extends ApiParams {
  private final @Nullable String name;
  private final @Nullable Patch<String> description;
  private final @Nullable Patch<String> externalId;
  private final @Nullable Patch<String> externalUrl;
  private final @Nullable Patch<List<MetadataItemParams>> metadata;
  private final @Nullable Patch<List<String>> tags;
  private final @Nullable Patch<Visibility> visibility;

  private AssetUpdateParams(Builder builder) {
    super(builder);
    this.name = builder.name;
    this.description = builder.description;
    this.externalId = builder.externalId;
    this.externalUrl = builder.externalUrl;
    this.metadata = builder.metadata;
    this.tags = builder.tags;
    this.visibility = builder.visibility;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the new name; an asset always has one, so it can't be cleared; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return the description: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getDescription() { return java.util.Optional.ofNullable(description == null ? null : description.get()); }

  /** @return your identifier for the asset: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getExternalId() { return java.util.Optional.ofNullable(externalId == null ? null : externalId.get()); }

  /** @return your URL for the asset: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getExternalUrl() { return java.util.Optional.ofNullable(externalUrl == null ? null : externalUrl.get()); }

  /** @return the metadata entries, replacing the current ones: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<List<MetadataItemParams>> getMetadata() { return java.util.Optional.ofNullable(metadata == null ? null : metadata.get()); }

  /** @return the tags, replacing the current ones: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<List<String>> getTags() { return java.util.Optional.ofNullable(tags == null ? null : tags.get()); }

  /** @return the CDN visibility: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<Visibility> getVisibility() { return java.util.Optional.ofNullable(visibility == null ? null : visibility.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("description") && description != null && description.isClear()) || (name.equals("externalId") && externalId != null && externalId.isClear()) || (name.equals("externalUrl") && externalUrl != null && externalUrl.isClear()) || (name.equals("metadata") && metadata != null && metadata.isClear()) || (name.equals("tags") && tags != null && tags.isClear()) || (name.equals("visibility") && visibility != null && visibility.isClear()); }

  /** Builds {@link AssetUpdateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String name;
    private @Nullable Patch<String> description;
    private @Nullable Patch<String> externalId;
    private @Nullable Patch<String> externalUrl;
    private @Nullable Patch<List<MetadataItemParams>> metadata;
    private @Nullable Patch<List<String>> tags;
    private @Nullable Patch<Visibility> visibility;

    private Builder() {}

    /**
     * @param value the new name; an asset always has one, so it can't be cleared; null unsets it
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @param value the description; null unsets it
     * @return this builder
     */
    public Builder setDescription(@Nullable String value) { this.description = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for description, clearing it.
     *
     * @return this builder
     */
    public Builder clearDescription() { this.description = Patch.clear(); return this; }

    /**
     * @param value your identifier for the asset; null unsets it
     * @return this builder
     */
    public Builder setExternalId(@Nullable String value) { this.externalId = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for externalId, clearing it.
     *
     * @return this builder
     */
    public Builder clearExternalId() { this.externalId = Patch.clear(); return this; }

    /**
     * @param value your URL for the asset; null unsets it
     * @return this builder
     */
    public Builder setExternalUrl(@Nullable String value) { this.externalUrl = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for externalUrl, clearing it.
     *
     * @return this builder
     */
    public Builder clearExternalUrl() { this.externalUrl = Patch.clear(); return this; }

    /**
     * @param value the metadata entries, replacing the current ones; null unsets it
     * @return this builder
     */
    public Builder setMetadata(@Nullable List<MetadataItemParams> value) { this.metadata = value == null ? null : Patch.value(java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value))); return this; }

    /**
     * Sends null for metadata, clearing it.
     *
     * @return this builder
     */
    public Builder clearMetadata() { this.metadata = Patch.clear(); return this; }

    /**
     * @param value the tags, replacing the current ones; null unsets it
     * @return this builder
     */
    public Builder setTags(@Nullable List<String> value) { this.tags = value == null ? null : Patch.value(java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value))); return this; }

    /**
     * Sends null for tags, clearing it.
     *
     * @return this builder
     */
    public Builder clearTags() { this.tags = Patch.clear(); return this; }

    /**
     * @param value the CDN visibility; null unsets it
     * @return this builder
     */
    public Builder setVisibility(@Nullable Visibility value) { this.visibility = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for visibility, clearing it.
     *
     * @return this builder
     */
    public Builder clearVisibility() { this.visibility = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public AssetUpdateParams build() { return checkRequired(new AssetUpdateParams(this)); }
  }
}
