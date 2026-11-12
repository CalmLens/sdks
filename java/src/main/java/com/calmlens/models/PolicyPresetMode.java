package com.calmlens.models;

/**
 * How a policy follows its preset. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum PolicyPresetMode implements ApiEnum {
  LIVE("live"),
  PINNED("pinned"),
  COPY("copy"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  PolicyPresetMode(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "live"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static PolicyPresetMode fromValue(String value) { return ApiEnum.fromValue(PolicyPresetMode.class, value); }
}
