package com.calmlens.models;

/**
 * What an asset's rendered file is ({@code content.rendered.kind}): an image, a PDF, video or audio. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetRenderedKind implements ApiEnum {
  /** A still image; it takes lenses and transforms. */
  IMAGE("image"),
  /** A PDF. */
  PDF("pdf"),
  /** Browser-safe video. */
  VIDEO("video"),
  /** Browser-safe audio. */
  AUDIO("audio"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetRenderedKind(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "image"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetRenderedKind fromValue(String value) { return ApiEnum.fromValue(AssetRenderedKind.class, value); }
}
