package com.calmlens.models;

/**
 * The value type of a metadata field. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum MetadataFieldType implements ApiEnum {
  STRING("string"),
  NUMBER("number"),
  BOOLEAN("boolean"),
  DATE("date"),
  URL("url"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  MetadataFieldType(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "string"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static MetadataFieldType fromValue(String value) { return ApiEnum.fromValue(MetadataFieldType.class, value); }
}
