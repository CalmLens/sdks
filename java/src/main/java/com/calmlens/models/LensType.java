package com.calmlens.models;

/**
 * The asset type a lens applies to. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum LensType implements ApiEnum {
  IMAGE("image"),
  VIDEO("video"),
  AUDIO("audio"),
  DOCUMENT("document"),
  WEBSITE("website"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  LensType(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "image"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static LensType fromValue(String value) { return ApiEnum.fromValue(LensType.class, value); }
}
