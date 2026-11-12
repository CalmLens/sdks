package com.calmlens.models;

/**
 * Whether semantic search could take part in a search. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum SemanticSearchStatus implements ApiEnum {
  READY("ready"),
  INDEXING("indexing"),
  DISABLED("disabled"),
  UNAVAILABLE("unavailable"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  SemanticSearchStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "ready"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static SemanticSearchStatus fromValue(String value) { return ApiEnum.fromValue(SemanticSearchStatus.class, value); }
}
