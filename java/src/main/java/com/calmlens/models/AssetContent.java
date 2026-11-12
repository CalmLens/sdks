package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * An asset's content state and details.
 */
public final class AssetContent extends CalmLensObject {
  @Required private AssetContentStatus status;
  private ContentRemovalReason removalReason;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;
  private SafetyHold safetyHold;
  private String format;
  private String extension;
  private Long sizeInBytes;
  private Checksums checksums;
  private Integer width;
  private Integer height;
  private Double durationSeconds;
  private Integer pageCount;
  private String perceptualHash;
  private Integer perceptualHashQuality;
  private FileMetadata metadata;
  private ExtractedText extractedText;
  private AssetRendered rendered;
  private AssetHls hls;
  private AssetPreview preview;

  private AssetContent() {}

  /** @return whether CalmLens holds the content: {@code temporary}, {@code stored} or {@code removed} */
  public AssetContentStatus getStatus() { return required(status, "status"); }

  /** @return why the content was removed: {@code policy}, {@code retention}, {@code requested}, {@code parent-removed} or {@code disposed}; null while content is held; empty when the API sends none */
  public Optional<ContentRemovalReason> getRemovalReason() { return Optional.ofNullable(removalReason); }

  /** @return when the content status last changed; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }

  /** @return safety hold, if any; empty when the API sends none */
  public Optional<SafetyHold> getSafetyHold() { return Optional.ofNullable(safetyHold); }

  /** @return MIME type of the content; empty when the API sends none */
  public Optional<String> getFormat() { return Optional.ofNullable(format); }

  /** @return file extension of the content; empty when the API sends none */
  public Optional<String> getExtension() { return Optional.ofNullable(extension); }

  /** @return size of the uploaded content; empty when the API sends none */
  public Optional<Long> getSizeInBytes() { return Optional.ofNullable(sizeInBytes); }

  /** @return digests of the uploaded content; empty when the API sends none */
  public Optional<Checksums> getChecksums() { return Optional.ofNullable(checksums); }

  /** @return the upload's width in pixels, for images, video and websites; null when unknown; empty when the API sends none */
  public Optional<Integer> getWidth() { return Optional.ofNullable(width); }

  /** @return the upload's height in pixels, like {@code width}; empty when the API sends none */
  public Optional<Integer> getHeight() { return Optional.ofNullable(height); }

  /** @return the length of audio and video; null for other assets; empty when the API sends none */
  public Optional<Double> getDurationSeconds() { return Optional.ofNullable(durationSeconds); }

  /** @return the number of pages of a document; null for other assets; empty when the API sends none */
  public Optional<Integer> getPageCount() { return Optional.ofNullable(pageCount); }

  /** @return perceptual hash for matching similar images, for image assets; empty when the API sends none */
  public Optional<String> getPerceptualHash() { return Optional.ofNullable(perceptualHash); }

  /** @return the perceptual hash's quality from 0 to 100; low values match less reliably; empty when the API sends none */
  public Optional<Integer> getPerceptualHashQuality() { return Optional.ofNullable(perceptualHashQuality); }

  /** @return metadata embedded in an uploaded image, such as its capture time, camera and software; read-only and separate from the asset's own {@code metadata}. Null when the image declares none, for other asset types, once the content is removed and while the asset is held; empty when the API sends none */
  public Optional<FileMetadata> getMetadata() { return Optional.ofNullable(metadata); }

  /** @return text extracted from the content; empty when the API sends none */
  public Optional<ExtractedText> getExtractedText() { return Optional.ofNullable(extractedText); }

  /** @return the displayable file the CDN's {@code rendered} resource serves; null when the asset has none (text, spreadsheets, other files, before processing makes one, once the content is removed and while a safety hold is on); empty when the API sends none */
  public Optional<AssetRendered> getRendered() { return Optional.ofNullable(rendered); }

  /** @return (preview) the adaptive stream of video or audio the CDN's {@code hls} resource serves and the {@code embed} page plays, once streaming has prepared it from the rendered file; null for other assets, until a stream is prepared, once the content is removed and while a safety hold is on; empty when the API sends none */
  public Optional<AssetHls> getHls() { return Optional.ofNullable(hls); }

  /** @return the still image the CDN's {@code preview} resource serves; null when the asset has none, like {@code rendered}; empty when the API sends none */
  public Optional<AssetPreview> getPreview() { return Optional.ofNullable(preview); }
}
