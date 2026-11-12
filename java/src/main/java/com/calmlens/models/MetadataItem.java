package com.calmlens.models;

import com.calmlens.internal.Json.MetadataValueAdapter;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;

/**
 * One metadata entry. Values are strings, numbers, booleans, lists or maps.
 */
public final class MetadataItem extends CalmLensObject {
  @Required private String id;
  @Required @JsonAdapter(value = MetadataValueAdapter.class, nullSafe = false) private Object value;

  private MetadataItem() {}

  /** @return metadata field identifier */
  public String getId() { return required(id, "id"); }

  /** @return field value */
  public Object getValue() { return required(value, "value"); }

}
