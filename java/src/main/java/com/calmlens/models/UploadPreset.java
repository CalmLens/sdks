package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * An upload preset: the rules for uploads from browsers and apps.
 */
public final class UploadPreset extends CalmLensObject {
  @Required private String id;
  @Required private String projectId;
  private String createdByUserId;
  @Required private String key;
  @Required private Integer revision;
  @Required private String name;
  @Required private UploadPresetAccess access;
  @Required private Boolean enabled;
  private List<String> allowedContentTypes;
  private Long maxSizeInBytes;
  private String folderId;
  private String policyId;
  @Required private Visibility visibility;
  private ProcessingOptions processingOptions;
  @Required private Boolean revealDecision;
  private Integer dailyUploadLimit;
  private List<String> allowedOrigins;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;

  private UploadPreset() {}

  /** @return upload preset ID */
  public String getId() { return required(id, "id"); }

  /** @return project it belongs to */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return who created it; empty when the API sends none */
  public Optional<String> getCreatedByUserId() { return Optional.ofNullable(createdByUserId); }

  /** @return stable identifier, unique in the project */
  public String getKey() { return required(key, "key"); }

  /** @return changes with every saved change; send it to {@code uploadPresets.ensure} to refuse a change made since */
  public int getRevision() { return required(revision, "revision"); }

  /** @return display name */
  public String getName() { return required(name, "name"); }

  /** @return {@code token} or {@code anyone} */
  public UploadPresetAccess getAccess() { return required(access, "access"); }

  /** @return whether it accepts uploads */
  public boolean getEnabled() { return required(enabled, "enabled"); }

  /** @return MIME types it accepts for any supported type; empty when the API sends none */
  public Optional<List<String>> getAllowedContentTypes() { return Optional.ofNullable(allowedContentTypes); }

  /** @return largest upload it accepts for the standard limits; empty when the API sends none */
  public Optional<Long> getMaxSizeInBytes() { return Optional.ofNullable(maxSizeInBytes); }

  /** @return folder uploads go into for the project's root; empty when the API sends none */
  public Optional<String> getFolderId() { return Optional.ofNullable(folderId); }

  /** @return moderation policy for its uploads for the project's policy; empty when the API sends none */
  public Optional<String> getPolicyId() { return Optional.ofNullable(policyId); }

  /** @return visibility of uploaded assets */
  public Visibility getVisibility() { return required(visibility, "visibility"); }

  /** @return processing options for every upload through it; empty when the API sends none */
  public Optional<ProcessingOptions> getProcessingOptions() { return Optional.ofNullable(processingOptions); }

  /** @return whether browser uploads see the moderation decision for their own upload */
  public boolean getRevealDecision() { return required(revealDecision, "revealDecision"); }

  /** @return most uploads it accepts from each client per UTC day; empty when the API sends none */
  public Optional<Integer> getDailyUploadLimit() { return Optional.ofNullable(dailyUploadLimit); }

  /** @return sites allowed to upload from the browser for any site; empty when the API sends none */
  public Optional<List<String>> getAllowedOrigins() { return Optional.ofNullable(allowedOrigins); }

  /** @return creation time */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }

  /** @return last change; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }
}
