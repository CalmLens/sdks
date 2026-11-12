package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.SearchMode;
import org.jspecify.annotations.Nullable;

/** Options for {@code assets().search}. */
public final class AssetSearchParams extends ApiParams {
  @Required private final @Nullable String query;
  private final @Nullable Integer pageSize;
  private final @Nullable SearchMode mode;

  private AssetSearchParams(Builder builder) {
    super(builder);
    this.query = builder.query;
    this.pageSize = builder.pageSize;
    this.mode = builder.mode;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the text to search for; empty when unset */
  public java.util.Optional<String> getQuery() { return java.util.Optional.ofNullable(query); }

  /** @return how many of the best matches to return, 1 to 20 (default 10); empty when unset */
  public java.util.Optional<Integer> getPageSize() { return java.util.Optional.ofNullable(pageSize); }

  /** @return how to search; {@code hybrid} when unset; empty when unset */
  public java.util.Optional<SearchMode> getMode() { return java.util.Optional.ofNullable(mode); }

  /** Builds {@link AssetSearchParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String query;
    private @Nullable Integer pageSize;
    private @Nullable SearchMode mode;

    private Builder() {}

    /**
     * @param value the text to search for
     * @return this builder
     */
    public Builder setQuery(@Nullable String value) { this.query = value; return this; }

    /**
     * @param value how many of the best matches to return, 1 to 20 (default 10); null unsets it
     * @return this builder
     */
    public Builder setPageSize(@Nullable Integer value) { this.pageSize = value; return this; }

    /**
     * @param value how to search; {@code hybrid} when unset; null unsets it
     * @return this builder
     */
    public Builder setMode(@Nullable SearchMode value) { this.mode = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public AssetSearchParams build() { return checkRequired(new AssetSearchParams(this)); }
  }
}
