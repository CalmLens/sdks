package com.calmlens.models;

/**
 * The state of an asset batch. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum BatchStatus implements ApiEnum {
  QUEUED("queued"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  BatchStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "queued"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static BatchStatus fromValue(String value) { return ApiEnum.fromValue(BatchStatus.class, value); }
}
