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

/** Whether and how an edge trim also trims a uniform border. */
@JsonAdapter(TrimBorder.Adapter.class)
public final class TrimBorder {
  private final Boolean enabled;
  private final String color;
  private final Double tolerance, keep;

  private TrimBorder(Boolean enabled, String color, Double tolerance, Double keep) { this.enabled = enabled; this.color = color; this.tolerance = tolerance; this.keep = keep; }

  /**
   * @param enabled whether to trim the border
   * @return {@code true} or {@code false} on the wire
   */
  public static TrimBorder enabled(boolean enabled) { return new TrimBorder(enabled, null, null, null); }

  /**
   * @param color the border colour, or null to detect it
   * @param tolerance how far colours may differ from it, or null
   * @param keep pixels of border to keep, or null
   * @return border trimming with these settings
   */
  public static TrimBorder options(String color, Double tolerance, Double keep) { return new TrimBorder(null, color, tolerance, keep); }

  /** @return the on/off value, or null when settings are given */
  public Boolean enabled() { return enabled; }
  /** @return the border colour, or null */
  public String color() { return color; }
  /** @return the colour tolerance, or null */
  public Double tolerance() { return tolerance; }
  /** @return pixels of border to keep, or null */
  public Double keep() { return keep; }

  @Override public boolean equals(Object other) {
    return other instanceof TrimBorder b && Objects.equals(b.enabled, enabled) && Objects.equals(b.color, color) && Objects.equals(b.tolerance, tolerance) && Objects.equals(b.keep, keep);
  }
  @Override public int hashCode() { return Objects.hash(enabled, color, tolerance, keep); }
  @Override public String toString() { return enabled != null ? enabled.toString() : "{color=" + color + ", tolerance=" + tolerance + ", keep=" + keep + "}"; }

  static final class Adapter extends TypeAdapter<TrimBorder> {
    @Override public void write(JsonWriter out, TrimBorder value) throws IOException {
      if (value == null) { out.nullValue(); return; }
      if (value.enabled != null) { out.value(value.enabled); return; }
      out.beginObject();
      if (value.color != null) out.name("color").value(value.color);
      if (value.tolerance != null) out.name("tolerance").value(value.tolerance);
      if (value.keep != null) out.name("keep").value(value.keep);
      out.endObject();
    }

    @Override public TrimBorder read(JsonReader in) throws IOException {
      if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
      if (in.peek() == JsonToken.BOOLEAN) return enabled(in.nextBoolean());
      JsonObject object = JsonParser.parseReader(in).getAsJsonObject();
      JsonElement color = object.get("color");
      return options(color == null || color.isJsonNull() ? null : color.getAsString(), number(object, "tolerance"), number(object, "keep"));
    }
  }

  private static Double number(JsonObject object, String name) {
    JsonElement value = object.get(name);
    return value == null || value.isJsonNull() ? null : value.getAsDouble();
  }
}
