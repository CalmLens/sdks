package com.calmlens.models;

/**
 * A built-in policy preset. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum PolicyPresetId implements ApiEnum {
  GENERAL_COMMUNITY("general-community"),
  WHOLESOME_COMMUNITY("wholesome-community"),
  EDUCATION_SUPPORT("education-support"),
  CHILDREN_PLATFORM("children-platform"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  PolicyPresetId(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "general-community"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static PolicyPresetId fromValue(String value) { return ApiEnum.fromValue(PolicyPresetId.class, value); }
}
