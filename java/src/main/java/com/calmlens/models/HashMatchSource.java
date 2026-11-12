package com.calmlens.models;

/**
 * Where a hash match came from. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum HashMatchSource implements ApiEnum {
  HASH_LIST("hash-list"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  HashMatchSource(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "hash-list"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static HashMatchSource fromValue(String value) { return ApiEnum.fromValue(HashMatchSource.class, value); }
}
