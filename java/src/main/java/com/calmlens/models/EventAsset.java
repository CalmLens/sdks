package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * The asset's state when an event was created.
 */
public final class EventAsset extends CalmLensObject {
  @Required private String id;
  private String externalId;
  private String uploadPresetId;
  @Required private EventAssetUpload upload;
  @Required private EventAssetClassification classification;
  @Required private EventAssetContent content;

  private EventAsset() {}

  /** @return asset ID */
  public String getId() { return required(id, "id"); }

  /** @return the asset's external ID; empty when the API sends none */
  public Optional<String> getExternalId() { return Optional.ofNullable(externalId); }

  /** @return upload preset used to create the asset; empty when the API sends none */
  public Optional<String> getUploadPresetId() { return Optional.ofNullable(uploadPresetId); }

  /** @return upload status at the time */
  public EventAssetUpload getUpload() { return required(upload, "upload"); }

  /** @return classification status and moderation decision at the time */
  public EventAssetClassification getClassification() { return required(classification, "classification"); }

  /** @return content status at the time */
  public EventAssetContent getContent() { return required(content, "content"); }
}
