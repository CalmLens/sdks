package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Processing options for an asset.
 */
public final class ProcessingOptions extends CalmLensObject {
  private Boolean retainContent;
  private Boolean storeSensitiveMetadata;
  private ProcessingFeatures features;

  private ProcessingOptions() {}

  /** @return whether stored content is kept after classification; empty when the API sends none */
  public Optional<Boolean> getRetainContent() { return Optional.ofNullable(retainContent); }

  /** @return overrides the project's {@code storeSensitiveMetadata} setting for this upload: when false, embedded image metadata (EXIF, XMP and IPTC) is removed from the file before it is stored, and {@code content.metadata} leaves out the creator and location; when true, the image is stored as uploaded; empty when the API sends none */
  public Optional<Boolean> getStoreSensitiveMetadata() { return Optional.ofNullable(storeSensitiveMetadata); }

  /** @return optional analyses to run, such as OCR; empty when the API sends none */
  public Optional<ProcessingFeatures> getFeatures() { return Optional.ofNullable(features); }

}
