package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.UploadPresetAccess;
import com.calmlens.models.Visibility;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** An upload preset for {@code uploadPresets().ensure}. */
public final class UploadPresetParams extends ApiParams {
  @Required private final @Nullable String key;
  private final @Nullable Integer revision;
  @Required private final @Nullable String name;
  private final @Nullable UploadPresetAccess access;
  private final @Nullable Boolean enabled;
  private final @Nullable Patch<List<String>> allowedContentTypes;
  private final @Nullable Patch<Long> maxSizeInBytes;
  private final @Nullable Patch<String> folderId;
  private final @Nullable Patch<String> policyId;
  private final @Nullable Visibility visibility;
  private final @Nullable Patch<ProcessingOptionsParams> processingOptions;
  private final @Nullable Boolean revealDecision;
  private final @Nullable Patch<Integer> dailyUploadLimit;
  private final @Nullable Patch<List<String>> allowedOrigins;

  private UploadPresetParams(Builder builder) {
    super(builder);
    this.key = builder.key;
    this.revision = builder.revision;
    this.name = builder.name;
    this.access = builder.access;
    this.enabled = builder.enabled;
    this.allowedContentTypes = builder.allowedContentTypes;
    this.maxSizeInBytes = builder.maxSizeInBytes;
    this.folderId = builder.folderId;
    this.policyId = builder.policyId;
    this.visibility = builder.visibility;
    this.processingOptions = builder.processingOptions;
    this.revealDecision = builder.revealDecision;
    this.dailyUploadLimit = builder.dailyUploadLimit;
    this.allowedOrigins = builder.allowedOrigins;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return your stable key for the preset; empty when unset */
  public java.util.Optional<String> getKey() { return java.util.Optional.ofNullable(key); }

  /** @return the revision you read, so a concurrent edit is refused; empty when unset */
  public java.util.Optional<Integer> getRevision() { return java.util.Optional.ofNullable(revision); }

  /** @return the display name; empty when unset */
  public java.util.Optional<String> getName() { return java.util.Optional.ofNullable(name); }

  /** @return who can upload through it; empty when unset */
  public java.util.Optional<UploadPresetAccess> getAccess() { return java.util.Optional.ofNullable(access); }

  /** @return whether it accepts uploads; empty when unset */
  public java.util.Optional<Boolean> getEnabled() { return java.util.Optional.ofNullable(enabled); }

  /** @return the MIME types it accepts: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<List<String>> getAllowedContentTypes() { return java.util.Optional.ofNullable(allowedContentTypes == null ? null : allowedContentTypes.get()); }

  /** @return the largest upload it accepts: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<Long> getMaxSizeInBytes() { return java.util.Optional.ofNullable(maxSizeInBytes == null ? null : maxSizeInBytes.get()); }

  /** @return the folder uploads go to: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getFolderId() { return java.util.Optional.ofNullable(folderId == null ? null : folderId.get()); }

  /** @return the moderation policy for its uploads: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<String> getPolicyId() { return java.util.Optional.ofNullable(policyId == null ? null : policyId.get()); }

  /** @return the CDN visibility of its uploads; empty when unset */
  public java.util.Optional<Visibility> getVisibility() { return java.util.Optional.ofNullable(visibility); }

  /** @return processing options for its uploads: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<ProcessingOptionsParams> getProcessingOptions() { return java.util.Optional.ofNullable(processingOptions == null ? null : processingOptions.get()); }

  /** @return whether uploaders see the moderation decision; empty when unset */
  public java.util.Optional<Boolean> getRevealDecision() { return java.util.Optional.ofNullable(revealDecision); }

  /** @return the most uploads it takes per day: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<Integer> getDailyUploadLimit() { return java.util.Optional.ofNullable(dailyUploadLimit == null ? null : dailyUploadLimit.get()); }

  /** @return the browser origins it accepts uploads from: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<List<String>> getAllowedOrigins() { return java.util.Optional.ofNullable(allowedOrigins == null ? null : allowedOrigins.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("allowedContentTypes") && allowedContentTypes != null && allowedContentTypes.isClear()) || (name.equals("maxSizeInBytes") && maxSizeInBytes != null && maxSizeInBytes.isClear()) || (name.equals("folderId") && folderId != null && folderId.isClear()) || (name.equals("policyId") && policyId != null && policyId.isClear()) || (name.equals("processingOptions") && processingOptions != null && processingOptions.isClear()) || (name.equals("dailyUploadLimit") && dailyUploadLimit != null && dailyUploadLimit.isClear()) || (name.equals("allowedOrigins") && allowedOrigins != null && allowedOrigins.isClear()); }

  /** Builds {@link UploadPresetParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String key;
    private @Nullable Integer revision;
    private @Nullable String name;
    private @Nullable UploadPresetAccess access;
    private @Nullable Boolean enabled;
    private @Nullable Patch<List<String>> allowedContentTypes;
    private @Nullable Patch<Long> maxSizeInBytes;
    private @Nullable Patch<String> folderId;
    private @Nullable Patch<String> policyId;
    private @Nullable Visibility visibility;
    private @Nullable Patch<ProcessingOptionsParams> processingOptions;
    private @Nullable Boolean revealDecision;
    private @Nullable Patch<Integer> dailyUploadLimit;
    private @Nullable Patch<List<String>> allowedOrigins;

    private Builder() {}

    /**
     * @param value your stable key for the preset
     * @return this builder
     */
    public Builder setKey(@Nullable String value) { this.key = value; return this; }

    /**
     * @param value the revision you read, so a concurrent edit is refused; null unsets it
     * @return this builder
     */
    public Builder setRevision(@Nullable Integer value) { this.revision = value; return this; }

    /**
     * @param value the display name
     * @return this builder
     */
    public Builder setName(@Nullable String value) { this.name = value; return this; }

    /**
     * @param value who can upload through it; null unsets it
     * @return this builder
     */
    public Builder setAccess(@Nullable UploadPresetAccess value) { this.access = value; return this; }

    /**
     * @param value whether it accepts uploads; null unsets it
     * @return this builder
     */
    public Builder setEnabled(@Nullable Boolean value) { this.enabled = value; return this; }

    /**
     * @param value the MIME types it accepts; null unsets it
     * @return this builder
     */
    public Builder setAllowedContentTypes(@Nullable List<String> value) { this.allowedContentTypes = value == null ? null : Patch.value(java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value))); return this; }

    /**
     * Sends null for allowedContentTypes, clearing it.
     *
     * @return this builder
     */
    public Builder clearAllowedContentTypes() { this.allowedContentTypes = Patch.clear(); return this; }

    /**
     * @param value the largest upload it accepts; null unsets it
     * @return this builder
     */
    public Builder setMaxSizeInBytes(@Nullable Long value) { this.maxSizeInBytes = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for maxSizeInBytes, clearing it.
     *
     * @return this builder
     */
    public Builder clearMaxSizeInBytes() { this.maxSizeInBytes = Patch.clear(); return this; }

    /**
     * @param value the folder uploads go to; null unsets it
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
     * @param value the moderation policy for its uploads; null unsets it
     * @return this builder
     */
    public Builder setPolicyId(@Nullable String value) { this.policyId = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for policyId, clearing it.
     *
     * @return this builder
     */
    public Builder clearPolicyId() { this.policyId = Patch.clear(); return this; }

    /**
     * @param value the CDN visibility of its uploads; null unsets it
     * @return this builder
     */
    public Builder setVisibility(@Nullable Visibility value) { this.visibility = value; return this; }

    /**
     * @param value processing options for its uploads; null unsets it
     * @return this builder
     */
    public Builder setProcessingOptions(@Nullable ProcessingOptionsParams value) { this.processingOptions = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for processingOptions, clearing it.
     *
     * @return this builder
     */
    public Builder clearProcessingOptions() { this.processingOptions = Patch.clear(); return this; }

    /**
     * @param value whether uploaders see the moderation decision; null unsets it
     * @return this builder
     */
    public Builder setRevealDecision(@Nullable Boolean value) { this.revealDecision = value; return this; }

    /**
     * @param value the most uploads it takes per day; null unsets it
     * @return this builder
     */
    public Builder setDailyUploadLimit(@Nullable Integer value) { this.dailyUploadLimit = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for dailyUploadLimit, clearing it.
     *
     * @return this builder
     */
    public Builder clearDailyUploadLimit() { this.dailyUploadLimit = Patch.clear(); return this; }

    /**
     * @param value the browser origins it accepts uploads from; null unsets it
     * @return this builder
     */
    public Builder setAllowedOrigins(@Nullable List<String> value) { this.allowedOrigins = value == null ? null : Patch.value(java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value))); return this; }

    /**
     * Sends null for allowedOrigins, clearing it.
     *
     * @return this builder
     */
    public Builder clearAllowedOrigins() { this.allowedOrigins = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public UploadPresetParams build() { return checkRequired(new UploadPresetParams(this)); }
  }
}
