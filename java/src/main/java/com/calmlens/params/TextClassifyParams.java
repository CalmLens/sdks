package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.Visibility;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Options for {@code text().classify}. */
public final class TextClassifyParams extends ApiParams {
  @Required private final @Nullable String text;
  private final @Nullable String name;
  private final @Nullable String description;
  private final @Nullable Visibility visibility;
  private final @Nullable ProcessingOptionsParams processingOptions;
  private final @Nullable List<MetadataItemParams> metadata;
  private final @Nullable List<String> tags;
  private final @Nullable String authorId;
  private final @Nullable ModerationContextParams context;
  private final @Nullable String externalId;
  private final @Nullable String externalUrl;
  private final @Nullable Patch<String> folderId;
  private final @Nullable String uploadPresetId;

  private TextClassifyParams(Builder builder) {
    super(builder);
    this.text = builder.text;
    this.name = builder.name;
    this.description = builder.description;
    this.visibility = builder.visibility;
    this.processingOptions = builder.processingOptions;
    this.metadata = builder.metadata;
    this.tags = builder.tags;
    this.authorId = builder.authorId;
    this.context = builder.context;
    this.externalId = builder.externalId;
    this.externalUrl = builder.externalUrl;
    this.folderId = builder.folderId;
    this.uploadPresetId = builder.uploadPresetId;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the text to classify; empty when unset */
  public java.util.Optional<String> getText() { return java.util.Optional.ofNullable(text); }

  /** @return the asset name; {@code text} when unset; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return a description; empty when unset */
  public java.util.Optional<String> getDescription() { return java.util.Optional.ofNullable(description); }

  /** @return the CDN visibility; the preset's or the project's default when unset; empty when unset */
  public java.util.Optional<Visibility> getVisibility() { return java.util.Optional.ofNullable(visibility); }

  /** @return processing options; they replace the upload preset's; empty when unset */
  public java.util.Optional<ProcessingOptionsParams> getProcessingOptions() { return java.util.Optional.ofNullable(processingOptions); }

  /** @return metadata entries; empty when unset */
  public java.util.Optional<List<MetadataItemParams>> getMetadata() { return java.util.Optional.ofNullable(metadata); }

  /** @return tags for the asset, such as {@code List.of("catalogue", "backpacks")}; empty when unset */
  public java.util.Optional<List<String>> getTags() { return java.util.Optional.ofNullable(tags); }

  /** @return your identifier for who wrote the content; CalmLens only compares it with the author IDs in the context, to tell which posts share a speaker; empty when unset */
  public java.util.Optional<String> getAuthorId() { return java.util.Optional.ofNullable(authorId); }

  /** @return earlier posts in the conversation, oldest first; the SDK sends only the posts CalmLens uses (see {@link ModerationContextParams#selectItems(List)}); empty when unset */
  public java.util.Optional<ModerationContextParams> getContext() { return java.util.Optional.ofNullable(context); }

  /** @return your identifier for the asset; empty when unset */
  public java.util.Optional<String> getExternalId() { return java.util.Optional.ofNullable(externalId); }

  /** @return your URL for the asset; empty when unset */
  public java.util.Optional<String> getExternalUrl() { return java.util.Optional.ofNullable(externalUrl); }

  /** @return the folder; the preset's folder when unset, and the project root when cleared: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getFolderId() { return java.util.Optional.ofNullable(folderId == null ? null : folderId.get()); }

  /** @return the upload preset to apply: its folder, visibility, file types, size limit, moderation policy and processing options; empty when unset */
  public java.util.Optional<String> getUploadPresetId() { return java.util.Optional.ofNullable(uploadPresetId); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("folderId") && folderId != null && folderId.isClear()); }

  /** Builds {@link TextClassifyParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String text;
    private @Nullable String name;
    private @Nullable String description;
    private @Nullable Visibility visibility;
    private @Nullable ProcessingOptionsParams processingOptions;
    private @Nullable List<MetadataItemParams> metadata;
    private @Nullable List<String> tags;
    private @Nullable String authorId;
    private @Nullable ModerationContextParams context;
    private @Nullable String externalId;
    private @Nullable String externalUrl;
    private @Nullable Patch<String> folderId;
    private @Nullable String uploadPresetId;

    private Builder() {}

    /**
     * @param value the text to classify
     * @return this builder
     */
    public Builder setText(@Nullable String value) { this.text = value; return this; }

    /**
     * @param value the asset name; {@code text} when unset; null unsets it
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @param value a description; null unsets it
     * @return this builder
     */
    public Builder setDescription(@Nullable String value) { this.description = value; return this; }

    /**
     * @param value the CDN visibility; the preset's or the project's default when unset; null unsets it
     * @return this builder
     */
    public Builder setVisibility(@Nullable Visibility value) { this.visibility = value; return this; }

    /**
     * @param value processing options; they replace the upload preset's; null unsets it
     * @return this builder
     */
    public Builder setProcessingOptions(@Nullable ProcessingOptionsParams value) { this.processingOptions = value; return this; }

    /**
     * @param value metadata entries; null unsets it
     * @return this builder
     */
    public Builder setMetadata(@Nullable List<MetadataItemParams> value) { this.metadata = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value tags for the asset, such as {@code List.of("catalogue", "backpacks")}; null unsets it
     * @return this builder
     */
    public Builder setTags(@Nullable List<String> value) { this.tags = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value your identifier for who wrote the content; CalmLens only compares it with the author IDs in the context, to tell which posts share a speaker; null unsets it
     * @return this builder
     */
    public Builder setAuthorId(@Nullable String value) { this.authorId = value; return this; }

    /**
     * @param value earlier posts in the conversation, oldest first; the SDK sends only the posts CalmLens uses (see {@link ModerationContextParams#selectItems(List)}); null unsets it
     * @return this builder
     */
    public Builder setContext(@Nullable ModerationContextParams value) { this.context = value; return this; }

    /**
     * @param value your identifier for the asset; null unsets it
     * @return this builder
     */
    public Builder setExternalId(@Nullable String value) { this.externalId = value; return this; }

    /**
     * @param value your URL for the asset; null unsets it
     * @return this builder
     */
    public Builder setExternalUrl(@Nullable String value) { this.externalUrl = value; return this; }

    /**
     * @param value the folder; the preset's folder when unset, and the project root when cleared; null unsets it
     * @return this builder
     */
    public Builder setFolderId(@Nullable String value) { this.folderId = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for folderId, clearing it.
     *
     * @return this builder
     */
    public Builder clearFolderId() { this.folderId = Patch.clear(); return this; }

    /**
     * @param value the upload preset to apply: its folder, visibility, file types, size limit, moderation policy and processing options; null unsets it
     * @return this builder
     */
    public Builder setUploadPresetId(@Nullable String value) { this.uploadPresetId = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public TextClassifyParams build() { return checkRequired(new TextClassifyParams(this)); }
  }
}
