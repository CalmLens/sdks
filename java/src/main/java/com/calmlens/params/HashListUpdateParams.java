package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.HashListAction;
import org.jspecify.annotations.Nullable;

/** Options for {@code hashLists().update}; unset options keep their value. A new action applies to later uploads. */
public final class HashListUpdateParams extends ApiParams {
  private final @Nullable String name;
  private final @Nullable Patch<String> description;
  private final @Nullable HashListAction action;

  private HashListUpdateParams(Builder builder) {
    super(builder);
    this.name = builder.name;
    this.description = builder.description;
    this.action = builder.action;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the new name; a list always has one, so it can't be cleared; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return the description: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getDescription() { return java.util.Optional.ofNullable(description == null ? null : description.get()); }

  /** @return what later matches do; a list always has an action, so it can't be cleared; empty when unset */
  public java.util.Optional<HashListAction> getAction() { return java.util.Optional.ofNullable(action); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("description") && description != null && description.isClear()); }

  /** Builds {@link HashListUpdateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String name;
    private @Nullable Patch<String> description;
    private @Nullable HashListAction action;

    private Builder() {}

    /**
     * @param value the new name; a list always has one, so it can't be cleared; null unsets it
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @param value the description; null unsets it
     * @return this builder
     */
    public Builder setDescription(@Nullable String value) { this.description = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for description, clearing it.
     *
     * @return this builder
     */
    public Builder clearDescription() { this.description = Patch.clear(); return this; }

    /**
     * @param value what later matches do; a list always has an action, so it can't be cleared; null unsets it
     * @return this builder
     */
    public Builder setAction(@Nullable HashListAction value) { this.action = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public HashListUpdateParams build() { return checkRequired(new HashListUpdateParams(this)); }
  }
}
