package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The method and extra headers of a CDN request. */
public final class HttpOptions extends ApiParams {
  private final @Nullable String method;
  private final @Nullable Map<String, String> headers;

  private HttpOptions(Builder builder) {
    super(builder);
    this.method = builder.method;
    this.headers = builder.headers;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return {@code GET} (default) or {@code HEAD}; empty when unset */
  public java.util.Optional<String> getMethod() { return java.util.Optional.ofNullable(method); }

  /** @return extra headers, such as {@code Range}; empty when unset */
  public java.util.Optional<Map<String, String>> getHeaders() { return java.util.Optional.ofNullable(headers); }

  /** Builds {@link HttpOptions}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String method;
    private @Nullable Map<String, String> headers;

    private Builder() {}

    /**
     * @param value {@code GET} (default) or {@code HEAD}; null unsets it
     * @return this builder
     */
    public Builder setMethod(@Nullable String value) { this.method = value; return this; }

    /**
     * @param value extra headers, such as {@code Range}; null unsets it
     * @return this builder
     */
    public Builder setHeaders(@Nullable Map<String, String> value) { this.headers = value == null ? null : java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(value)); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public HttpOptions build() { return checkRequired(new HttpOptions(this)); }
  }
}
