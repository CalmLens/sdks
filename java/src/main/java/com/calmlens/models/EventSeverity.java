package com.calmlens.models;

/**
 * How important an event is. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum EventSeverity implements ApiEnum {
  LOW("low"),
  HIGH("high"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  EventSeverity(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "low"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static EventSeverity fromValue(String value) { return ApiEnum.fromValue(EventSeverity.class, value); }
}
