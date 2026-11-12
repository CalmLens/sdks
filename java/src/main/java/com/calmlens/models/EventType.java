package com.calmlens.models;

/**
 * An event type. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum EventType implements ApiEnum {
  ASSET_UPLOADED("asset.uploaded"),
  ASSET_CLASSIFIED("asset.classified"),
  ASSET_REGION_RESTRICTED("asset.region-restricted"),
  ASSET_ALLOWED("asset.allowed"),
  ASSET_LIMITED("asset.limited"),
  ASSET_AGE_RESTRICTED("asset.age-restricted"),
  ASSET_BLOCKED("asset.blocked"),
  ASSET_PURGED("asset.purged"),
  ASSET_FAILED("asset.failed"),
  ASSET_PROGRESS_UPDATED("asset.progress-updated"),
  ASSET_DELETED("asset.deleted"),
  ASSET_CONTENT_REMOVED("asset.content-removed"),
  ASSET_RETRIED("asset.retried"),
  ASSET_RERUN_REQUESTED("asset.rerun-requested"),
  ASSET_REVIEW_REQUESTED("asset.review-requested"),
  ASSET_REVIEW_COMPLETED("asset.review-completed"),
  ASSET_HASH_MATCHED("asset.hash-matched"),
  USAGE_FREE_UPLOADS_EXHAUSTED("usage.free-uploads-exhausted"),
  USAGE_UPLOADS_PAUSED("usage.uploads-paused"),
  UPLOAD_PRESET_DAILY_LIMIT_REACHED("upload-preset.daily-limit-reached"),
  API_KEY_CREATED("api-key.created"),
  API_KEY_DELETED("api-key.deleted"),
  API_KEY_REVOKED("api-key.revoked"),
  PROJECT_INVITATION_SENT("project.invitation-sent"),
  PROJECT_MEMBER_JOINED("project.member-joined"),
  PROJECT_MEMBER_LEFT("project.member-left"),
  PROJECT_MEMBER_REMOVED("project.member-removed"),
  PROJECT_MEMBER_ROLE_CHANGED("project.member-role-changed"),
  PROJECT_TRANSFERRED("project.transferred"),
  CONNECTOR_DISABLED("connector.disabled"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  EventType(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "asset.uploaded"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static EventType fromValue(String value) { return ApiEnum.fromValue(EventType.class, value); }
}
