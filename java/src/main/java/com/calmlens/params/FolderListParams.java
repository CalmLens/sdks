package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code folders().list}. */
public final class FolderListParams extends ApiParams {
  private final @Nullable String parentId;
  private final @Nullable String cursor;
  private final @Nullable Integer pageSize;
  private final @Nullable String sort;
  private final @Nullable String search;

  private FolderListParams(Builder builder) {
    super(builder);
    this.parentId = builder.parentId;
    this.cursor = builder.cursor;
    this.pageSize = builder.pageSize;
    this.sort = builder.sort;
    this.search = builder.search;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the parent folder; the project root when unset; empty when unset */
  public java.util.Optional<String> getParentId() { return java.util.Optional.ofNullable(parentId); }

  /** @return the previous page's {@code nextCursor}; empty when unset */
  public java.util.Optional<String> getCursor() { return java.util.Optional.ofNullable(cursor); }

  /** @return items per page, 1 to 100 (default 50); empty when unset */
  public java.util.Optional<Integer> getPageSize() { return java.util.Optional.ofNullable(pageSize); }

  /** @return comma-separated fields, each ascending unless prefixed with {@code -}, such as {@code -createdAt,id}; empty when unset */
  public java.util.Optional<String> getSort() { return java.util.Optional.ofNullable(sort); }

  /** @return a name to search for across the project; empty when unset */
  public java.util.Optional<String> getSearch() { return java.util.Optional.ofNullable(search); }

  /** Builds {@link FolderListParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String parentId;
    private @Nullable String cursor;
    private @Nullable Integer pageSize;
    private @Nullable String sort;
    private @Nullable String search;

    private Builder() {}

    /**
     * @param value the parent folder; the project root when unset; null unsets it
     * @return this builder
     */
    public Builder setParentId(@Nullable String value) { this.parentId = value; return this; }

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
     * @param value a name to search for across the project; null unsets it
     * @return this builder
     */
    public Builder setSearch(@Nullable String value) { this.search = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public FolderListParams build() { return checkRequired(new FolderListParams(this)); }
  }
}
