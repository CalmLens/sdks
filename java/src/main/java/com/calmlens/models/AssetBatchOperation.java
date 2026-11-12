package com.calmlens.models;

/**
 * What {@code assets.batch} does to every asset: {@link #DELETE} deletes it with its child assets and stored content; {@link #REMOVE_CONTENT} removes its stored content and keeps the record. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetBatchOperation implements ApiEnum {
  DELETE("delete"),
  REMOVE_CONTENT("remove-content"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetBatchOperation(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "delete"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetBatchOperation fromValue(String value) { return ApiEnum.fromValue(AssetBatchOperation.class, value); }
}
