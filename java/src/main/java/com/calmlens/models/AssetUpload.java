package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * Receipt of source content and multipart progress.
 */
public final class AssetUpload extends CalmLensObject {
  @Required private UploadStatus status;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;
  private Integer partsReceived;

  private AssetUpload() {}

  /** @return status */
  public UploadStatus getStatus() { return required(status, "status"); }

  /** @return updatedAt; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }

  /** @return partsReceived; empty when the API sends none */
  public Optional<Integer> getPartsReceived() { return Optional.ofNullable(partsReceived); }
}
