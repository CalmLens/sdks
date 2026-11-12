package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.ImageTransformOptions;
import com.calmlens.models.LensType;
import org.jspecify.annotations.Nullable;

/** A lens: options for {@code lenses().create}, {@code ensureLens} and {@code ensureLenses}. */
public final class LensCreateParams extends ApiParams {
  @Required private final @Nullable String identifier;
  @Required private final @Nullable String name;
  private final @Nullable Patch<String> description;
  @Required private final @Nullable LensType type;
  private final @Nullable Boolean active;
  private final @Nullable Patch<ImageTransformOptions> transform;

  private LensCreateParams(Builder builder) {
    super(builder);
    this.identifier = builder.identifier;
    this.name = builder.name;
    this.description = builder.description;
    this.type = builder.type;
    this.active = builder.active;
    this.transform = builder.transform;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the stable identifier used in CDN URLs; empty when unset */
  public java.util.Optional<String> getIdentifier() { return java.util.Optional.ofNullable(identifier); }

  /** @return the display name; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return the description: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getDescription() { return java.util.Optional.ofNullable(description == null ? null : description.get()); }

  /** @return the asset type the lens applies to; empty when unset */
  public java.util.Optional<LensType> getType() { return java.util.Optional.ofNullable(type); }

  /** @return whether the CDN serves the lens; it does when unset; empty when unset */
  public java.util.Optional<Boolean> getActive() { return java.util.Optional.ofNullable(active); }

  /** @return the image transform the lens applies: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<ImageTransformOptions> getTransform() { return java.util.Optional.ofNullable(transform == null ? null : transform.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("description") && description != null && description.isClear()) || (name.equals("transform") && transform != null && transform.isClear()); }

  /** Builds {@link LensCreateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String identifier;
    private @Nullable String name;
    private @Nullable Patch<String> description;
    private @Nullable LensType type;
    private @Nullable Boolean active;
    private @Nullable Patch<ImageTransformOptions> transform;

    private Builder() {}

    /**
     * @param value the stable identifier used in CDN URLs
     * @return this builder
     */
    public Builder setIdentifier(@Nullable String value) { this.identifier = value; return this; }

    /**
     * @param value the display name
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
     * @param value the asset type the lens applies to
     * @return this builder
     */
    public Builder setType(@Nullable LensType value) { this.type = value; return this; }

    /**
     * @param value whether the CDN serves the lens; it does when unset; null unsets it
     * @return this builder
     */
    public Builder setActive(@Nullable Boolean value) { this.active = value; return this; }

    /**
     * @param value the image transform the lens applies; null unsets it
     * @return this builder
     */
    public Builder setTransform(@Nullable ImageTransformOptions value) { this.transform = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for transform, clearing it.
     *
     * @return this builder
     */
    public Builder clearTransform() { this.transform = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public LensCreateParams build() { return checkRequired(new LensCreateParams(this)); }
  }
}
