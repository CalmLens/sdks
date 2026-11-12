package com.calmlens.models;

/**
 * A region with its own legal restrictions. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum Region implements ApiEnum {
  EU("EU"),
  GB("GB"),
  DE("DE"),
  FR("FR"),
  AT("AT"),
  AU("AU"),
  BR("BR"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  Region(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "EU"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static Region fromValue(String value) { return ApiEnum.fromValue(Region.class, value); }
}
