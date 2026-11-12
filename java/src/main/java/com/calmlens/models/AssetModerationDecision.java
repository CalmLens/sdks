package com.calmlens.models;

/**
 * A reviewer's decision in an asset's review history ({@code classification.moderation.manualReviews[].decision}). A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetModerationDecision implements ApiEnum {
  /** Deliver to anyone with access. */
  ALLOWED("allowed"),
  /** Deliver to anyone with access, but mark it so your app reduces its reach. */
  LIMITED("limited"),
  /** Deliver only through signed URLs or API keys. */
  AGE_RESTRICTED("age-restricted"),
  /** Don't deliver; keep the content. */
  BLOCKED("blocked"),
  /** Don't deliver, and delete the stored content. */
  PURGED("purged"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetModerationDecision(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "allowed"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetModerationDecision fromValue(String value) { return ApiEnum.fromValue(AssetModerationDecision.class, value); }
}
