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
 * A border drawn around the image.
 *
 * @param color colour, such as {@code #fff}
 * @param width width in pixels
 */
public record ImageBorder(String color, Double width) {
  /** No border settings. */
  public ImageBorder() { this(null, null); }

  /** @param value the colour @return a copy with this colour */
  public ImageBorder color(String value) { return new ImageBorder(value, width); }

  /** @param value the width in pixels @return a copy with this width */
  public ImageBorder width(Double value) { return new ImageBorder(color, value); }
}
