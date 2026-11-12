package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * A GPS position in decimal degrees.
 */
public final class FileMetadataLocation extends CalmLensObject {
  @Required private Double latitude;
  @Required private Double longitude;

  private FileMetadataLocation() {}

  /** @return latitude, from -90 to 90 */
  public double getLatitude() { return required(latitude, "latitude"); }

  /** @return longitude, from -180 to 180 */
  public double getLongitude() { return required(longitude, "longitude"); }
}
