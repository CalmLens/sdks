package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.MetadataFieldIcon;
import com.calmlens.models.MetadataFieldType;
import org.jspecify.annotations.Nullable;

/** A metadata field. */
public final class MetadataFieldParams extends ApiParams {
  @Required private final @Nullable String id;
  @Required private final @Nullable String title;
  private final @Nullable String description;
  @Required private final @Nullable MetadataFieldType type;
  @Required private final @Nullable MetadataFieldIcon icon;
  @Required private final @Nullable String color;

  private MetadataFieldParams(Builder builder) {
    super(builder);
    this.id = builder.id;
    this.title = builder.title;
    this.description = builder.description;
    this.type = builder.type;
    this.icon = builder.icon;
    this.color = builder.color;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the field ID; empty when unset */
  public java.util.Optional<String> getId() { return java.util.Optional.ofNullable(id); }

  /** @return the title; empty when unset */
  public java.util.Optional<String> getTitle() { return java.util.Optional.ofNullable(title); }

  /** @return the description; empty when unset */
  public java.util.Optional<String> getDescription() { return java.util.Optional.ofNullable(description); }

  /** @return the value type; empty when unset */
  public java.util.Optional<MetadataFieldType> getType() { return java.util.Optional.ofNullable(type); }

  /** @return the icon; empty when unset */
  public java.util.Optional<MetadataFieldIcon> getIcon() { return java.util.Optional.ofNullable(icon); }

  /** @return the colour, such as {@code #1d4ed8}; empty when unset */
  public java.util.Optional<String> getColor() { return java.util.Optional.ofNullable(color); }

  /** Builds {@link MetadataFieldParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String id;
    private @Nullable String title;
    private @Nullable String description;
    private @Nullable MetadataFieldType type;
    private @Nullable MetadataFieldIcon icon;
    private @Nullable String color;

    private Builder() {}

    /**
     * @param value the field ID
     * @return this builder
     */
    public Builder setId(@Nullable String value) { this.id = value; return this; }

    /**
     * @param value the title
     * @return this builder
     */
    public Builder setTitle(@Nullable String value) { this.title = value; return this; }

    /**
     * @param value the description; null unsets it
     * @return this builder
     */
    public Builder setDescription(@Nullable String value) { this.description = value; return this; }

    /**
     * @param value the value type
     * @return this builder
     */
    public Builder setType(@Nullable MetadataFieldType value) { this.type = value; return this; }

    /**
     * @param value the icon
     * @return this builder
     */
    public Builder setIcon(@Nullable MetadataFieldIcon value) { this.icon = value; return this; }

    /**
     * @param value the colour, such as {@code #1d4ed8}
     * @return this builder
     */
    public Builder setColor(@Nullable String value) { this.color = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public MetadataFieldParams build() { return checkRequired(new MetadataFieldParams(this)); }
  }
}
