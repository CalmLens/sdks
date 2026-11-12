package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code folders().update}; unset options keep their value. */
public final class FolderUpdateParams extends ApiParams {
  private final @Nullable String name;

  private FolderUpdateParams(Builder builder) {
    super(builder);
    this.name = builder.name;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the new name; a folder always has one, so it can't be cleared; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** Builds {@link FolderUpdateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String name;

    private Builder() {}

    /**
     * @param value the new name; a folder always has one, so it can't be cleared; null unsets it
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public FolderUpdateParams build() { return checkRequired(new FolderUpdateParams(this)); }
  }
}
