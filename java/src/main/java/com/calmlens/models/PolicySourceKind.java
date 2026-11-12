package com.calmlens.models;

/**
 * Which part of a policy set a category's action. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum PolicySourceKind implements ApiEnum {
  DEFAULT("default"),
  ALLOWANCE("allowance"),
  RESTRICTION("restriction"),
  BELOW_THRESHOLD("below-threshold"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  PolicySourceKind(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "default"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static PolicySourceKind fromValue(String value) { return ApiEnum.fromValue(PolicySourceKind.class, value); }
}
