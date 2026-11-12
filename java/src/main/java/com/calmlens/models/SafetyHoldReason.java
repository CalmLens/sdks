package com.calmlens.models;

/**
 * Why an asset is under a safety hold. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum SafetyHoldReason implements ApiEnum {
  SUSPECTED_ILLEGAL_CONTENT("suspected-illegal-content"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  SafetyHoldReason(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "suspected-illegal-content"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static SafetyHoldReason fromValue(String value) { return ApiEnum.fromValue(SafetyHoldReason.class, value); }
}
