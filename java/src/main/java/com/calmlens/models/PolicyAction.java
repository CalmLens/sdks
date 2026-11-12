package com.calmlens.models;

/**
 * What a policy does with content. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum PolicyAction implements ApiEnum {
  ALLOW("allow"),
  LIMIT("limit"),
  AGE_RESTRICT("age-restrict"),
  BLOCK("block"),
  PURGE("purge"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  PolicyAction(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "allow"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static PolicyAction fromValue(String value) { return ApiEnum.fromValue(PolicyAction.class, value); }
}
