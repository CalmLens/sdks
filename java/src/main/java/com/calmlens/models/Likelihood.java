package com.calmlens.models;

/**
 * How likely content belongs to a category or qualifier. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum Likelihood implements ApiEnum {
  VERY_UNLIKELY("very-unlikely"),
  UNLIKELY("unlikely"),
  POSSIBLE("possible"),
  LIKELY("likely"),
  VERY_LIKELY("very-likely"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  Likelihood(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "very-unlikely"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static Likelihood fromValue(String value) { return ApiEnum.fromValue(Likelihood.class, value); }
}
