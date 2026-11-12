package com.calmlens.models;

/**
 * Who recorded a review decision. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum ReviewerType implements ApiEnum {
  USER("user"),
  API_KEY("api-key"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  ReviewerType(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "user"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static ReviewerType fromValue(String value) { return ApiEnum.fromValue(ReviewerType.class, value); }
}
