package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code folders().create}. */
public final class FolderCreateParams extends ApiParams {
  @Required private final @Nullable String name;
  private final @Nullable Patch<String> parentId;

  private FolderCreateParams(Builder builder) {
    super(builder);
    this.name = builder.name;
    this.parentId = builder.parentId;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the folder name; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return the parent folder; the project root when unset or cleared: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getParentId() { return java.util.Optional.ofNullable(parentId == null ? null : parentId.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("parentId") && parentId != null && parentId.isClear()); }

  /** Builds {@link FolderCreateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String name;
    private @Nullable Patch<String> parentId;

    private Builder() {}

    /**
     * @param value the folder name
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @param value the parent folder; the project root when unset or cleared; null unsets it
     * @return this builder
     */
    public Builder setParentId(@Nullable String value) { this.parentId = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for parentId, clearing it.
     *
     * @return this builder
     */
    public Builder clearParentId() { this.parentId = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public FolderCreateParams build() { return checkRequired(new FolderCreateParams(this)); }
  }
}
