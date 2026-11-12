package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** (Preview) what a policy does with links. */
public final class LinkSafetySettingsParams extends ApiParams {
  private final @Nullable Map<String, String> verdictActions;
  private final @Nullable OffPlatformLinksParams offPlatformLinks;

  private LinkSafetySettingsParams(Builder builder) {
    super(builder);
    this.verdictActions = builder.verdictActions;
    this.offPlatformLinks = builder.offPlatformLinks;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the action for each link verdict; empty when unset */
  public java.util.Optional<Map<String, String>> getVerdictActions() { return java.util.Optional.ofNullable(verdictActions); }

  /** @return what links to other sites do; empty when unset */
  public java.util.Optional<OffPlatformLinksParams> getOffPlatformLinks() { return java.util.Optional.ofNullable(offPlatformLinks); }

  /** Builds {@link LinkSafetySettingsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Map<String, String> verdictActions;
    private @Nullable OffPlatformLinksParams offPlatformLinks;

    private Builder() {}

    /**
     * @param value the action for each link verdict; null unsets it
     * @return this builder
     */
    public Builder setVerdictActions(@Nullable Map<String, String> value) { this.verdictActions = value == null ? null : java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(value)); return this; }

    /**
     * @param value what links to other sites do; null unsets it
     * @return this builder
     */
    public Builder setOffPlatformLinks(@Nullable OffPlatformLinksParams value) { this.offPlatformLinks = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public LinkSafetySettingsParams build() { return checkRequired(new LinkSafetySettingsParams(this)); }
  }
}
