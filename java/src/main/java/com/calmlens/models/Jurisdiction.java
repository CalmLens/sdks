package com.calmlens.models;

/**
 * A jurisdiction a project can opt out of. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum Jurisdiction implements ApiEnum {
  EU("EU"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  Jurisdiction(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "EU"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static Jurisdiction fromValue(String value) { return ApiEnum.fromValue(Jurisdiction.class, value); }
}
