package com.calmlens.models;

/**
 * What decided an asset's automated moderation ({@code moderation.source}). A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum ModerationSource implements ApiEnum {
  POLICY("policy"),
  HASH_LIST("hash-list"),
  MANDATORY_RULE("mandatory-rule"),
  CHILDREN("children"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  ModerationSource(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "policy"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static ModerationSource fromValue(String value) { return ApiEnum.fromValue(ModerationSource.class, value); }
}
