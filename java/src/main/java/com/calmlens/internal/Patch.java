package com.calmlens.internal;

import java.util.Objects;

/**
 * An option that is either a value or an explicit null that clears the field; an unset option is a
 * null {@code Patch} field and isn't sent. Internal: params builders expose it as {@code setX} and
 * {@code clearX}.
 *
 * @param <T> the value type
 */
public final class Patch<T> {
  private static final Patch<?> CLEAR = new Patch<>(null);
  private final T value;

  private Patch(T value) { this.value = value; }

  /**
   * @param <T> the value type
   * @return a patch that sends null
   */
  @SuppressWarnings("unchecked")
  public static <T> Patch<T> clear() { return (Patch<T>) CLEAR; }

  /**
   * @param <T> the value type
   * @param value the value; not null
   * @return a patch that sends the value
   */
  public static <T> Patch<T> value(T value) { return new Patch<>(Objects.requireNonNull(value, "value")); }

  /** @return whether this patch sends null */
  public boolean isClear() { return value == null; }

  /** @return the value, or null when this patch sends null */
  public T get() { return value; }

  @Override public boolean equals(Object other) { return other instanceof Patch<?> patch && Objects.equals(patch.value, value); }
  @Override public int hashCode() { return Objects.hashCode(value); }
  @Override public String toString() { return value == null ? "null" : String.valueOf(value); }
}
