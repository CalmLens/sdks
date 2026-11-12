package com.calmlens.models;

/**
 * Why CalmLens no longer holds an asset's content ({@code content.removalReason}). A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum ContentRemovalReason implements ApiEnum {
  POLICY("policy"),
  RETENTION("retention"),
  REQUESTED("requested"),
  PARENT_REMOVED("parent-removed"),
  DISPOSED("disposed"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  ContentRemovalReason(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "policy"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static ContentRemovalReason fromValue(String value) { return ApiEnum.fromValue(ContentRemovalReason.class, value); }
}
