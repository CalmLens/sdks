package com.calmlens.models;

/**
 * Whether an adaptive stream is ready ({@code content.hls.status}). A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum HlsStatus implements ApiEnum {
  PREPARING("preparing"),
  READY("ready"),
  UNAVAILABLE("unavailable"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  HlsStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "preparing"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static HlsStatus fromValue(String value) { return ApiEnum.fromValue(HlsStatus.class, value); }
}
