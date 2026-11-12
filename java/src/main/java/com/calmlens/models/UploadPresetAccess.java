package com.calmlens.models;

/**
 * Who can upload through an upload preset. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum UploadPresetAccess implements ApiEnum {
  ANYONE("anyone"),
  TOKEN("token"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  UploadPresetAccess(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "anyone"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static UploadPresetAccess fromValue(String value) { return ApiEnum.fromValue(UploadPresetAccess.class, value); }
}
