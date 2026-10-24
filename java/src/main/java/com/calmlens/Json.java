package com.calmlens;

import com.google.gson.ExclusionStrategy;
import com.google.gson.FieldAttributes;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.Strictness;
import com.google.gson.ToNumberPolicy;
import com.google.gson.TypeAdapter;
import com.google.gson.TypeAdapterFactory;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import com.google.gson.stream.JsonWriter;
import java.io.IOException;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.time.Instant;

/** The SDK's JSON configuration. Numbers in untyped values stay exact (whole numbers become Long). */
final class Json {
  private Json() {}

  private static GsonBuilder base() {
    return new GsonBuilder()
        .disableHtmlEscaping()
        .setObjectToNumberStrategy(ToNumberPolicy.LONG_OR_DOUBLE)
        .setNumberToNumberStrategy(ToNumberPolicy.LONG_OR_DOUBLE)
        .setExclusionStrategies(new ExclusionStrategy() {
          @Override public boolean shouldSkipField(FieldAttributes field) {
            return field.getName().equals("json") && KEEPS_JSON.contains(field.getDeclaringClass());
          }

          @Override public boolean shouldSkipClass(Class<?> type) { return false; }
        })
        .registerTypeAdapterFactory(new KeepsJsonFactory());
  }

  /** Records whose {@code json} component holds the object they were read from. */
  private static final java.util.Set<Class<?>> KEEPS_JSON = java.util.Set.of(Models.Event.class, Models.WebhookEventPayload.class);

  /**
   * Reads {@link Models.Event} and {@link Models.WebhookEventPayload} keeping the whole JSON object
   * in their {@code json} component, unknown fields included, and writes that object back when
   * they have one.
   */
  static final class KeepsJsonFactory implements TypeAdapterFactory {
    @Override
    @SuppressWarnings("unchecked")
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> token) {
      if (!KEEPS_JSON.contains(token.getRawType())) return null;
      TypeAdapter<T> delegate = gson.getDelegateAdapter(this, token);
      TypeAdapter<JsonElement> elements = gson.getAdapter(JsonElement.class);
      TypeAdapter<Object> objects = gson.getAdapter(Object.class);
      return new TypeAdapter<T>() {
        @Override public void write(JsonWriter out, T value) throws IOException {
          java.util.Map<String, Object> json = value instanceof Models.Event event ? event.json()
              : value instanceof Models.WebhookEventPayload payload ? payload.json() : null;
          if (json == null) { delegate.write(out, value); return; }
          boolean serializeNulls = out.getSerializeNulls();
          out.setSerializeNulls(true);
          try {
            objects.write(out, json);
          } finally {
            out.setSerializeNulls(serializeNulls);
          }
        }

        @Override public T read(JsonReader in) throws IOException {
          JsonElement tree = elements.read(in);
          if (tree == null || tree.isJsonNull()) return null;
          T typed = delegate.fromJsonTree(tree);
          if (!tree.isJsonObject() || typed == null) return typed;
          java.util.Map<String, Object> json = (java.util.Map<String, Object>) objects.fromJsonTree(tree);
          return typed instanceof Models.Event event ? (T) event.withJson(json) : (T) ((Models.WebhookEventPayload) typed).withJson(json);
        }
      };
    }
  }

  /** Reads responses strictly and turns models into trees; unset fields are omitted. */
  static final Gson GSON = base().setStrictness(Strictness.STRICT).create();

  /** Writes request bodies built as trees, keeping explicit nulls (cleared fields). */
  static final Gson WRITE = base().serializeNulls().create();

  static String write(JsonElement value) { return WRITE.toJson(value); }

  /** Metadata nulls are data; optional request fields still omit unset values. */
  static final class MetadataValueAdapter extends TypeAdapter<Object> {
    @Override public void write(JsonWriter out, Object value) throws IOException {
      boolean serializeNulls = out.getSerializeNulls();
      out.setSerializeNulls(true);
      try {
        GSON.getAdapter(Object.class).write(out, value);
      } finally {
        out.setSerializeNulls(serializeNulls);
      }
    }

    @Override public Object read(JsonReader in) throws IOException {
      return GSON.getAdapter(Object.class).read(in);
    }
  }

  /** Timestamps are milliseconds since the Unix epoch on the wire and {@link Instant} in models. */
  static final class EpochMillis extends TypeAdapter<Instant> {
    @Override public void write(JsonWriter out, Instant value) throws IOException {
      if (value == null) out.nullValue();
      else out.value(value.toEpochMilli());
    }

    @Override public Instant read(JsonReader in) throws IOException {
      JsonToken token = in.peek();
      if (token == JsonToken.NULL) { in.nextNull(); return null; }
      if (token == JsonToken.STRING) return Instant.parse(in.nextString());
      String number = in.nextString();
      try {
        return Instant.ofEpochMilli(Long.parseLong(number));
      } catch (NumberFormatException fractional) {
        return Instant.ofEpochMilli(Math.round(Double.parseDouble(number)));
      }
    }
  }

  /** Reads JSON null as {@link Models.Patch#clear()} and writes it as null even when nulls are omitted. */
  static final class PatchAdapterFactory implements TypeAdapterFactory {
    @Override
    @SuppressWarnings("unchecked")
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> token) {
      if (token.getRawType() != Models.Patch.class) return null;
      Type valueType = token.getType() instanceof ParameterizedType parameterized ? parameterized.getActualTypeArguments()[0] : Object.class;
      TypeAdapter<Object> delegate = (TypeAdapter<Object>) gson.getAdapter(TypeToken.get(valueType));
      return (TypeAdapter<T>) new TypeAdapter<Models.Patch<?>>() {
        @Override public void write(JsonWriter out, Models.Patch<?> patch) throws IOException {
          if (patch == null) { out.nullValue(); return; }
          if (patch.isClear()) {
            boolean serializeNulls = out.getSerializeNulls();
            out.setSerializeNulls(true);
            out.nullValue();
            out.setSerializeNulls(serializeNulls);
            return;
          }
          delegate.write(out, patch.get());
        }

        @Override public Models.Patch<?> read(JsonReader in) throws IOException {
          if (in.peek() == JsonToken.NULL) { in.nextNull(); return Models.Patch.clear(); }
          return Models.Patch.value(delegate.read(in));
        }
      };
    }
  }
}
