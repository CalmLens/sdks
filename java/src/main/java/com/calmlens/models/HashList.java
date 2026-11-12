package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * A list of PDQ perceptual hashes that image uploads are compared with.
 */
public final class HashList extends CalmLensObject {
  @Required private String id;
  @Required private String projectId;
  @Required private String name;
  private String description;
  @Required private HashListAction action;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;

  private HashList() {}

  /** @return hash list ID */
  public String getId() { return required(id, "id"); }

  /** @return owning project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return name */
  public String getName() { return required(name, "name"); }

  /** @return description; empty when the API sends none */
  public Optional<String> getDescription() { return Optional.ofNullable(description); }

  /** @return what matches do */
  public HashListAction getAction() { return required(action, "action"); }

  /** @return creation time */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }

  /** @return last update time; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }
}
