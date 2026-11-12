package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * One rendition of the adaptive stream, as the HLS master playlist lists it.
 */
public final class AssetHlsRendition extends CalmLensObject {
  @Required private HlsRenditionKind kind;
  private Integer width;
  private Integer height;
  @Required private Long bandwidth;
  @Required private String codecs;

  private AssetHlsRendition() {}

  /** @return {@code video} for a picture size (video renditions carry no sound; they play with the {@code audio} rendition), or {@code audio} */
  public HlsRenditionKind getKind() { return required(kind, "kind"); }

  /** @return picture width in pixels; null for audio; empty when the API sends none */
  public Optional<Integer> getWidth() { return Optional.ofNullable(width); }

  /** @return picture height in pixels; null for audio; empty when the API sends none */
  public Optional<Integer> getHeight() { return Optional.ofNullable(height); }

  /** @return peak bit rate in bits per second, counting the audio a video rendition plays with */
  public long getBandwidth() { return required(bandwidth, "bandwidth"); }

  /** @return the rendition's codecs as RFC 6381 names, such as {@code avc1.64001f} */
  public String getCodecs() { return required(codecs, "codecs"); }
}
