package com.calmlens.params;

import com.calmlens.internal.Json.MetadataValueAdapter;
import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import org.jspecify.annotations.Nullable;

/** One metadata entry. Values are strings, numbers, booleans, null, lists or maps. */
public final class MetadataItemParams extends ApiParams {
  @Required private final @Nullable String id;
  @JsonAdapter(value = MetadataValueAdapter.class, nullSafe = false) private final @Nullable Object value;

  private MetadataItemParams(Builder builder) {
    super(builder);
    this.id = builder.id;
    this.value = builder.value;
  }

  /**
   * @param id the metadata field's ID
   * @param value the value: a string, number, boolean, null, list or map
   * @return the entry
   */
  public static MetadataItemParams of(String id, @Nullable Object value) { return builder().setId(id).setValue(value).build(); }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the metadata field's ID; empty when unset */
  public java.util.Optional<String> getId() { return java.util.Optional.ofNullable(id); }

  /** @return the value; null is sent as null; empty when unset */
  public java.util.Optional<Object> getValue() { return java.util.Optional.ofNullable(value); }

  /** Builds {@link MetadataItemParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String id;
    private @Nullable Object value;

    private Builder() {}

    /**
     * @param value the metadata field's ID
     * @return this builder
     */
    public Builder setId(@Nullable String value) { this.id = value; return this; }

    /**
     * @param value the value; null is sent as null; null unsets it
     * @return this builder
     */
    public Builder setValue(@Nullable Object value) { this.value = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public MetadataItemParams build() { return checkRequired(new MetadataItemParams(this)); }
  }
}
