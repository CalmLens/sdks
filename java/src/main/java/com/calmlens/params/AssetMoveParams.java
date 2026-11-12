package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code assets().move}: set the target folder, or clear it to move the asset to the project root. */
public final class AssetMoveParams extends ApiParams {
  @Required private final @Nullable Patch<String> folderId;

  private AssetMoveParams(Builder builder) {
    super(builder);
    this.folderId = builder.folderId;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the target folder: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getFolderId() { return java.util.Optional.ofNullable(folderId == null ? null : folderId.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("folderId") && folderId != null && folderId.isClear()); }

  /** Builds {@link AssetMoveParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Patch<String> folderId;

    private Builder() {}

    /**
     * @param value the target folder; null unsets it
     * @return this builder
     */
    public Builder setFolderId(@Nullable String value) { this.folderId = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for folderId, clearing it.
     *
     * @return this builder
     */
    public Builder clearFolderId() { this.folderId = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public AssetMoveParams build() { return checkRequired(new AssetMoveParams(this)); }
  }
}
