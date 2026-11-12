package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * A project's settings, with defaults filled in.
 */
public final class ProjectSettings extends CalmLensObject {
  @Required private Boolean retainContent;
  @Required private List<Jurisdiction> optOutJurisdictions;
  @Required private Boolean blockUnmoderatedAssets;
  @Required private Boolean storeSensitiveMetadata;
  @Required private Boolean streamingEnabled;
  @Required private Boolean aiMediaSearchEnabled;
  @Required private Boolean linkCheckingEnabled;
  private RemoteUrlRule remoteUrlRule;
  private Integer websiteSubmissionsPerMinute;
  @Required private HumanReviewSettings humanReview;

  private ProjectSettings() {}

  /** @return whether new uploads keep their content after processing */
  public boolean getRetainContent() { return required(retainContent, "retainContent"); }

  /** @return optional standards the project doesn't serve, such as {@code EU} */
  public List<Jurisdiction> getOptOutJurisdictions() { return required(optOutJurisdictions, "optOutJurisdictions"); }

  /** @return whether the CDN refuses to serve assets whose moderation is pending */
  public boolean getBlockUnmoderatedAssets() { return required(blockUnmoderatedAssets, "blockUnmoderatedAssets"); }

  /** @return whether uploaded images keep their embedded metadata */
  public boolean getStoreSensitiveMetadata() { return required(storeSensitiveMetadata, "storeSensitiveMetadata"); }

  /** @return whether audio and video uploads that keep their content get an adaptive stream */
  public boolean getStreamingEnabled() { return required(streamingEnabled, "streamingEnabled"); }

  /** @return whether audio and video are indexed for AI search */
  public boolean getAiMediaSearchEnabled() { return required(aiMediaSearchEnabled, "aiMediaSearchEnabled"); }

  /** @return whether paid link checks are enabled */
  public boolean getLinkCheckingEnabled() { return required(linkCheckingEnabled, "linkCheckingEnabled"); }

  /** @return the domains accepted when content is submitted by URL for every public domain; empty when the API sends none */
  public Optional<RemoteUrlRule> getRemoteUrlRule() { return Optional.ofNullable(remoteUrlRule); }

  /** @return how many websites the project can submit per minute for the platform limit; empty when the API sends none */
  public Optional<Integer> getWebsiteSubmissionsPerMinute() { return Optional.ofNullable(websiteSubmissionsPerMinute); }

  /** @return which automated decisions are sampled into the human review queue */
  public HumanReviewSettings getHumanReview() { return required(humanReview, "humanReview"); }
}
