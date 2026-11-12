package com.calmlens.models;

/**
 * What kind of text was extracted. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum ExtractedTextType implements ApiEnum {
  STRING("string"),
  DOCUMENT("document"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  ExtractedTextType(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "string"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static ExtractedTextType fromValue(String value) { return ApiEnum.fromValue(ExtractedTextType.class, value); }
}
