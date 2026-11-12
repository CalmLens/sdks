package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

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
    // Methods without options, such as hashLists.list(), take no argument.
    int arity = Arrays.stream(target.getClass().getMethods())
        .anyMatch(m -> m.getName().equals(parts[parts.length - 1]) && m.getParameterCount() == 1) ? 1 : 0;
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

  /** JSON decoding can set private fields that a caller cannot. Input contracts also require a
   * public typed builder for each option, and a declared result model rather than Object. */
  static void assertSignature(CalmLensServerClient client, String operation, JsonObject options) throws Exception {
    String[] parts = operation.split("\\.");
    Object target = parts.length == 1 ? client : CalmLensServerClient.class.getField(parts[0]).get(client);
    Method method = Arrays.stream(target.getClass().getMethods())
        .filter(m -> m.getName().equals(parts[parts.length - 1]) && m.getParameterCount() == 1
            && m.getParameterTypes()[0] != String.class).findFirst().orElse(null);
    if (method == null) {
      assertEquals(0, options.size(), operation + " has no options parameter");
      method = target.getClass().getMethod(parts[parts.length - 1]);
    } else {
      Class<?> type = method.getParameterTypes()[0];
      for (String key : options.keySet()) {
        String builderName = Arrays.stream(type.getDeclaredFields())
            .filter(field -> field.isAnnotationPresent(com.google.gson.annotations.SerializedName.class)
                && field.getAnnotation(com.google.gson.annotations.SerializedName.class).value().equals(key))
            .map(java.lang.reflect.Field::getName).findFirst().orElse(key);
        List<Method> setters = Arrays.stream(type.getMethods())
            .filter(m -> m.getName().equals(builderName) && m.getParameterCount() == 1
                && type.isAssignableFrom(m.getReturnType())).toList();
        assertFalse(setters.isEmpty(), operation + "." + key + " needs a public typed builder");
        assertTrue(setters.stream().anyMatch(m -> m.getParameterTypes()[0] != Object.class),
            operation + "." + key + " must have a typed input");
      }
    }
    assertNotEquals(Object.class, method.getReturnType(), operation + " must declare its result type");
    assertNotEquals(Map.class, method.getReturnType(), operation + " must declare its result model");
  }

  /** Whether an operation is a list's iterator, which yields every item rather than returning a value. */
  static boolean isIterator(String operation) { return operation.substring(operation.lastIndexOf('.') + 1).startsWith("iterate"); }

  /**
   * Decodes fixture options into a native model. A CDN {@code transform} is set through the builder
   * overload for its shape: a selector string or {@link Models.ImageTransformOptions}. A lens's
   * {@code transform} is an ordinary field.
   */
  static <T> T decode(JsonObject options, Class<T> type) throws ReflectiveOperationException {
    T model = JSON.fromJson(options, type);
    JsonElement transform = options.get("transform");
    if (transform == null || transform.isJsonNull() || type == Models.LensDefinition.class || type == Models.UpdateLens.class) return model;
    if (transform.isJsonPrimitive()) type.getMethod("transform", String.class).invoke(model, transform.getAsString());
    else type.getMethod("transform", Models.ImageTransformOptions.class).invoke(model, transformOptions(transform));
    return model;
  }

  /**
   * Decodes structured transform options. Options that {@link Models.ImageTransformOptions} cannot
   * hold (not an object, or an array value) fail with {@code sdk/invalid-argument}, the error the
   * other SDKs return when serializing them.
   */
  private static Models.ImageTransformOptions transformOptions(JsonElement options) {
    try {
      if (!options.isJsonObject()) throw new IllegalStateException("Not an object");
      return Json.GSON.fromJson(options, Models.ImageTransformOptions.class);
    } catch (com.google.gson.JsonParseException | IllegalStateException unrepresentable) {
      throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Transform options must be image transform options");
    }
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

  /** The upload form a mock client's request carried. */
  static UploadForm.Parsed form(MockCalmLensServerClient.Request request) { return UploadForm.read(request.body(), request.header("Content-Type")); }

  /** The JSON options part of the upload form a mock client's request carried. */
  static JsonObject formOptions(MockCalmLensServerClient.Request request) { return JsonParser.parseString(form(request).options()).getAsJsonObject(); }

  static byte[] body(Transport.Request request) throws IOException {
    if (request.body() == null) return null;
    try (InputStream in = request.body().open()) { return in.readAllBytes(); }
  }

  /** A minimal asset response: an ID and its processing, moderation and content statuses. */
  static Map<String, Object> asset(String id, String processing, String moderation) {
    Map<String, Object> asset = new LinkedHashMap<>();
    asset.put("id", id);
    asset.put("upload", Map.of("status", "completed"));
    asset.put("classification", Map.of("status", processing, "moderation", Map.of("status", moderation)));
    asset.put("content", Map.of("status", "stored"));
    return asset;
  }

  /** {@link #asset} as a JSON string. */
  static String assetJson(String id, String processing, String moderation) { return JSON.toJson(asset(id, processing, moderation)); }

  /**
   * The error fields every runner compares, null where there is none: {@code code}, {@code status},
   * {@code requestId}, {@code retryAfter} (whole seconds) and {@code details}.
   */
  static JsonObject errorFields(CalmLensException error) {
    JsonObject fields = new JsonObject();
    fields.addProperty("code", error.getCode());
    fields.add("status", error.getStatus() == 0 ? JsonNull.INSTANCE : new JsonPrimitive(error.getStatus()));
    fields.add("requestId", error.getRequestId() == null ? JsonNull.INSTANCE : new JsonPrimitive(error.getRequestId()));
    java.util.Optional<java.time.Duration> retryAfter = error instanceof ApiException api ? api.getRetryAfter() : java.util.Optional.empty();
    fields.add("retryAfter", retryAfter.<JsonElement>map(delay -> new JsonPrimitive(delay.toSeconds())).orElse(JsonNull.INSTANCE));
    // getDetails() is never null: an API error's empty details are {}, an SDK error without details has none.
    boolean none = error.getDetails().isEmpty() && (error.getCode().startsWith("sdk/") || !(error instanceof ApiException));
    fields.add("details", none ? JsonNull.INSTANCE : Json.GSON.toJsonTree(error.getDetails()));
    return fields;
  }

  /** {@code value} without object members whose value is null, at every level. */
  /** Writes typed results with every declared field, null ones as null. */
  static final Gson WITH_NULLS = Json.GSON.newBuilder().serializeNulls().create();

  /**
   * Compares a fixture's expected JSON with what the SDK returned ({@code actual} is Java null when
   * absent). An expected null needs the field present and null; a field the result has but the
   * fixture doesn't list must be null (a declared field the response left unset).
   */
  static void assertMatches(JsonElement expected, JsonElement actual, String label) {
    if (expected == null || expected.isJsonNull()) {
      assertNotNull(actual, label + " is missing (expected null)");
      assertTrue(actual.isJsonNull(), label + ": expected null, got " + actual);
      return;
    }
    assertNotNull(actual, label + " is missing (expected " + expected + ")");
    if (expected.isJsonObject()) {
      assertTrue(actual.isJsonObject(), label + ": expected " + expected + ", got " + actual);
      JsonObject want = expected.getAsJsonObject(), got = actual.getAsJsonObject();
      want.entrySet().forEach(entry -> assertMatches(entry.getValue(), got.get(entry.getKey()), label + "." + entry.getKey()));
      got.entrySet().forEach(entry -> {
        if (!want.has(entry.getKey())) assertTrue(entry.getValue().isJsonNull(), label + "." + entry.getKey() + ": unexpected " + entry.getValue());
      });
    } else if (expected.isJsonArray()) {
      assertTrue(actual.isJsonArray(), label + ": expected " + expected + ", got " + actual);
      com.google.gson.JsonArray want = expected.getAsJsonArray(), got = actual.getAsJsonArray();
      assertEquals(want.size(), got.size(), label + ": length of " + got);
      for (int i = 0; i < want.size(); i++) assertMatches(want.get(i), got.get(i), label + "." + i);
    } else {
      assertEquals(expected, actual, label);
    }
  }

  static Transport.Response json(int status, String body) {
    return new Transport.Response(status, Map.of("content-type", List.of("application/json")), body.getBytes(StandardCharsets.UTF_8));
  }

  static Transport.Response json(int status, String body, Map<String, List<String>> headers) {
    return new Transport.Response(status, headers, body.getBytes(StandardCharsets.UTF_8));
  }
}
