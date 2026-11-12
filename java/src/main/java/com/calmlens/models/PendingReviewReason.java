package com.calmlens.models;

/**
 * Why an asset waits for human review. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum PendingReviewReason implements ApiEnum {
  UNCERTAIN("uncertain"),
  SAMPLED("sampled"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  PendingReviewReason(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "uncertain"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static PendingReviewReason fromValue(String value) { return ApiEnum.fromValue(PendingReviewReason.class, value); }
}
