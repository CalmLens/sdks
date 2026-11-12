package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * The one displayable file of an asset, as the CDN's {@code rendered} resource serves it.
 */
public final class AssetRendered extends CalmLensObject {
  @Required private AssetRenderedKind kind;
  @Required private String format;
  private Integer width;
  private Integer height;
  private List<Double> peaks;

  private AssetRendered() {}

  /** @return {@code image}, {@code pdf}, {@code video} or {@code audio}; only an image takes lenses and transforms */
  public AssetRenderedKind getKind() { return required(kind, "kind"); }

  /** @return the file's MIME type */
  public String getFormat() { return required(format, "format"); }

  /** @return width in pixels; null when unknown or not visual; empty when the API sends none */
  public Optional<Integer> getWidth() { return Optional.ofNullable(width); }

  /** @return height in pixels, like {@code width}; empty when the API sends none */
  public Optional<Integer> getHeight() { return Optional.ofNullable(height); }

  /** @return audio waveform peaks from 0 to 1; null for other kinds and before processing; empty when the API sends none */
  public Optional<List<Double>> getPeaks() { return Optional.ofNullable(peaks); }
}
