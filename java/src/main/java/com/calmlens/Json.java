package com.calmlens;

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
        .setNumberToNumberStrategy(ToNumberPolicy.LONG_OR_DOUBLE);
  }

  /** Reads responses strictly and turns models into trees; unset fields are omitted. */
  static final Gson GSON = base().setStrictness(Strictness.STRICT).create();

  /** Writes request bodies built as trees, keeping explicit nulls (cleared fields). */
  static final Gson WRITE = base().serializeNulls().create();

  static String write(JsonElement value) { return WRITE.toJson(value); }

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
