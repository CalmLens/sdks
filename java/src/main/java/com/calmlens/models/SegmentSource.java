package com.calmlens.models;

/**
 * What a timeline segment of an audio or video asset was classified from. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum SegmentSource implements ApiEnum {
  FRAME("frame"),
  FRAME_TEXT("frame-text"),
  CLIP("clip"),
  SPEECH("speech"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  SegmentSource(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "frame"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static SegmentSource fromValue(String value) { return ApiEnum.fromValue(SegmentSource.class, value); }
}
