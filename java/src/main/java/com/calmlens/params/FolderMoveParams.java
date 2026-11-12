package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code folders().move}: set the new parent, or clear it to move the folder to the project root. */
public final class FolderMoveParams extends ApiParams {
  @Required private final @Nullable Patch<String> parentId;

  private FolderMoveParams(Builder builder) {
    super(builder);
    this.parentId = builder.parentId;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the new parent folder: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getParentId() { return java.util.Optional.ofNullable(parentId == null ? null : parentId.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("parentId") && parentId != null && parentId.isClear()); }

  /** Builds {@link FolderMoveParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Patch<String> parentId;

    private Builder() {}

    /**
     * @param value the new parent folder; null unsets it
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
    public FolderMoveParams build() { return checkRequired(new FolderMoveParams(this)); }
  }
}
