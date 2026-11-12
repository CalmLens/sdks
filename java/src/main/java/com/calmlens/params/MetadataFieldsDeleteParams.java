package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code metadataFields().delete}. */
public final class MetadataFieldsDeleteParams extends ApiParams {
  private final @Nullable Integer revision;

  private MetadataFieldsDeleteParams(Builder builder) {
    super(builder);
    this.revision = builder.revision;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the revision you read, so a concurrent edit is refused; empty when unset */
  public java.util.Optional<Integer> getRevision() { return java.util.Optional.ofNullable(revision); }

  /** Builds {@link MetadataFieldsDeleteParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Integer revision;

    private Builder() {}

    /**
     * @param value the revision you read, so a concurrent edit is refused; null unsets it
     * @return this builder
     */
    public Builder setRevision(@Nullable Integer value) { this.revision = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public MetadataFieldsDeleteParams build() { return checkRequired(new MetadataFieldsDeleteParams(this)); }
  }
}
