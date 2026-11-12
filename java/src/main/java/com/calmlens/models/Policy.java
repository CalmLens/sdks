package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * A moderation policy. Policies belong to the organisation and its projects share them.
 */
public final class Policy extends CalmLensObject {
  @Required private String id;
  @Required private String name;
  @Required private String description;
  @Required private PolicySettings settings;
  @Required private Integer revision;
  private PolicyPreset preset;
  @Required private List<String> projectIds;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;

  private Policy() {}

  /** @return policy ID */
  public String getId() { return required(id, "id"); }

  /** @return display name */
  public String getName() { return required(name, "name"); }

  /** @return what the policy is for */
  public String getDescription() { return required(description, "description"); }

  /** @return what the policy does with each category */
  public PolicySettings getSettings() { return required(settings, "settings"); }

  /** @return changes with every saved change; send it with each change */
  public int getRevision() { return required(revision, "revision"); }

  /** @return the built-in preset it started from; empty when the API sends none */
  public Optional<PolicyPreset> getPreset() { return Optional.ofNullable(preset); }

  /** @return projects this policy moderates, as their policy or through an upload preset */
  public List<String> getProjectIds() { return required(projectIds, "projectIds"); }

  /** @return creation time */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }

  /** @return last change; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }
}
