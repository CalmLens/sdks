package com.calmlens.models;

/**
 * What a hash list's matches do. Unknown values are kept like {@link Visibility}. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum HashListAction implements ApiEnum {
  /** Matches are reported in {@code classification.moderation.hashMatches}. */
  FLAG("flag"),
  /** Matches are reported, and close matches are blocked. */
  BLOCK("block"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  HashListAction(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "flag"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static HashListAction fromValue(String value) { return ApiEnum.fromValue(HashListAction.class, value); }
}
