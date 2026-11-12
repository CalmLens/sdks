package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.ImageTransformOptions;
import org.jspecify.annotations.Nullable;

/** Which CDN resource {@code cdn().getAssetUrl} builds and {@code cdn().serve} fetches. */
public final class CdnRequestParams extends ApiParams {
  private final @Nullable String projectId;
  private final @Nullable String assetId;
  private final @Nullable String externalId;
  private final @Nullable String resource;
  private final @Nullable String lens;
  private final transient @Nullable Object transform;
  private final @Nullable ViewerClaims viewerClaims;
  private final @Nullable HttpOptions init;

  private CdnRequestParams(Builder builder) {
    super(builder);
    this.projectId = builder.projectId;
    this.assetId = builder.assetId;
    this.externalId = builder.externalId;
    this.resource = builder.resource;
    this.lens = builder.lens;
    this.transform = builder.transform;
    this.viewerClaims = builder.viewerClaims;
    this.init = builder.init;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the asset's project; the client's when unset; empty when unset */
  public java.util.Optional<String> getProjectId() { return java.util.Optional.ofNullable(projectId); }

  /** @return the asset's ID; set this or externalId, not both; empty when unset */
  public java.util.Optional<String> getAssetId() { return java.util.Optional.ofNullable(assetId); }

  /** @return the external ID the asset was uploaded with; set this or assetId, not both; empty when unset */
  public java.util.Optional<String> getExternalId() { return java.util.Optional.ofNullable(externalId); }

  /** @return {@code rendered} or {@code preview} (both take a lens or transform), or {@code original}, {@code hls}, {@code embed}, {@code placeholder} or {@code info}; unset builds the asset URL itself for {@code getAssetUrl}, and serves {@code rendered}; empty when unset */
  public java.util.Optional<String> getResource() { return java.util.Optional.ofNullable(resource); }

  /** @return a lens, for the {@code rendered} or {@code preview} resource; empty when unset */
  public java.util.Optional<String> getLens() { return java.util.Optional.ofNullable(lens); }

  /** @return the transform: a selector {@code String} or {@link ImageTransformOptions}; empty when unset */
  public java.util.Optional<Object> getTransform() { return java.util.Optional.ofNullable(transform); }

  /** @return claims appended as the {@code viewerClaims} query, defaults left out; empty when unset */
  public java.util.Optional<ViewerClaims> getViewerClaims() { return java.util.Optional.ofNullable(viewerClaims); }

  /** @return the request method and extra headers, such as {@code Range}; empty when unset */
  public java.util.Optional<HttpOptions> getInit() { return java.util.Optional.ofNullable(init); }

  /** Builds {@link CdnRequestParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String projectId;
    private @Nullable String assetId;
    private @Nullable String externalId;
    private @Nullable String resource;
    private @Nullable String lens;
    private @Nullable Object transform;
    private @Nullable ViewerClaims viewerClaims;
    private @Nullable HttpOptions init;

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
     * @param value {@code rendered} or {@code preview} (both take a lens or transform), or {@code original}, {@code hls}, {@code embed}, {@code placeholder} or {@code info}; unset builds the asset URL itself for {@code getAssetUrl}, and serves {@code rendered}; null unsets it
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
     * @param value the request method and extra headers, such as {@code Range}; null unsets it
     * @return this builder
     */
    public Builder setInit(@Nullable HttpOptions value) { this.init = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public CdnRequestParams build() { return checkRequired(new CdnRequestParams(this)); }
  }
}
