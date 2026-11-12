package com.calmlens.models;

/**
 * Who caused an event. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum ActorType implements ApiEnum {
  USER("user"),
  API_KEY("api-key"),
  AUTOMATED("automated"),
  SYSTEM("system"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  ActorType(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "user"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static ActorType fromValue(String value) { return ApiEnum.fromValue(ActorType.class, value); }
}
