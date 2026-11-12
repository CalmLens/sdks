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

/**
 * Where an image transform crops from: a named position such as {@code face}, {@code center} or
 * {@code entropy}, or a point.
 */
@JsonAdapter(Gravity.Adapter.class)
public final class Gravity {
  private final String position;
  private final String mode;
  private final Double x, y;

  private Gravity(String position, String mode, Double x, Double y) { this.position = position; this.mode = mode; this.x = x; this.y = y; }

  /**
   * @param position {@code face}, {@code left}, {@code right}, {@code top}, {@code bottom}, {@code
   *     center}, {@code auto} or {@code entropy}
   * @return a named gravity
   */
  public static Gravity position(String position) { return new Gravity(Objects.requireNonNull(position, "position"), null, null, null); }

  /**
   * @param mode {@code remainder} (fractions of the space left after resizing) or {@code box-center}
   *     (the crop box's centre as fractions of the image)
   * @param x horizontal position from 0 to 1, or null
   * @param y vertical position from 0 to 1, or null
   * @return a point gravity
   */
  public static Gravity point(String mode, Double x, Double y) { return new Gravity(null, Objects.requireNonNull(mode, "mode"), x, y); }

  /** @return the named position, or null for a point */
  public String position() { return position; }
  /** @return the point's mode, or null for a named position */
  public String mode() { return mode; }
  /** @return the point's horizontal position, or null */
  public Double x() { return x; }
  /** @return the point's vertical position, or null */
  public Double y() { return y; }

  @Override public boolean equals(Object other) {
    return other instanceof Gravity g && Objects.equals(g.position, position) && Objects.equals(g.mode, mode) && Objects.equals(g.x, x) && Objects.equals(g.y, y);
  }
  @Override public int hashCode() { return Objects.hash(position, mode, x, y); }
  @Override public String toString() { return position != null ? position : "{mode=" + mode + ", x=" + x + ", y=" + y + "}"; }

  static final class Adapter extends TypeAdapter<Gravity> {
    @Override public void write(JsonWriter out, Gravity value) throws IOException {
      if (value == null) { out.nullValue(); return; }
      if (value.position != null) { out.value(value.position); return; }
      out.beginObject();
      out.name("mode").value(value.mode);
      if (value.x != null) out.name("x").value(value.x);
      if (value.y != null) out.name("y").value(value.y);
      out.endObject();
    }

    @Override public Gravity read(JsonReader in) throws IOException {
      if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
      if (in.peek() == JsonToken.STRING) return position(in.nextString());
      JsonObject object = JsonParser.parseReader(in).getAsJsonObject();
      return point(object.get("mode").getAsString(), number(object, "x"), number(object, "y"));
    }
  }

  private static Double number(JsonObject object, String name) {
    JsonElement value = object.get(name);
    return value == null || value.isJsonNull() ? null : value.getAsDouble();
  }
}
