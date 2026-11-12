package com.calmlens.models;

/**
 * Whether CalmLens holds an asset's content ({@code content.status}): its source, preview and extracted text. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetContentStatus implements ApiEnum {
  /** Held only until processing finishes. */
  TEMPORARY("temporary"),
  /** Retained after processing. */
  STORED("stored"),
  /** Deleted; {@code content.removalReason} says why. */
  REMOVED("removed"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetContentStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "temporary"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetContentStatus fromValue(String value) { return ApiEnum.fromValue(AssetContentStatus.class, value); }
}
