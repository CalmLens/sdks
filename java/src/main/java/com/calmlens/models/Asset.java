package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * An asset. {@code id}, {@code processing} and {@code moderation} are always set.
 */
public final class Asset extends CalmLensObject {
  @Required private String id;
  @Required private String name;
  @Required private String projectId;
  @Required private AssetType type;
  private String folderId;
  @Required private List<MetadataItem> metadata;
  private String parentId;
  @Required private List<Integer> parentPages;
  private String uploadPresetId;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;
  private String description;
  private String externalId;
  private String externalUrl;
  private String authorId;
  private ModerationContext context;
  @Required private List<String> tags;
  @Required private Visibility visibility;
  @Required private AssetUpload upload;
  @Required private AssetClassification classification;
  @Required private AssetContent content;

  private Asset() {}

  /** @return asset ID */
  public String getId() { return required(id, "id"); }

  /** @return asset name */
  public String getName() { return required(name, "name"); }

  /** @return owning project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return asset type, such as {@code image} or {@code plaintext-document} */
  public AssetType getType() { return required(type, "type"); }

  /** @return containing folder; empty when the API sends none */
  public Optional<String> getFolderId() { return Optional.ofNullable(folderId); }

  /** @return metadata entries */
  public List<MetadataItem> getMetadata() { return required(metadata, "metadata"); }

  /** @return parent asset for derived assets such as images extracted from documents; empty when the API sends none */
  public Optional<String> getParentId() { return Optional.ofNullable(parentId); }

  /** @return the pages of the parent document a child shows, numbered from 1; empty when its page isn't known or it has no parent document */
  public List<Integer> getParentPages() { return required(parentPages, "parentPages"); }

  /** @return upload preset the asset was uploaded through, if any; empty when the API sends none */
  public Optional<String> getUploadPresetId() { return Optional.ofNullable(uploadPresetId); }

  /** @return creation time */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }

  /** @return last update time; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }

  /** @return description; empty when the API sends none */
  public Optional<String> getDescription() { return Optional.ofNullable(description); }

  /** @return your identifier for the asset; empty when the API sends none */
  public Optional<String> getExternalId() { return Optional.ofNullable(externalId); }

  /** @return your URL for the asset; empty when the API sends none */
  public Optional<String> getExternalUrl() { return Optional.ofNullable(externalUrl); }

  /** @return your identifier for who wrote the content; empty when the API sends none */
  public Optional<String> getAuthorId() { return Optional.ofNullable(authorId); }

  /** @return the earlier posts CalmLens used, oldest first; null when none were sent or once the content is removed; empty when the API sends none */
  public Optional<ModerationContext> getContext() { return Optional.ofNullable(context); }

  /** @return tags */
  public List<String> getTags() { return required(tags, "tags"); }

  /** @return CDN visibility */
  public Visibility getVisibility() { return required(visibility, "visibility"); }

  /** @return receipt of source content */
  public AssetUpload getUpload() { return required(upload, "upload"); }

  /** @return progress and capability results */
  public AssetClassification getClassification() { return required(classification, "classification"); }

  /** @return whether CalmLens holds the content, and its details */
  public AssetContent getContent() { return required(content, "content"); }
}
