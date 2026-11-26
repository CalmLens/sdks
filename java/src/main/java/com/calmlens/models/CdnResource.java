package com.calmlens.models;

/**
 * A resource beneath an asset's CDN URL. Beneath a signed asset URL, only one signed for {@link
 * #ORIGINAL} serves the exact upload.
 */
public enum CdnResource implements ApiEnum {
  /** The exact upload. It takes no lens or transform. */
  ORIGINAL("original"),
  /** The displayable file: an image in the best format the client accepts, a PDF, or browser-safe video or audio. */
  RENDERED("rendered"),
  /** A still image that stands for the asset. It takes a lens or transform. */
  PREVIEW("preview"),
  /** A small blurred PNG, public for every asset whatever its visibility or moderation status. */
  PLACEHOLDER("placeholder"),
  /** The adaptive stream of audio or video, its HLS master playlist at {@code hls/index.m3u8}. */
  HLS("hls"),
  /** An HTML page that shows the asset, for an iframe. */
  EMBED("embed"),
  /** The asset's display info. */
  INFO("info"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  CdnResource(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "rendered"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static CdnResource fromValue(String value) { return ApiEnum.fromValue(CdnResource.class, value); }
}
