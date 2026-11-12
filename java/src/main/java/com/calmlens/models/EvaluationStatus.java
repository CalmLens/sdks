package com.calmlens.models;

/**
 * Whether a qualifier or processing feature was evaluated. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum EvaluationStatus implements ApiEnum {
  EVALUATED("evaluated"),
  NOT_EVALUATED("not-evaluated"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  EvaluationStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "evaluated"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static EvaluationStatus fromValue(String value) { return ApiEnum.fromValue(EvaluationStatus.class, value); }
}
