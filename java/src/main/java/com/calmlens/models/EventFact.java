package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * One registered event fact. Render {@code url} only after checking it (see the events docs).
 */
public final class EventFact extends CalmLensObject {
  @Required private String key;
  private @org.jspecify.annotations.Nullable Object value;
  private String url;

  private EventFact() {}

  /** @return fact key, such as {@code flagged-categories} */
  public String getKey() { return required(key, "key"); }

  /** @return fact value */
  public @org.jspecify.annotations.Nullable Object getValue() { return value; }

  /** @return link for the fact, if any; empty when the API sends none */
  public Optional<String> getUrl() { return Optional.ofNullable(url); }

  /**
   * A fact, for building test events such as {@code MockCalmLensServerClient.enqueueEvent}.
   *
   * @param key the registered fact key
   * @param value its value: a string, number, boolean, list, map or null
   * @param url its link, or null
   * @return the fact
   */
  public static EventFact of(String key, @org.jspecify.annotations.Nullable Object value, @org.jspecify.annotations.Nullable String url) {
    com.google.gson.JsonObject json = new com.google.gson.JsonObject();
    json.addProperty("key", key);
    json.add("value", com.calmlens.internal.Json.WRITE.toJsonTree(value));
    if (url != null) json.addProperty("url", url);
    return com.calmlens.internal.Json.GSON.fromJson(json, EventFact.class);
  }

  /**
   * @param key the registered fact key
   * @param value its value
   * @return the fact, without a link
   */
  public static EventFact of(String key, @org.jspecify.annotations.Nullable Object value) { return of(key, value, null); }
}
