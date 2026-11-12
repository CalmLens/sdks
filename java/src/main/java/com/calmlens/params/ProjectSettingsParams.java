package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.Jurisdiction;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** A project's settings. */
public final class ProjectSettingsParams extends ApiParams {
  private final @Nullable Boolean retainContent;
  private final @Nullable List<Jurisdiction> optOutJurisdictions;
  private final @Nullable Boolean blockUnmoderatedAssets;
  private final @Nullable Boolean storeSensitiveMetadata;
  private final @Nullable Boolean linkCheckingEnabled;
  private final @Nullable Boolean streamingEnabled;
  private final @Nullable Boolean aiMediaSearchEnabled;
  private final @Nullable Patch<RemoteUrlRuleParams> remoteUrlRule;
  private final @Nullable Patch<Integer> websiteSubmissionsPerMinute;
  private final @Nullable HumanReviewSettingsParams humanReview;

  private ProjectSettingsParams(Builder builder) {
    super(builder);
    this.retainContent = builder.retainContent;
    this.optOutJurisdictions = builder.optOutJurisdictions;
    this.blockUnmoderatedAssets = builder.blockUnmoderatedAssets;
    this.storeSensitiveMetadata = builder.storeSensitiveMetadata;
    this.linkCheckingEnabled = builder.linkCheckingEnabled;
    this.streamingEnabled = builder.streamingEnabled;
    this.aiMediaSearchEnabled = builder.aiMediaSearchEnabled;
    this.remoteUrlRule = builder.remoteUrlRule;
    this.websiteSubmissionsPerMinute = builder.websiteSubmissionsPerMinute;
    this.humanReview = builder.humanReview;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return whether CalmLens keeps content; empty when unset */
  public java.util.Optional<Boolean> getRetainContent() { return java.util.Optional.ofNullable(retainContent); }

  /** @return jurisdictions the project opts out of; empty when unset */
  public java.util.Optional<List<Jurisdiction>> getOptOutJurisdictions() { return java.util.Optional.ofNullable(optOutJurisdictions); }

  /** @return whether unmoderated assets are withheld; empty when unset */
  public java.util.Optional<Boolean> getBlockUnmoderatedAssets() { return java.util.Optional.ofNullable(blockUnmoderatedAssets); }

  /** @return whether to keep sensitive file metadata; empty when unset */
  public java.util.Optional<Boolean> getStoreSensitiveMetadata() { return java.util.Optional.ofNullable(storeSensitiveMetadata); }

  /** @return whether links are checked; empty when unset */
  public java.util.Optional<Boolean> getLinkCheckingEnabled() { return java.util.Optional.ofNullable(linkCheckingEnabled); }

  /** @return whether adaptive streams are made; empty when unset */
  public java.util.Optional<Boolean> getStreamingEnabled() { return java.util.Optional.ofNullable(streamingEnabled); }

  /** @return whether media are indexed for semantic search; empty when unset */
  public java.util.Optional<Boolean> getAiMediaSearchEnabled() { return java.util.Optional.ofNullable(aiMediaSearchEnabled); }

  /** @return which remote URLs may be uploaded: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<RemoteUrlRuleParams> getRemoteUrlRule() { return java.util.Optional.ofNullable(remoteUrlRule == null ? null : remoteUrlRule.get()); }

  /** @return the most websites submitted per minute: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<Integer> getWebsiteSubmissionsPerMinute() { return java.util.Optional.ofNullable(websiteSubmissionsPerMinute == null ? null : websiteSubmissionsPerMinute.get()); }

  /** @return human review settings; empty when unset */
  public java.util.Optional<HumanReviewSettingsParams> getHumanReview() { return java.util.Optional.ofNullable(humanReview); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("remoteUrlRule") && remoteUrlRule != null && remoteUrlRule.isClear()) || (name.equals("websiteSubmissionsPerMinute") && websiteSubmissionsPerMinute != null && websiteSubmissionsPerMinute.isClear()); }

  /** Builds {@link ProjectSettingsParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Boolean retainContent;
    private @Nullable List<Jurisdiction> optOutJurisdictions;
    private @Nullable Boolean blockUnmoderatedAssets;
    private @Nullable Boolean storeSensitiveMetadata;
    private @Nullable Boolean linkCheckingEnabled;
    private @Nullable Boolean streamingEnabled;
    private @Nullable Boolean aiMediaSearchEnabled;
    private @Nullable Patch<RemoteUrlRuleParams> remoteUrlRule;
    private @Nullable Patch<Integer> websiteSubmissionsPerMinute;
    private @Nullable HumanReviewSettingsParams humanReview;

    private Builder() {}

    /**
     * @param value whether CalmLens keeps content; null unsets it
     * @return this builder
     */
    public Builder setRetainContent(@Nullable Boolean value) { this.retainContent = value; return this; }

    /**
     * @param value jurisdictions the project opts out of; null unsets it
     * @return this builder
     */
    public Builder setOptOutJurisdictions(@Nullable List<Jurisdiction> value) { this.optOutJurisdictions = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value whether unmoderated assets are withheld; null unsets it
     * @return this builder
     */
    public Builder setBlockUnmoderatedAssets(@Nullable Boolean value) { this.blockUnmoderatedAssets = value; return this; }

    /**
     * @param value whether to keep sensitive file metadata; null unsets it
     * @return this builder
     */
    public Builder setStoreSensitiveMetadata(@Nullable Boolean value) { this.storeSensitiveMetadata = value; return this; }

    /**
     * @param value whether links are checked; null unsets it
     * @return this builder
     */
    public Builder setLinkCheckingEnabled(@Nullable Boolean value) { this.linkCheckingEnabled = value; return this; }

    /**
     * @param value whether adaptive streams are made; null unsets it
     * @return this builder
     */
    public Builder setStreamingEnabled(@Nullable Boolean value) { this.streamingEnabled = value; return this; }

    /**
     * @param value whether media are indexed for semantic search; null unsets it
     * @return this builder
     */
    public Builder setAiMediaSearchEnabled(@Nullable Boolean value) { this.aiMediaSearchEnabled = value; return this; }

    /**
     * @param value which remote URLs may be uploaded; null unsets it
     * @return this builder
     */
    public Builder setRemoteUrlRule(@Nullable RemoteUrlRuleParams value) { this.remoteUrlRule = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for remoteUrlRule, clearing it.
     *
     * @return this builder
     */
    public Builder clearRemoteUrlRule() { this.remoteUrlRule = Patch.clear(); return this; }

    /**
     * @param value the most websites submitted per minute; null unsets it
     * @return this builder
     */
    public Builder setWebsiteSubmissionsPerMinute(@Nullable Integer value) { this.websiteSubmissionsPerMinute = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for websiteSubmissionsPerMinute, clearing it.
     *
     * @return this builder
     */
    public Builder clearWebsiteSubmissionsPerMinute() { this.websiteSubmissionsPerMinute = Patch.clear(); return this; }

    /**
     * @param value human review settings; null unsets it
     * @return this builder
     */
    public Builder setHumanReview(@Nullable HumanReviewSettingsParams value) { this.humanReview = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public ProjectSettingsParams build() { return checkRequired(new ProjectSettingsParams(this)); }
  }
}
