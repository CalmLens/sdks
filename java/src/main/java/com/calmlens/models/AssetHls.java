package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * The adaptive (HLS) stream of audio or video, with fragmented MP4 (CMAF) segments, as the CDN's
 * {@code hls} resource serves it at {@code hls/index.m3u8}.
 */
public final class AssetHls extends CalmLensObject {
  @Required private HlsStatus status;
  private HlsUnavailableReason reason;
  @Required private List<AssetHlsRendition> renditions;

  private AssetHls() {}

  /** @return status */
  public HlsStatus getStatus() { return required(status, "status"); }

  /** @return reason; empty when the API sends none */
  public Optional<HlsUnavailableReason> getReason() { return Optional.ofNullable(reason); }

  /** @return every rendition, video from the largest down, then audio */
  public List<AssetHlsRendition> getRenditions() { return required(renditions, "renditions"); }
}
