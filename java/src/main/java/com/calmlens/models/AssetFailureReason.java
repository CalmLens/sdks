package com.calmlens.models;

/**
 * Why processing an asset failed ({@code classification.failureReason}). A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetFailureReason implements ApiEnum {
  FILE_TOO_LARGE("file-too-large"),
  DURATION_LIMIT("duration-limit"),
  RESOLUTION_LIMIT("resolution-limit"),
  UNSUPPORTED_FORMAT("unsupported-format"),
  UNDECODABLE_CONTENT("undecodable-content"),
  MULTIPLE_TRACKS("multiple-tracks"),
  TYPE_MISMATCH("type-mismatch"),
  FREE_UPLOADS_EXHAUSTED("free-uploads-exhausted"),
  MEDIA_LIMIT("media-limit"),
  UPLOADS_PAUSED("uploads-paused"),
  TOO_MANY_ITEMS("too-many-items"),
  PROCESSING_ERROR("processing-error"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetFailureReason(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "file-too-large"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetFailureReason fromValue(String value) { return ApiEnum.fromValue(AssetFailureReason.class, value); }
}
