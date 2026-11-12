package com.calmlens.models;

/**
 * Whether a remote URL rule allows or denies its domains. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum RemoteUrlMode implements ApiEnum {
  ALLOW("allow"),
  DENY("deny"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  RemoteUrlMode(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "allow"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static RemoteUrlMode fromValue(String value) { return ApiEnum.fromValue(RemoteUrlMode.class, value); }
}
