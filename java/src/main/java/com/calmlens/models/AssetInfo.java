package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * An asset's display info, the CDN's {@code info} resource: the public asset fields a viewer needs,
 * with the same names as on {@link Asset}, and whether this viewer can see it now. It never holds
 * moderation results, metadata, names, tags or extracted text.
 */
public final class AssetInfo extends CalmLensObject {
  @Required private String id;
  @Required private String projectId;
  @Required private AssetType type;
  private String externalUrl;
  @Required private AssetInfoContent content;
  @Required private AssetAvailability availability;

  private AssetInfo() {}

  /** @return the asset's ID */
  public String getId() { return required(id, "id"); }

  /** @return the asset's project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return the asset's type, such as {@code image} or {@code video} */
  public AssetType getType() { return required(type, "type"); }

  /** @return a website's page, which a viewer links to; null for other assets; empty when the API sends none */
  public Optional<String> getExternalUrl() { return Optional.ofNullable(externalUrl); }

  /** @return the displayable content */
  public AssetInfoContent getContent() { return required(content, "content"); }

  /** @return whether the viewer the request's claims describe can see it; the CDN's resources refuse exactly what it refuses */
  public AssetAvailability getAvailability() { return required(availability, "availability"); }
}
