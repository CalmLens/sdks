package com.calmlens.models;

import com.calmlens.internal.Json;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.google.gson.TypeAdapter;
import com.google.gson.annotations.JsonAdapter;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import com.google.gson.stream.JsonWriter;
import java.io.IOException;
import java.util.Map;
import java.util.Objects;

/** An image transform's output quality: a number from 1 to 100, or a level. */
@JsonAdapter(Quality.Adapter.class)
public final class Quality {
  private final Integer value;
  private final String level;

  private Quality(Integer value, String level) { this.value = value; this.level = level; }

  /**
   * @param value a quality from 1 to 100
   * @return a numeric quality
   */
  public static Quality of(int value) { return new Quality(value, null); }

  /**
   * @param level {@code low}, {@code medium} or {@code high}
   * @return a quality level
   */
  public static Quality level(String level) { return new Quality(null, Objects.requireNonNull(level, "level")); }

  /** @return the numeric quality, or null for a level */
  public Integer value() { return value; }
  /** @return the level, or null for a numeric quality */
  public String level() { return level; }

  @Override public boolean equals(Object other) {
    return other instanceof Quality q && Objects.equals(q.value, value) && Objects.equals(q.level, level);
  }
  @Override public int hashCode() { return Objects.hash(value, level); }
  @Override public String toString() { return level != null ? level : String.valueOf(value); }

  static final class Adapter extends TypeAdapter<Quality> {
    @Override public void write(JsonWriter out, Quality quality) throws IOException {
      if (quality == null) out.nullValue();
      else if (quality.level != null) out.value(quality.level);
      else out.value(quality.value);
    }

    @Override public Quality read(JsonReader in) throws IOException {
      if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
      if (in.peek() == JsonToken.STRING) return level(in.nextString());
      return of(in.nextInt());
    }
  }
}
