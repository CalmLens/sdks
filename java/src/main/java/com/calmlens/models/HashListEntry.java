package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * One hash in a hash list.
 */
public final class HashListEntry extends CalmLensObject {
  @Required private String id;
  @Required private String projectId;
  @Required private String hashListId;
  @Required private String hash;
  private Integer quality;
  private String label;
  private String assetId;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;

  private HashListEntry() {}

  /** @return entry ID */
  public String getId() { return required(id, "id"); }

  /** @return owning project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return the hash list */
  public String getHashListId() { return required(hashListId, "hashListId"); }

  /** @return PDQ hash, 64 lowercase hexadecimal characters */
  public String getHash() { return required(hash, "hash"); }

  /** @return the hash's quality from 0 to 100; empty when the API sends none */
  public Optional<Integer> getQuality() { return Optional.ofNullable(quality); }

  /** @return label; empty when the API sends none */
  public Optional<String> getLabel() { return Optional.ofNullable(label); }

  /** @return the asset the hash was taken from; empty when the API sends none */
  public Optional<String> getAssetId() { return Optional.ofNullable(assetId); }

  /** @return when it was added */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }
}
