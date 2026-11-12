package com.calmlens.params;

import com.calmlens.ErrorCodes;
import com.calmlens.exception.CalmLensException;
import com.calmlens.internal.Json;
import com.calmlens.internal.Required;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Base of every params object. Params are immutable and made with their {@code builder()}: set the
 * options you need and call {@code build()}, which refuses missing required options with {@code
 * sdk/invalid-argument}. Unset options are not sent.
 *
 * <p>{@link Builder#putExtraParam(String, Object)} sends a field this SDK version doesn't know yet,
 * such as one the API added after it was released. An extra param replaces a typed option of the
 * same name.
 */
public abstract class ApiParams {
  private final transient Map<String, @Nullable Object> extraParams;

  /**
   * @param builder the builder whose extra params these params keep
   */
  protected ApiParams(Builder<?> builder) {
    this.extraParams = Collections.unmodifiableMap(new LinkedHashMap<>(builder.extraParams));
  }

  /** @return the fields this SDK version doesn't declare, sent as they are */
  public Map<String, @Nullable Object> getExtraParams() { return extraParams == null ? Map.of() : extraParams; }

  @Override public boolean equals(Object other) {
    return other != null && other.getClass() == getClass() && Json.GSON.toJsonTree(other).equals(Json.GSON.toJsonTree(this));
  }

  @Override public int hashCode() { return Json.GSON.toJsonTree(this).hashCode(); }

  @Override public String toString() { return getClass().getSimpleName() + Json.GSON.toJsonTree(this); }

  /**
   * The shared part of every params builder.
   *
   * @param <B> the builder
   */
  public abstract static class Builder<B extends Builder<B>> {
    private final Map<String, @Nullable Object> extraParams = new LinkedHashMap<>();

    /** A builder with nothing set. */
    protected Builder() {}

    /**
     * Sends a field this SDK version doesn't declare. The value is encoded as JSON: a string,
     * number, boolean, null, list or map, or another params object.
     *
     * @param key the field's API name
     * @param value its value; null sends null
     * @return this builder
     */
    @SuppressWarnings("unchecked")
    public B putExtraParam(String key, @Nullable Object value) {
      if (key == null || key.isEmpty()) throw CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, "An extra param needs a name");
      extraParams.put(key, value);
      return (B) this;
    }

    /**
     * Sends several fields this SDK version doesn't declare.
     *
     * @param values the fields by API name
     * @return this builder
     */
    @SuppressWarnings("unchecked")
    public B putAllExtraParam(Map<String, ?> values) {
      values.forEach(this::putExtraParam);
      return (B) this;
    }

    /**
     * Refuses params whose required options are unset.
     *
     * @param <P> the params
     * @param params the built params
     * @return {@code params}
     */
    protected static <P extends ApiParams> P checkRequired(P params) {
      List<String> missing = new ArrayList<>();
      for (Field field : params.getClass().getDeclaredFields()) {
        if (Modifier.isStatic(field.getModifiers()) || !field.isAnnotationPresent(Required.class)) continue;
        field.setAccessible(true);
        try {
          if (field.get(params) == null && !params.getExtraParams().containsKey(Json.wireName(field))) missing.add(Json.wireName(field));
        } catch (IllegalAccessException unreachable) {
          throw new IllegalStateException(unreachable);
        }
      }
      if (!missing.isEmpty())
        throw CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, String.join(", ", missing) + (missing.size() == 1 ? " is" : " are")
            + " required", Map.of("missing", missing), 0, null, null, null, null);
      return params;
    }
  }
}
