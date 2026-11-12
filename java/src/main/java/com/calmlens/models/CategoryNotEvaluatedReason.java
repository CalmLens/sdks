package com.calmlens.models;

/**
 * Why a category or qualifier was not evaluated. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum CategoryNotEvaluatedReason implements ApiEnum {
  NOT_SUPPORTED("not-supported"),
  UNAVAILABLE("unavailable"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  CategoryNotEvaluatedReason(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "not-supported"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static CategoryNotEvaluatedReason fromValue(String value) { return ApiEnum.fromValue(CategoryNotEvaluatedReason.class, value); }
}
