package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.ImageTransformOptions;
import org.jspecify.annotations.Nullable;

/** Options for {@code cdn().signAssetUrl}: the asset, by ID or external ID, and the grant. */
public final class CdnSignAssetUrlParams extends ApiParams {
  private final @Nullable String projectId;
  private final @Nullable String assetId;
  private final @Nullable String externalId;
  private final @Nullable Long expiresIn;
  private final @Nullable Boolean original;
  private final @Nullable String resource;
  private final @Nullable String lens;
  private final transient @Nullable Object transform;
  private final @Nullable ViewerClaims viewerClaims;

  private CdnSignAssetUrlParams(Builder builder) {
    super(builder);
    this.projectId = builder.projectId;
    this.assetId = builder.assetId;
    this.externalId = builder.externalId;
    this.expiresIn = builder.expiresIn;
    this.original = builder.original;
    this.resource = builder.resource;
    this.lens = builder.lens;
    this.transform = builder.transform;
    this.viewerClaims = builder.viewerClaims;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the asset's project; the client's when unset; empty when unset */
  public java.util.Optional<String> getProjectId() { return java.util.Optional.ofNullable(projectId); }

  /** @return the asset's ID; set this or externalId, not both; empty when unset */
  public java.util.Optional<String> getAssetId() { return java.util.Optional.ofNullable(assetId); }

  /** @return the external ID the asset was uploaded with; set this or assetId, not both; empty when unset */
  public java.util.Optional<String> getExternalId() { return java.util.Optional.ofNullable(externalId); }

  /** @return the grant's lifetime in whole seconds, from 1 to 86400; 3600 when unset; empty when unset */
  public java.util.Optional<Long> getExpiresIn() { return java.util.Optional.ofNullable(expiresIn); }

  /** @return whether the URL serves the {@code original} resource, the exact upload, which it refuses otherwise; empty when unset */
  public java.util.Optional<Boolean> getOriginal() { return java.util.Optional.ofNullable(original); }

  /** @return a resource beneath the grant to return the URL of; the signed asset URL itself when unset; empty when unset */
  public java.util.Optional<String> getResource() { return java.util.Optional.ofNullable(resource); }

  /** @return a lens, for the {@code rendered} or {@code preview} resource; empty when unset */
  public java.util.Optional<String> getLens() { return java.util.Optional.ofNullable(lens); }

  /** @return the transform: a selector {@code String} or {@link ImageTransformOptions}; empty when unset */
  public java.util.Optional<Object> getTransform() { return java.util.Optional.ofNullable(transform); }

  /** @return claims appended as the {@code viewerClaims} query, defaults left out; empty when unset */
  public java.util.Optional<ViewerClaims> getViewerClaims() { return java.util.Optional.ofNullable(viewerClaims); }

  /** Builds {@link CdnSignAssetUrlParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String projectId;
    private @Nullable String assetId;
    private @Nullable String externalId;
    private @Nullable Long expiresIn;
    private @Nullable Boolean original;
    private @Nullable String resource;
    private @Nullable String lens;
    private @Nullable Object transform;
    private @Nullable ViewerClaims viewerClaims;

    private Builder() {}

    /**
     * @param value the asset's project; the client's when unset; null unsets it
     * @return this builder
     */
    public Builder setProjectId(@Nullable String value) { this.projectId = value; return this; }

    /**
     * @param value the asset's ID; set this or externalId, not both; null unsets it
     * @return this builder
     */
    public Builder setAssetId(@Nullable String value) { this.assetId = value; return this; }

    /**
     * @param value the external ID the asset was uploaded with; set this or assetId, not both; null unsets it
     * @return this builder
     */
    public Builder setExternalId(@Nullable String value) { this.externalId = value; return this; }

    /**
     * @param value the grant's lifetime in whole seconds, from 1 to 86400; 3600 when unset; null unsets it
     * @return this builder
     */
    public Builder setExpiresIn(@Nullable Long value) { this.expiresIn = value; return this; }

    /**
     * @param value whether the URL serves the {@code original} resource, the exact upload, which it refuses otherwise; null unsets it
     * @return this builder
     */
    public Builder setOriginal(@Nullable Boolean value) { this.original = value; return this; }

    /**
     * @param value a resource beneath the grant to return the URL of; the signed asset URL itself when unset; null unsets it
     * @return this builder
     */
    public Builder setResource(@Nullable String value) { this.resource = value; return this; }

    /**
     * @param value a lens, for the {@code rendered} or {@code preview} resource; null unsets it
     * @return this builder
     */
    public Builder setLens(@Nullable String value) { this.lens = value; return this; }

    /**
     * @param value comma-separated options in one path segment, such as {@code fit=cover,width=1024}, for the {@code rendered} or
     *     {@code preview} resource; they replace the lens's options of the same name. Null unsets it
     * @return this builder
     */
    public Builder setTransform(@Nullable String value) { this.transform = value; return this; }

    /**
     * @param value structured options, at least one set, serialized as a selector; null unsets it
     * @return this builder
     */
    public Builder setTransform(@Nullable ImageTransformOptions value) { this.transform = value; return this; }

    /**
     * @param value claims appended as the {@code viewerClaims} query, defaults left out; null unsets it
     * @return this builder
     */
    public Builder setViewerClaims(@Nullable ViewerClaims value) { this.viewerClaims = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public CdnSignAssetUrlParams build() { return checkRequired(new CdnSignAssetUrlParams(this)); }
  }
}
