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
import com.calmlens.exception.*;
import com.calmlens.internal.Json;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.*;
import com.calmlens.testing.MockCalmLensServerClient;

/** Shared contract fixtures (generated from the JavaScript SDK by packages/sdk-contract/generate.ts). */
final class Fixtures {
  private Fixtures() {}

  static final Gson JSON = new Gson();

  static JsonElement read(String name) throws IOException {
    return JsonParser.parseString(Files.readString(Path.of("testdata", name)));
  }

  /** Java's name for a fixture operation: {@code events.iterate} is {@code events.pages}. */
  static String javaOperation(String operation) { return operation; }

  /**
   * Calls a public SDK method by its fixture name, on the synchronous client or (with {@code async})
   * its asynchronous form, mapping the options onto the method's parameters: an option named like
   * a parameter fills it (path IDs, {@code timeoutMs}), {@code idempotencyKey} goes in the request
   * options, and the rest decode into the method's params.
   */
  static Object invoke(CalmLensServerClient client, String operation, JsonObject options) throws Throwable {
    return invoke(client, operation, options, false);
  }

  static Object invoke(CalmLensServerClient client, String operation, JsonObject options, boolean async) throws Throwable {
    String[] parts = javaOperation(operation).split("\\.");
    Object root = async ? client.async() : client;
    Object target = parts.length == 1 ? root : root.getClass().getMethod(parts[0]).invoke(root);
    Method method = null;
    Object[] args = null;
    JsonObject given = options == null ? new JsonObject() : options;
    for (Method candidate : target.getClass().getMethods()) {
      if (!candidate.getName().equals(parts[parts.length - 1])) continue;
      Object[] built = arguments(candidate, given);
      if (built != null && (method == null || candidate.getParameterCount() < method.getParameterCount())) { method = candidate; args = built; }
    }
    if (method == null) throw new AssertionError("No " + operation + " method takes " + given.keySet());
    try {
      Object result = method.invoke(target, args);
      if (result instanceof java.util.concurrent.CompletableFuture<?> future) {
        try {
          return future.get(30, java.util.concurrent.TimeUnit.SECONDS);
        } catch (java.util.concurrent.ExecutionException failed) {
          throw failed.getCause();
        }
      }
      return result;
    } catch (InvocationTargetException failure) {
      throw failure.getCause();
    }
  }

  /** The arguments for {@code method} from {@code options}, or null when it can't take every option. */
  private static Object[] arguments(Method method, JsonObject options) throws ReflectiveOperationException {
    java.util.Set<String> left = new java.util.LinkedHashSet<>(options.keySet());
    java.lang.reflect.Parameter[] parameters = method.getParameters();
    Object[] args = new Object[parameters.length];
    int paramsIndex = -1, requestIndex = -1;
    for (int i = 0; i < parameters.length; i++) {
      java.lang.reflect.Parameter parameter = parameters[i];
      String name = parameter.getName();
      if (parameter.getType() == RequestOptions.class) { requestIndex = i; continue; }
      if (com.calmlens.params.ApiParams.class.isAssignableFrom(parameter.getType())) { paramsIndex = i; continue; }
      if (name.equals("timeout") && parameter.getType() == java.time.Duration.class && options.has("timeoutMs")) {
        args[i] = java.time.Duration.ofMillis(options.get("timeoutMs").getAsLong());
        left.remove("timeoutMs");
        continue;
      }
      if (!options.has(name)) {
        // A path ID the options leave out is passed as null, so the SDK refuses it.
        if (parameter.getType() == String.class) { left.remove(name); continue; }
        if (parameter.isAnnotationPresent(org.jspecify.annotations.Nullable.class) || !parameter.getType().isPrimitive()) continue;
        return null;
      }
      args[i] = decodeValue(options.get(name), parameter.getParameterizedType(), parameter.getType());
      left.remove(name);
    }
    if (left.remove("idempotencyKey")) {
      if (requestIndex < 0) return null;
      args[requestIndex] = RequestOptions.builder().setIdempotencyKey(options.get("idempotencyKey").getAsString()).build();
    }
    if (paramsIndex >= 0) {
      JsonObject rest = new JsonObject();
      for (String key : left) rest.add(key, options.get(key));
      args[paramsIndex] = decode(rest, parameters[paramsIndex].getType());
      left.clear();
    }
    return left.isEmpty() ? args : null;
  }

  private static Object decodeValue(JsonElement value, java.lang.reflect.Type type, Class<?> raw) {
    if (value == null || value.isJsonNull()) return null;
    if (raw == com.calmlens.params.ViewerClaims.class || com.calmlens.params.ApiParams.class.isAssignableFrom(raw) || raw == List.class)
      return Json.GSON.fromJson(value, type);
    return Json.GSON.fromJson(value, type);
  }

  /** Every name a fixture operation has in Java: {@code assets().list} is {@code assets.list}. */
  static Method signatureMethod(CalmLensServerClient client, String operation) throws Exception {
    String[] parts = javaOperation(operation).split("\\.");
    Class<?> target = parts.length == 1 ? CalmLensServerClient.class : CalmLensServerClient.class.getMethod(parts[0]).getReturnType();
    // The overload with params, else the one with the most parameters, without request options.
    return Arrays.stream(target.getMethods()).filter(m -> m.getName().equals(parts[parts.length - 1]))
        .filter(m -> Arrays.stream(m.getParameterTypes()).noneMatch(t -> t == RequestOptions.class))
        .max(java.util.Comparator.<Method>comparingInt(m -> Arrays.stream(m.getParameterTypes()).anyMatch(com.calmlens.params.ApiParams.class::isAssignableFrom) ? 1 : 0)
            .thenComparingInt(Method::getParameterCount)).orElseThrow();
  }

  /**
   * Input contracts require each option to be a typed parameter of the method or a typed builder
   * setter of its params, and a declared result model rather than Object.
   */
  static void assertSignature(CalmLensServerClient client, String operation, JsonObject options) throws Exception {
    Method method = signatureMethod(client, operation);
    Class<?> params = Arrays.stream(method.getParameterTypes()).filter(com.calmlens.params.ApiParams.class::isAssignableFrom).findFirst().orElse(null);
    java.util.Set<String> named = new java.util.HashSet<>();
    for (java.lang.reflect.Parameter parameter : method.getParameters()) named.add(parameter.getName());
    for (String key : options.keySet()) {
      if (named.contains(key) || key.equals("idempotencyKey") || key.equals("timeoutMs") && named.contains("timeout")) continue;
      assertNotNull(params, operation + "." + key + " is neither a parameter nor a params option");
      Class<?> builder = params.getMethod("builder").getReturnType();
      String setter = "set" + Character.toUpperCase(key.charAt(0)) + key.substring(1);
      List<Method> setters = Arrays.stream(builder.getMethods()).filter(m -> m.getName().equals(setter) && m.getParameterCount() == 1).toList();
      assertFalse(setters.isEmpty(), operation + "." + key + " needs a public typed builder setter");
      assertTrue(setters.stream().anyMatch(m -> m.getParameterTypes()[0] != Object.class), operation + "." + key + " must have a typed input");
    }
    assertNotEquals(Object.class, method.getReturnType(), operation + " must declare its result type");
    assertNotEquals(Map.class, method.getReturnType(), operation + " must declare its result model");
  }

  /** surface.json's error kinds by id: their Java class name and parent kind. */
  private static Map<String, JsonObject> errorKinds;

  static synchronized Map<String, JsonObject> errorKinds() throws IOException {
    if (errorKinds == null) {
      Map<String, JsonObject> kinds = new LinkedHashMap<>();
      read("surface.json").getAsJsonObject().getAsJsonArray("errorKinds").forEach(k -> kinds.put(k.getAsJsonObject().get("id").getAsString(), k.getAsJsonObject()));
      errorKinds = kinds;
    }
    return errorKinds;
  }

  /** The Java class of an error kind, from its name in surface.json. */
  static Class<?> errorKindClass(String kind) throws Exception {
    JsonObject entry = errorKinds().get(kind);
    assertNotNull(entry, "unknown error kind " + kind);
    return Class.forName("com.calmlens.exception." + entry.getAsJsonObject("names").get("java").getAsString());
  }

  /** {@code error} is of {@code kind} and of every kind above it. */
  static void assertKind(Throwable error, String kind, String label) throws Exception {
    for (String current = kind; current != null; ) {
      assertTrue(errorKindClass(current).isInstance(error), label + ": " + error.getClass().getSimpleName() + " is not " + current);
      JsonElement parent = errorKinds().get(current).get("parent");
      current = parent == null || parent.isJsonNull() ? null : parent.getAsString();
    }
  }

  /** Params or a model as the JSON object the SDK sends. */
  static JsonObject encode(Object value) { return Json.GSON.toJsonTree(value).getAsJsonObject(); }

  /** Whether an operation is a list's iterator, which yields every item rather than returning a value. */
  static boolean isIterator(String operation) {
    String name = javaOperation(operation);
    return name.substring(name.lastIndexOf('.') + 1).startsWith("iterate") || name.equals("events.pages");
  }

  /**
   * Decodes fixture options into native params. A CDN {@code transform} is held as a selector
   * string or {@link ImageTransformOptions}, which the params' builder sets; a lens's {@code
   * transform} is an ordinary field.
   */
  static <T> T decode(JsonObject options, Class<T> type) throws ReflectiveOperationException {
    T model = JSON_PARAMS.fromJson(options, type);
    JsonElement transform = options.get("transform");
    if (transform == null || transform.isJsonNull() || type == com.calmlens.params.LensCreateParams.class || type == com.calmlens.params.LensUpdateParams.class) return model;
    java.lang.reflect.Field field = type.getDeclaredField("transform");
    field.setAccessible(true);
    field.set(model, transform.isJsonPrimitive() ? transform.getAsString() : transformOptions(transform));
    return model;
  }

  /** Decodes params as the SDK reads them (its enum and patch adapters), which builders can't bypass but tests may. */
  private static final Gson JSON_PARAMS = Json.GSON;

  /**
   * Decodes structured transform options. Options that {@link ImageTransformOptions} cannot hold
   * (not an object, or an array value) fail with {@code sdk/invalid-argument}, the error the other
   * SDKs return when serializing them.
   */
  private static ImageTransformOptions transformOptions(JsonElement options) {
    try {
      if (!options.isJsonObject()) throw new IllegalStateException("Not an object");
      return Json.GSON.fromJson(options, ImageTransformOptions.class);
    } catch (com.google.gson.JsonParseException | IllegalStateException unrepresentable) {
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, "Transform options must be image transform options");
    }
  }

  /**
   * A model as its typed fields read it: each declared field by its API name, enums by value
   * ({@code UNKNOWN} as its raw value is lost, so null), timestamps in epoch milliseconds. It shows
   * what the getters return, not the JSON the model kept.
   */
  static JsonElement typed(Object value) {
    if (value == null) return JsonNull.INSTANCE;
    if (value instanceof CalmLensObject model) {
      JsonObject object = new JsonObject();
      for (Class<?> type = model.getClass(); type != CalmLensObject.class; type = type.getSuperclass())
        for (java.lang.reflect.Field field : type.getDeclaredFields()) {
          if (java.lang.reflect.Modifier.isStatic(field.getModifiers()) || java.lang.reflect.Modifier.isTransient(field.getModifiers())) continue;
          field.setAccessible(true);
          try {
            object.add(Json.wireName(field), typed(field.get(model)));
          } catch (IllegalAccessException unreachable) {
            throw new IllegalStateException(unreachable);
          }
        }
      return object;
    }
    if (value instanceof List<?> list) {
      com.google.gson.JsonArray array = new com.google.gson.JsonArray();
      list.forEach(item -> array.add(typed(item)));
      return array;
    }
    if (value instanceof Map<?, ?> map) {
      JsonObject object = new JsonObject();
      map.forEach((key, item) -> object.add(String.valueOf(key), typed(item)));
      return object;
    }
    if (value instanceof ApiEnum constant) return constant.getValue() == null ? JsonNull.INSTANCE : new JsonPrimitive(constant.getValue());
    if (value instanceof java.time.Instant instant) return new JsonPrimitive(instant.toEpochMilli());
    return WITH_NULLS.toJsonTree(value);
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

  /** A complete asset as the API returns it, from the mock's in-memory API, to change per test. */
  private static JsonObject assetTemplate;

  private static synchronized JsonObject assetTemplate() {
    if (assetTemplate == null) {
      try (MockCalmLensServerClient mock = new MockCalmLensServerClient()) {
        assetTemplate = mock.client().assets().create(com.calmlens.params.AssetCreateParams.builder().setName("asset")
            .setContent(com.calmlens.params.Content.text("hello")).build()).getRawJsonObject();
      }
    }
    return assetTemplate.deepCopy();
  }

  /** An asset response with this ID, classification status and moderation decision ({@code pending} for none). */
  static Map<String, Object> asset(String id, String processing, String moderation) {
    JsonObject asset = assetTemplate();
    asset.addProperty("id", id);
    JsonObject classification = asset.getAsJsonObject("classification");
    classification.addProperty("status", processing);
    classification.getAsJsonObject("moderation").add("decision", "pending".equals(moderation) ? JsonNull.INSTANCE : new JsonPrimitive(moderation));
    @SuppressWarnings("unchecked")
    Map<String, Object> map = (Map<String, Object>) WITH_NULLS.fromJson(asset, Map.class);
    return map;
  }

  /** {@link #asset} as a JSON string. */
  static String assetJson(String id, String processing, String moderation) { return WITH_NULLS.toJson(asset(id, processing, moderation)); }

  /**
   * The error fields every runner compares, null where there is none: {@code code}, {@code status},
   * {@code requestId}, {@code retryAfter} (whole seconds) and {@code details}.
   */
  static JsonObject errorFields(CalmLensException error) {
    JsonObject fields = new JsonObject();
    fields.addProperty("code", error.getCode());
    fields.add("status", error.getStatus() == 0 ? JsonNull.INSTANCE : new JsonPrimitive(error.getStatus()));
    fields.add("requestId", error.getRequestId().<JsonElement>map(JsonPrimitive::new).orElse(JsonNull.INSTANCE));
    java.util.Optional<java.time.Duration> retryAfter = error.getRetryAfter();
    fields.add("retryAfter", retryAfter.<JsonElement>map(delay -> new JsonPrimitive(delay.toSeconds())).orElse(JsonNull.INSTANCE));
    // getDetails() is never null: an API error's empty details are {}, an SDK error without details has none.
    boolean none = error.getDetails().isEmpty() && (error.getCode().startsWith("sdk/") || error.getStatus() == 0);
    fields.add("details", none ? JsonNull.INSTANCE : Json.WRITE.toJsonTree(error.getDetails()));
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
