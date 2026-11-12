package com.calmlens.models;

/**
 * Where a detected link was found. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum LinkSource implements ApiEnum {
  TEXT("text"),
  QR_CODE("qr-code"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  LinkSource(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "text"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static LinkSource fromValue(String value) { return ApiEnum.fromValue(LinkSource.class, value); }
}
