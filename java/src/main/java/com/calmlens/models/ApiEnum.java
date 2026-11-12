package com.calmlens.models;

import org.jspecify.annotations.Nullable;

/**
 * A closed set of API values. Every enum that implements it has an {@code UNKNOWN} constant: a value
 * this SDK version doesn't know decodes as {@code UNKNOWN}, so a {@code switch} can handle it, and the
 * model's {@link CalmLensObject#getRawJsonObject()} keeps the value itself. {@code UNKNOWN} can't be
 * sent.
 */
public interface ApiEnum {
  /** @return the API value, or null for {@code UNKNOWN} */
  @Nullable String getValue();

  /**
   * Finds a constant by its API value.
   *
   * @param <E> the enum
   * @param type the enum class
   * @param value an API value
   * @return the matching constant, or the enum's {@code UNKNOWN}
   */
  static <E extends Enum<E> & ApiEnum> E fromValue(Class<E> type, @Nullable String value) {
    for (E constant : type.getEnumConstants()) if (value != null && value.equals(constant.getValue())) return constant;
    return Enum.valueOf(type, "UNKNOWN");
  }
}
