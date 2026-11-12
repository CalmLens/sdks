package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A policy's settings. */
public final class PolicySettingsParams extends ApiParams {
  @Required private final @Nullable Map<String, PolicyCategorySettingsParams> categorySettings;
  private final @Nullable LinkSafetySettingsParams linkSafety;

  private PolicySettingsParams(Builder builder) {
    super(builder);
    this.categorySettings = builder.categorySettings;
    this.linkSafety = builder.linkSafety;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the settings of every category, by category; empty when unset */
  public java.util.Optional<Map<String, PolicyCategorySettingsParams>> getCategorySettings() { return java.util.Optional.ofNullable(categorySettings); }

  /** @return (preview) what links do; empty when unset */
  public java.util.Optional<LinkSafetySettingsParams> getLinkSafety() { return java.util.Optional.ofNullable(linkSafety); }

  /** Builds {@link PolicySettingsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Map<String, PolicyCategorySettingsParams> categorySettings;
    private @Nullable LinkSafetySettingsParams linkSafety;

    private Builder() {}

    /**
     * @param value the settings of every category, by category
     * @return this builder
     */
    public Builder setCategorySettings(@Nullable Map<String, PolicyCategorySettingsParams> value) { this.categorySettings = value == null ? null : java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(value)); return this; }

    /**
     * @param value (preview) what links do; null unsets it
     * @return this builder
     */
    public Builder setLinkSafety(@Nullable LinkSafetySettingsParams value) { this.linkSafety = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public PolicySettingsParams build() { return checkRequired(new PolicySettingsParams(this)); }
  }
}
