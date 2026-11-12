package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * The still image that stands for an asset, as the CDN's {@code preview} resource serves it: the
 * image itself, a website's screenshot, a document's first page or an audio waveform.
 */
public final class AssetPreview extends CalmLensObject {
  private Integer width;
  private Integer height;
  private String thumbhash;
  private String averageColor;

  private AssetPreview() {}

  /** @return width in pixels; null when unknown; empty when the API sends none */
  public Optional<Integer> getWidth() { return Optional.ofNullable(width); }

  /** @return height in pixels; null when unknown; empty when the API sends none */
  public Optional<Integer> getHeight() { return Optional.ofNullable(height); }

  /** @return ThumbHash placeholder to render while the preview loads; null until processed; empty when the API sends none */
  public Optional<String> getThumbhash() { return Optional.ofNullable(thumbhash); }

  /** @return average colour of the preview; null until processed; empty when the API sends none */
  public Optional<String> getAverageColor() { return Optional.ofNullable(averageColor); }
}
