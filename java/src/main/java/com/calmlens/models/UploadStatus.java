package com.calmlens.models;

/**
 * Whether an asset's source content has been received. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum UploadStatus implements ApiEnum {
  UPLOADING("uploading"),
  COMPLETED("completed"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  UploadStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "uploading"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static UploadStatus fromValue(String value) { return ApiEnum.fromValue(UploadStatus.class, value); }
}
