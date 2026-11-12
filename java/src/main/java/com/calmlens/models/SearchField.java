package com.calmlens.models;

/**
 * An asset field a keyword search matched. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum SearchField implements ApiEnum {
  NAME("name"),
  ID("id"),
  EXTERNALID("externalId"),
  DESCRIPTION("description"),
  TAGS("tags"),
  TYPE("type"),
  CONTENT_FORMAT("content.format"),
  CONTENT_EXTENSION("content.extension"),
  CLASSIFICATION_MODERATION_DECISION("classification.moderation.decision"),
  VISUAL("visual"),
  TRANSCRIPT("transcript"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  SearchField(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "name"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static SearchField fromValue(String value) { return ApiEnum.fromValue(SearchField.class, value); }
}
