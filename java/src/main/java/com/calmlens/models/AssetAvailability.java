package com.calmlens.models;

/**
 * Whether the viewer an {@link AssetInfo} was read for can see the asset now. A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetAvailability implements ApiEnum {
  /** The viewer can see the content now. */
  AVAILABLE("available"),
  /** The content needs the viewer's age confirmed ({@code ageConfirmed}). */
  AGE_RESTRICTED("age-restricted"),
  /** The viewer can't see the content: it is held, blocked, not yet moderated or removed. */
  UNAVAILABLE("unavailable"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetAvailability(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "available"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetAvailability fromValue(String value) { return ApiEnum.fromValue(AssetAvailability.class, value); }
}
