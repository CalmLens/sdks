package com.calmlens.models;

/**
 * The icon of a metadata field. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum MetadataFieldIcon implements ApiEnum {
  TAG("tag"),
  FOLDER("folder"),
  HASH("hash"),
  LAYERS("layers"),
  LINK("link"),
  PHOTO("photo"),
  USER("user"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  MetadataFieldIcon(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "tag"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static MetadataFieldIcon fromValue(String value) { return ApiEnum.fromValue(MetadataFieldIcon.class, value); }
}
