package com.calmlens.models;

/**
 * What one rendition of an adaptive stream carries. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum HlsRenditionKind implements ApiEnum {
  VIDEO("video"),
  AUDIO("audio"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  HlsRenditionKind(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "video"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static HlsRenditionKind fromValue(String value) { return ApiEnum.fromValue(HlsRenditionKind.class, value); }
}
