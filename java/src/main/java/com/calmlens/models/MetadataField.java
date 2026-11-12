package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * A metadata field definition.
 */
public final class MetadataField extends CalmLensObject {
  @Required private String id;
  @Required private String title;
  private String description;
  @Required private MetadataFieldType type;
  @Required private MetadataFieldIcon icon;
  @Required private String color;

  private MetadataField() {}

  /** @return field identifier */
  public String getId() { return required(id, "id"); }

  /** @return display title */
  public String getTitle() { return required(title, "title"); }

  /** @return what the field holds; empty when the API sends none */
  public Optional<String> getDescription() { return Optional.ofNullable(description); }

  /** @return {@code string}, {@code number}, {@code boolean}, {@code date} or {@code url} */
  public MetadataFieldType getType() { return required(type, "type"); }

  /** @return {@code folder}, {@code hash}, {@code layers}, {@code link}, {@code photo}, {@code tag} or {@code user} */
  public MetadataFieldIcon getIcon() { return required(icon, "icon"); }

  /** @return display color, such as {@code #2563eb} */
  public String getColor() { return required(color, "color"); }

}
