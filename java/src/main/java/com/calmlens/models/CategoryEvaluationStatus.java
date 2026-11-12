package com.calmlens.models;

/**
 * Whether a category was evaluated. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum CategoryEvaluationStatus implements ApiEnum {
  EVALUATED("evaluated"),
  PARTIAL("partial"),
  NOT_EVALUATED("not-evaluated"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  CategoryEvaluationStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "evaluated"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static CategoryEvaluationStatus fromValue(String value) { return ApiEnum.fromValue(CategoryEvaluationStatus.class, value); }
}
