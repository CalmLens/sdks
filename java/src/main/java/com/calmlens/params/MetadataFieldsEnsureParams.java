package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Options for {@code metadataFields().ensure}. */
public final class MetadataFieldsEnsureParams extends ApiParams {
  private final @Nullable Integer revision;
  @Required private final @Nullable List<MetadataFieldParams> fields;

  private MetadataFieldsEnsureParams(Builder builder) {
    super(builder);
    this.revision = builder.revision;
    this.fields = builder.fields;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the revision you read, so a concurrent edit is refused; empty when unset */
  public java.util.Optional<Integer> getRevision() { return java.util.Optional.ofNullable(revision); }

  /** @return every field the project has; empty when unset */
  public java.util.Optional<List<MetadataFieldParams>> getFields() { return java.util.Optional.ofNullable(fields); }

  /** Builds {@link MetadataFieldsEnsureParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Integer revision;
    private @Nullable List<MetadataFieldParams> fields;

    private Builder() {}

    /**
     * @param value the revision you read, so a concurrent edit is refused; null unsets it
     * @return this builder
     */
    public Builder setRevision(@Nullable Integer value) { this.revision = value; return this; }

    /**
     * @param value every field the project has
     * @return this builder
     */
    public Builder setFields(@Nullable List<MetadataFieldParams> value) { this.fields = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public MetadataFieldsEnsureParams build() { return checkRequired(new MetadataFieldsEnsureParams(this)); }
  }
}
