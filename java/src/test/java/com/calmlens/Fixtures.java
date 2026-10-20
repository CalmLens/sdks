package com.calmlens;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Shared contract fixtures (generated from the JavaScript SDK by packages/sdk-contract/generate.ts). */
final class Fixtures {
  private Fixtures() {}

  static final Gson JSON = new Gson();

  static JsonElement read(String name) throws IOException {
    return JsonParser.parseString(Files.readString(Path.of("testdata", name)));
  }

  /** Calls a public SDK method by its fixture name, decoding the options into its native model. */
  static Object invoke(CalmLensServerClient client, String operation, JsonObject options) throws Throwable {
    String[] parts = operation.split("\\.");
    Object target = parts.length == 1 ? client : CalmLensServerClient.class.getField(parts[0]).get(client);
    int arity = operation.equals("folders.list") ? 0 : 1;
    Method method = Arrays.stream(target.getClass().getMethods())
        .filter(m -> m.getName().equals(parts[parts.length - 1]) && m.getParameterCount() == arity
            && (arity == 0 || m.getParameterTypes()[0] != String.class))
        .findFirst().orElseThrow();
    try {
      return method.invoke(target, arity == 0 ? new Object[0] : new Object[] {decode(options, method.getParameterTypes()[0])});
    } catch (InvocationTargetException failure) {
      throw failure.getCause();
    }
  }

  /**
   * Decodes fixture options into a native model. A {@code transform} is set through the builder
   * overload for its shape: a selector string, one {@link Models.Transform} or a list of them.
   */
  static <T> T decode(JsonObject options, Class<T> type) throws ReflectiveOperationException {
    T model = JSON.fromJson(options, type);
    JsonElement transform = options.get("transform");
    if (transform == null || transform.isJsonNull()) return model;
    if (transform.isJsonPrimitive()) type.getMethod("transform", String.class).invoke(model, transform.getAsString());
    else if (transform.isJsonArray()) {
      List<Models.Transform> steps = new ArrayList<>();
      for (JsonElement step : transform.getAsJsonArray()) steps.add(step(step.getAsJsonObject()));
      type.getMethod("transform", List.class).invoke(model, steps);
    } else type.getMethod("transform", Models.Transform.class).invoke(model, step(transform.getAsJsonObject()));
    return model;
  }

  /**
   * Decodes a structured transform step. Options that {@link Models.ImageTransformOptions} cannot
   * hold (not an object, or an array value) fail with {@code sdk/invalid-argument}, the error the
   * other SDKs return when serializing them.
   */
  private static Models.Transform step(JsonObject step) {
    JsonElement options = step.get("options");
    Models.ImageTransformOptions typed;
    try {
      typed = options == null || options.isJsonNull() ? null : Json.GSON.fromJson(options, Models.ImageTransformOptions.class);
    } catch (com.google.gson.JsonParseException | IllegalStateException unrepresentable) {
      throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Transform options must be image transform options");
    }
    return new Models.Transform(step.has("type") ? step.get("type").getAsString() : null, typed);
  }

  /** A request in the fixtures' shape: method, path, decoded query and JSON or text body. */
  static JsonObject describe(String method, URI uri, Map<String, String> headers, byte[] body) {
    JsonObject query = new JsonObject();
    if (uri.getRawQuery() != null)
      for (String pair : uri.getRawQuery().split("&")) {
        String[] parts = pair.split("=", 2);
        query.addProperty(URLDecoder.decode(parts[0], StandardCharsets.UTF_8), URLDecoder.decode(parts.length == 2 ? parts[1] : "", StandardCharsets.UTF_8));
      }
    JsonObject request = new JsonObject();
    request.addProperty("method", method);
    request.addProperty("path", uri.getRawPath());
    request.add("query", query);
    request.add("body", body == null ? JsonNull.INSTANCE
        : "application/json".equals(headers.get("Content-Type")) ? JsonParser.parseString(new String(body, StandardCharsets.UTF_8))
        : new JsonPrimitive(new String(body, StandardCharsets.UTF_8)));
    return request;
  }

  static byte[] body(Transport.Request request) throws IOException {
    if (request.body() == null) return null;
    try (InputStream in = request.body().open()) { return in.readAllBytes(); }
  }

  /** A minimal asset response: an ID and its processing, moderation and content statuses. */
  static Map<String, Object> asset(String id, String processing, String moderation) {
    Map<String, Object> asset = new LinkedHashMap<>();
    asset.put("id", id);
    asset.put("processing", Map.of("status", processing));
    asset.put("moderation", Map.of("status", moderation));
    asset.put("content", Map.of("status", "stored"));
    return asset;
  }

  /** {@link #asset} as a JSON string. */
  static String assetJson(String id, String processing, String moderation) { return JSON.toJson(asset(id, processing, moderation)); }

  static Transport.Response json(int status, String body) {
    return new Transport.Response(status, Map.of("content-type", List.of("application/json")), body.getBytes(StandardCharsets.UTF_8));
  }

  static Transport.Response json(int status, String body, Map<String, List<String>> headers) {
    return new Transport.Response(status, headers, body.getBytes(StandardCharsets.UTF_8));
  }
}
