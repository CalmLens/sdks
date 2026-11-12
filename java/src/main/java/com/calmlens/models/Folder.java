package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * A folder.
 */
public final class Folder extends CalmLensObject {
  @Required private String id;
  @Required private String name;
  private String parentId;
  @Required private String projectId;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;

  private Folder() {}

  /** @return folder ID */
  public String getId() { return required(id, "id"); }

  /** @return name */
  public String getName() { return required(name, "name"); }

  /** @return parent folder; empty when the API sends none */
  public Optional<String> getParentId() { return Optional.ofNullable(parentId); }

  /** @return owning project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return creation time */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }

  /** @return last update time; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }
}
