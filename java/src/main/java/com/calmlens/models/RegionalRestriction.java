package com.calmlens.models;

/**
 * What a region's rules do to an asset. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum RegionalRestriction implements ApiEnum {
  LIMITED("limited"),
  AGE_RESTRICTED("age-restricted"),
  BLOCKED("blocked"),
  PURGED("purged"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  RegionalRestriction(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "limited"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static RegionalRestriction fromValue(String value) { return ApiEnum.fromValue(RegionalRestriction.class, value); }
}
