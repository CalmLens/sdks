package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.RemoteUrlMode;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Which remote URLs may be uploaded. */
public final class RemoteUrlRuleParams extends ApiParams {
  @Required private final @Nullable RemoteUrlMode mode;
  @Required private final @Nullable List<String> domains;

  private RemoteUrlRuleParams(Builder builder) {
    super(builder);
    this.mode = builder.mode;
    this.domains = builder.domains;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return whether the domains are allowed or denied; empty when unset */
  public java.util.Optional<RemoteUrlMode> getMode() { return java.util.Optional.ofNullable(mode); }

  /** @return the domains; empty when unset */
  public java.util.Optional<List<String>> getDomains() { return java.util.Optional.ofNullable(domains); }

  /** Builds {@link RemoteUrlRuleParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable RemoteUrlMode mode;
    private @Nullable List<String> domains;

    private Builder() {}

    /**
     * @param value whether the domains are allowed or denied
     * @return this builder
     */
    public Builder setMode(@Nullable RemoteUrlMode value) { this.mode = value; return this; }

    /**
     * @param value the domains
     * @return this builder
     */
    public Builder setDomains(@Nullable List<String> value) { this.domains = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public RemoteUrlRuleParams build() { return checkRequired(new RemoteUrlRuleParams(this)); }
  }
}
