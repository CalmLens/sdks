package com.calmlens.models;

/**
 * Who can read an asset's content through the CDN. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum Visibility implements ApiEnum {
  /** Anyone with the CDN URL. */
  PUBLIC("public"),
  /** Only with the API key or a signed URL. */
  PRIVATE("private"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  Visibility(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "public"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static Visibility fromValue(String value) { return ApiEnum.fromValue(Visibility.class, value); }
}
