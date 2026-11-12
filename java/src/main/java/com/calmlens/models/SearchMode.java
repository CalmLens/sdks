package com.calmlens.models;

/**
 * How assets are searched. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum SearchMode implements ApiEnum {
  KEYWORD("keyword"),
  SEMANTIC("semantic"),
  HYBRID("hybrid"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  SearchMode(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "keyword"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static SearchMode fromValue(String value) { return ApiEnum.fromValue(SearchMode.class, value); }
}
