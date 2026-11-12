package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * A lens: a named image transform the CDN applies at {@code /@<identifier>}. The CDN serves files
 * made with its current definition.
 */
public final class Lens extends CalmLensObject {
  @Required private String id;
  @Required private String identifier;
  @Required private String name;
  @Required private LensType type;
  @Required private Boolean active;
  private String projectId;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;
  private String description;
  private ImageTransformOptions transform;

  private Lens() {}

  /** @return lens ID */
  public String getId() { return required(id, "id"); }

  /** @return stable identifier used in CDN URLs */
  public String getIdentifier() { return required(identifier, "identifier"); }

  /** @return display name */
  public String getName() { return required(name, "name"); }

  /** @return lens type */
  public LensType getType() { return required(type, "type"); }

  /** @return whether the CDN serves the lens */
  public boolean getActive() { return required(active, "active"); }

  /** @return owning project; empty when the API sends none */
  public Optional<String> getProjectId() { return Optional.ofNullable(projectId); }

  /** @return creation time */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }

  /** @return last update time; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }

  /** @return description; empty when the API sends none */
  public Optional<String> getDescription() { return Optional.ofNullable(description); }

  /** @return image transform options; empty when the API sends none */
  public Optional<ImageTransformOptions> getTransform() { return Optional.ofNullable(transform); }
}
