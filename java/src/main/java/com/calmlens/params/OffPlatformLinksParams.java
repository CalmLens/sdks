package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** (Preview) what links to other sites do. */
public final class OffPlatformLinksParams extends ApiParams {
  private final @Nullable String action;
  private final @Nullable List<String> allowedDomains;

  private OffPlatformLinksParams(Builder builder) {
    super(builder);
    this.action = builder.action;
    this.allowedDomains = builder.allowedDomains;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the action; empty when unset */
  public java.util.Optional<String> getAction() { return java.util.Optional.ofNullable(action); }

  /** @return domains that don't count as other sites; empty when unset */
  public java.util.Optional<List<String>> getAllowedDomains() { return java.util.Optional.ofNullable(allowedDomains); }

  /** Builds {@link OffPlatformLinksParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String action;
    private @Nullable List<String> allowedDomains;

    private Builder() {}

    /**
     * @param value the action; null unsets it
     * @return this builder
     */
    public Builder setAction(@Nullable String value) { this.action = value; return this; }

    /**
     * @param value domains that don't count as other sites; null unsets it
     * @return this builder
     */
    public Builder setAllowedDomains(@Nullable List<String> value) { this.allowedDomains = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public OffPlatformLinksParams build() { return checkRequired(new OffPlatformLinksParams(this)); }
  }
}
