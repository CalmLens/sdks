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

/** What an image transform trims: a uniform border ({@link #border()}) or edges ({@link #edges(TrimEdges)}). */
@JsonAdapter(Trim.Adapter.class)
public final class Trim {
  private final String mode;
  private final TrimEdges edges;

  private Trim(String mode, TrimEdges edges) { this.mode = mode; this.edges = edges; }

  /** @return a trim of a uniform border ({@code "border"}) */
  public static Trim border() { return new Trim("border", null); }

  /**
   * @param edges pixels to trim from each edge, or the size to trim to
   * @return an edge trim
   */
  public static Trim edges(TrimEdges edges) { return new Trim(null, Objects.requireNonNull(edges, "edges")); }

  /** @return the named mode, such as {@code border}, or null for an edge trim */
  public String mode() { return mode; }
  /** @return the edges, or null for a named mode */
  public TrimEdges edges() { return edges; }

  @Override public boolean equals(Object other) { return other instanceof Trim t && Objects.equals(t.mode, mode) && Objects.equals(t.edges, edges); }
  @Override public int hashCode() { return Objects.hash(mode, edges); }
  @Override public String toString() { return mode != null ? mode : edges.toString(); }

  static final class Adapter extends TypeAdapter<Trim> {
    @Override public void write(JsonWriter out, Trim value) throws IOException {
      if (value == null) out.nullValue();
      else if (value.mode != null) out.value(value.mode);
      else Json.GSON.toJson(Json.GSON.toJsonTree(value.edges), out);
    }

    @Override public Trim read(JsonReader in) throws IOException {
      if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
      if (in.peek() == JsonToken.STRING) return new Trim(in.nextString(), null);
      return edges(Json.GSON.fromJson(JsonParser.parseReader(in), TrimEdges.class));
    }
  }
}
