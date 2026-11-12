package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * The part of {@link AssetContent} that {@link AssetInfo} carries.
 */
public final class AssetInfoContent extends CalmLensObject {
  private String format;
  private Integer width;
  private Integer height;
  private Double durationSeconds;
  private Integer pageCount;
  private AssetRendered rendered;
  private AssetPreview preview;
  private AssetHls hls;

  private AssetInfoContent() {}

  /** @return the content's MIME type; it tells a spreadsheet from other documents; empty when the API sends none */
  public Optional<String> getFormat() { return Optional.ofNullable(format); }

  /** @return width in pixels; null when unknown or not visual; empty when the API sends none */
  public Optional<Integer> getWidth() { return Optional.ofNullable(width); }

  /** @return height in pixels, like {@code width}; empty when the API sends none */
  public Optional<Integer> getHeight() { return Optional.ofNullable(height); }

  /** @return audio or video length; null for other content; empty when the API sends none */
  public Optional<Double> getDurationSeconds() { return Optional.ofNullable(durationSeconds); }

  /** @return a document's pages; null for other content; empty when the API sends none */
  public Optional<Integer> getPageCount() { return Optional.ofNullable(pageCount); }

  /** @return the displayable file; null when there is none; empty when the API sends none */
  public Optional<AssetRendered> getRendered() { return Optional.ofNullable(rendered); }

  /** @return the still image; null when there is none; empty when the API sends none */
  public Optional<AssetPreview> getPreview() { return Optional.ofNullable(preview); }

  /** @return the adaptive stream; null until one is prepared; empty when the API sends none */
  public Optional<AssetHls> getHls() { return Optional.ofNullable(hls); }
}
