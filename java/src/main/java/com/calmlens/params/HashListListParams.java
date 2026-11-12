package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code hashLists().list} and {@code hashLists().iterate}. */
public final class HashListListParams extends ApiParams {
  private final @Nullable String cursor;
  private final @Nullable Integer pageSize;
  private final @Nullable String sort;

  private HashListListParams(Builder builder) {
    super(builder);
    this.cursor = builder.cursor;
    this.pageSize = builder.pageSize;
    this.sort = builder.sort;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the previous page's {@code nextCursor}; empty when unset */
  public java.util.Optional<String> getCursor() { return java.util.Optional.ofNullable(cursor); }

  /** @return items per page, 1 to 100 (default 50); empty when unset */
  public java.util.Optional<Integer> getPageSize() { return java.util.Optional.ofNullable(pageSize); }

  /** @return comma-separated fields, each ascending unless prefixed with {@code -}, such as {@code -createdAt,id}; empty when unset */
  public java.util.Optional<String> getSort() { return java.util.Optional.ofNullable(sort); }

  /** Builds {@link HashListListParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String cursor;
    private @Nullable Integer pageSize;
    private @Nullable String sort;

    private Builder() {}

    /**
     * @param value the previous page's {@code nextCursor}; null unsets it
     * @return this builder
     */
    public Builder setCursor(@Nullable String value) { this.cursor = value; return this; }

    /**
     * @param value items per page, 1 to 100 (default 50); null unsets it
     * @return this builder
     */
    public Builder setPageSize(@Nullable Integer value) { this.pageSize = value; return this; }

    /**
     * @param value comma-separated fields, each ascending unless prefixed with {@code -}, such as {@code -createdAt,id}; null unsets it
     * @return this builder
     */
    public Builder setSort(@Nullable String value) { this.sort = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public HashListListParams build() { return checkRequired(new HashListListParams(this)); }
  }
}
