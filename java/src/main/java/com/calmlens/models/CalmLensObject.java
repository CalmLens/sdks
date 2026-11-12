package com.calmlens.models;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Base of every response model. Models are immutable and decoded from the API's JSON, which each one
 * keeps: {@link #getRawJsonObject()} returns it, {@link #getAdditionalProperties()} the fields this
 * SDK version doesn't declare, and {@link #hasField(String)} tells a field the API left out from one
 * it sent as null. Two models are equal when their JSON is.
 */
public abstract class CalmLensObject {
  private static final Map<Class<?>, Set<String>> DECLARED = new ConcurrentHashMap<>();
  private transient JsonObject rawJsonObject;
  private transient ApiResponse lastResponse;

  /** Models are created by decoding. */
  protected CalmLensObject() {}

  /**
   * The JSON object this model was decoded from, unknown fields included. It is a copy; changing it
   * doesn't change the model.
   *
   * <p>Prefer the typed getters: this exposes Gson's API, so it is less stable than they are.
   *
   * @return the JSON object
   */
  public JsonObject getRawJsonObject() { return raw().deepCopy(); }

  /**
   * The fields the API sent that this SDK version doesn't declare, such as a field added after it
   * was released.
   *
   * @return the undeclared fields by name, as JSON
   */
  public Map<String, JsonElement> getAdditionalProperties() {
    Set<String> declared = DECLARED.computeIfAbsent(getClass(), CalmLensObject::declaredNames);
    Map<String, JsonElement> extra = new LinkedHashMap<>();
    for (var entry : raw().entrySet()) if (!declared.contains(entry.getKey())) extra.put(entry.getKey(), entry.getValue().deepCopy());
    return Collections.unmodifiableMap(extra);
  }

  /**
   * Whether the API sent a field, even as null. With an {@code Optional} getter this tells the three
   * cases apart: the field was left out ({@code hasField} is false), sent as null (true, and the
   * getter is empty) or sent with a value.
   *
   * @param name the field's API name, such as {@code "description"}
   * @return whether the JSON has the field
   */
  public boolean hasField(String name) { return raw().has(name); }

  /**
   * The response this model was read from, with its request ID, as stripe-java's {@code
   * getLastResponse()}. A model nested in another, or read from a webhook, has none.
   *
   * @return the response
   */
  public java.util.Optional<ApiResponse> getLastResponse() { return java.util.Optional.ofNullable(lastResponse); }

  /** @return the JSON this model was decoded from */
  public String toJson() { return raw().toString(); }

  /**
   * A field the API always sends, or {@code sdk/invalid-response} when this response lacked it.
   *
   * @param <T> the field type
   * @param value the field
   * @param name its API name
   * @return the value
   */
  protected final <T> T required(T value, String name) {
    if (value == null)
      throw com.calmlens.exception.CalmLensException.of(com.calmlens.ErrorCodes.SDK_INVALID_RESPONSE,
          "The response's " + getClass().getSimpleName() + " has no " + name, Map.of("field", name), 0, null, null, null, null);
    return value;
  }

  /**
   * Checks that this model and every model in it have each field the API always sends, so a
   * response that lacks one fails now rather than when its getter is read. Clients built with
   * {@code responseValidation(true)} check every response.
   *
   * @return this model
   * @throws com.calmlens.exception.InvalidResponseException naming the first missing field
   */
  public CalmLensObject validate() {
    com.calmlens.internal.Json.validate(this);
    return this;
  }

  private JsonObject raw() { return rawJsonObject == null ? new JsonObject() : rawJsonObject; }

  private static Set<String> declaredNames(Class<?> type) {
    Set<String> names = new java.util.HashSet<>();
    for (Class<?> current = type; current != null && current != CalmLensObject.class; current = current.getSuperclass())
      for (Field field : current.getDeclaredFields()) {
        if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers())) continue;
        com.google.gson.annotations.SerializedName name = field.getAnnotation(com.google.gson.annotations.SerializedName.class);
        names.add(name != null ? name.value() : field.getName());
      }
    return names;
  }

  @Override public boolean equals(Object other) {
    return other != null && other.getClass() == getClass() && ((CalmLensObject) other).raw().equals(raw());
  }

  @Override public int hashCode() { return raw().hashCode(); }

  @Override public String toString() { return getClass().getSimpleName() + raw(); }
}
