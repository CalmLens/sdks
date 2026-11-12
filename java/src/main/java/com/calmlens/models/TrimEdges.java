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
 * Pixels to trim from each image edge, or the size to trim to.
 *
 * @param top pixels from the top
 * @param bottom pixels from the bottom
 * @param left pixels from the left
 * @param right pixels from the right
 * @param width width to trim to
 * @param height height to trim to
 * @param border also trim a uniform border
 */
public record TrimEdges(Double top, Double bottom, Double left, Double right, Double width, Double height, TrimBorder border) {
  /** No edges set. */
  public TrimEdges() { this(null, null, null, null, null, null, null); }
  /** @param value pixels @return a copy with this setting */
  public TrimEdges top(Double value) { return new TrimEdges(value, bottom, left, right, width, height, border); }
  /** @param value pixels @return a copy with this setting */
  public TrimEdges bottom(Double value) { return new TrimEdges(top, value, left, right, width, height, border); }
  /** @param value pixels @return a copy with this setting */
  public TrimEdges left(Double value) { return new TrimEdges(top, bottom, value, right, width, height, border); }
  /** @param value pixels @return a copy with this setting */
  public TrimEdges right(Double value) { return new TrimEdges(top, bottom, left, value, width, height, border); }
  /** @param value pixels @return a copy with this setting */
  public TrimEdges width(Double value) { return new TrimEdges(top, bottom, left, right, value, height, border); }
  /** @param value pixels @return a copy with this setting */
  public TrimEdges height(Double value) { return new TrimEdges(top, bottom, left, right, width, value, border); }
  /** @param value border trimming @return a copy with this setting */
  public TrimEdges border(TrimBorder value) { return new TrimEdges(top, bottom, left, right, width, height, value); }
}
