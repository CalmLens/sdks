package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Descriptive metadata embedded in an uploaded image. Each text value is null when the file
 * doesn't record it.
 */
public final class FileMetadata extends CalmLensObject {
  private String capturedAt;
  private String cameraMake;
  private String cameraModel;
  private String lensModel;
  private String software;
  private String creator;
  private String copyright;
  private String digitalSourceType;
  @Required private Boolean containsLocation;
  private FileMetadataLocation location;

  private FileMetadata() {}

  /** @return when the picture was taken, as the file records it: an ISO 8601 date and time, such as {@code 2026-05-01T12:30:00+01:00}. It includes the UTC offset only when the file records one; without it, the time is the camera's local time; empty when the API sends none */
  public Optional<String> getCapturedAt() { return Optional.ofNullable(capturedAt); }

  /** @return camera manufacturer, such as {@code Canon}; empty when the API sends none */
  public Optional<String> getCameraMake() { return Optional.ofNullable(cameraMake); }

  /** @return camera or phone model, such as {@code EOS R5}; empty when the API sends none */
  public Optional<String> getCameraModel() { return Optional.ofNullable(cameraModel); }

  /** @return lens model; empty when the API sends none */
  public Optional<String> getLensModel() { return Optional.ofNullable(lensModel); }

  /** @return software that created or last edited the file; empty when the API sends none */
  public Optional<String> getSoftware() { return Optional.ofNullable(software); }

  /** @return creator or artist the file names; sensitive, so recorded only when {@code storeSensitiveMetadata} is on; empty when the API sends none */
  public Optional<String> getCreator() { return Optional.ofNullable(creator); }

  /** @return copyright notice the file declares; empty when the API sends none */
  public Optional<String> getCopyright() { return Optional.ofNullable(copyright); }

  /** @return IPTC digital source type the file declares, such as {@code digitalCapture} for a camera photo or {@code trainedAlgorithmicMedia} for generated media. Files can declare any value, so treat it as a claim; empty when the API sends none */
  public Optional<String> getDigitalSourceType() { return Optional.ofNullable(digitalSourceType); }

  /** @return whether the uploaded file embedded GPS coordinates, whatever {@code storeSensitiveMetadata} is set to */
  public boolean getContainsLocation() { return required(containsLocation, "containsLocation"); }

  /** @return where the picture was taken, from its GPS coordinates; sensitive, so recorded only when {@code storeSensitiveMetadata} is on; empty when the API sends none */
  public Optional<FileMetadataLocation> getLocation() { return Optional.ofNullable(location); }
}
