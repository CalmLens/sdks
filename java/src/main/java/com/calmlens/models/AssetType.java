package com.calmlens.models;

/**
 * What kind of content an asset holds. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetType implements ApiEnum {
  IMAGE("image"),
  VIDEO("video"),
  AUDIO("audio"),
  PLAINTEXT_DOCUMENT("plaintext-document"),
  MULTIMEDIA_DOCUMENT("multimedia-document"),
  WEBSITE("website"),
  FILE("file"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetType(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "image"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetType fromValue(String value) { return ApiEnum.fromValue(AssetType.class, value); }
}
