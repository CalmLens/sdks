package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.MockCalmLensServerClient.Grant;
import com.calmlens.MockCalmLensServerClient.Options;
import com.calmlens.MockCalmLensServerClient.Outcome;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.function.ThrowingConsumer;

/**
 * Replays every shared SDK contract fixture in {@code testdata/} (packages/sdk-contract/README.md):
 * requests, paths, webhooks, errors, transform options, mock behaviour scenarios, the capability
 * surface and refused requests. Each fixture case is its own dynamic test.
 */
class ContractTest {
  private static CalmLensServerClient client(Transport transport) {
    return CalmLensServerClient.builder("key", "project-1").transport(transport).build();
  }

  /** One dynamic test per element of {@code cases}, named by its index and {@code name}. */
  private static Stream<DynamicTest> cases(JsonArray cases, Function<JsonObject, Object> name, ThrowingConsumer<JsonObject> test) {
    List<DynamicTest> tests = new ArrayList<>();
    for (int i = 0; i < cases.size(); i++) {
      JsonObject item = cases.get(i).getAsJsonObject();
      tests.add(DynamicTest.dynamicTest(i + ": " + name.apply(item), () -> test.accept(item)));
    }
    assertFalse(tests.isEmpty(), "no fixture cases");
    return tests.stream();
  }

  private static JsonArray array(String file) throws Exception { return Fixtures.read(file).getAsJsonArray(); }

  private static JsonArray array(String file, String key) throws Exception { return Fixtures.read(file).getAsJsonObject().getAsJsonArray(key); }

  // requests.json

  @TestFactory Stream<DynamicTest> requestContracts() throws Exception {
    return cases(array("requests.json"), f -> f.get("operation").getAsString(), fixture -> {
      JsonObject[] captured = {null};
      CalmLensServerClient client = client(request -> {
        assertEquals("key", request.headers().get("X-Api-Key"));
        captured[0] = Fixtures.describe(request.method(), request.uri(), request.headers(), Fixtures.body(request));
        return Fixtures.json(200, fixture.get("response").toString());
      });
      Fixtures.invoke(client, fixture.get("operation").getAsString(), fixture.getAsJsonObject("options"));
      assertEquals(fixture.get("request"), captured[0]);
    });
  }

  /** Queued responses still pass through the real client, so every request contract holds against the mock. */
  @TestFactory Stream<DynamicTest> requestContractsThroughTheMock() throws Exception {
    return cases(array("requests.json"), f -> f.get("operation").getAsString(), fixture -> {
      MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueue(200, fixture.get("response"));
      Fixtures.invoke(mock.client, fixture.get("operation").getAsString(), fixture.getAsJsonObject("options"));
      assertEquals(1, mock.requests().size());
      var recorded = mock.requests().get(0);
      assertEquals(fixture.get("request"), Fixtures.describe(recorded.method(), java.net.URI.create(recorded.url()), recorded.headers(), recorded.body()));
      assertEquals(0, mock.remainingResponses());
    });
  }

  // paths.json

  @TestFactory Stream<DynamicTest> pathRejectionContracts() throws Exception {
    CalmLensServerClient client = client(request -> fail("Sent " + request.uri() + " for a rejected ID"));
    return cases(array("paths.json", "rejections"), r -> r.get("operation").getAsString(), rejection -> {
      String operation = rejection.get("operation").getAsString();
      CalmLensException error = assertThrows(CalmLensException.class, () -> Fixtures.invoke(client, operation, rejection.getAsJsonObject("options")), rejection.toString());
      assertEquals(rejection.get("error").getAsString(), error.getCode(), rejection.toString());
    });
  }

  @TestFactory Stream<DynamicTest> cdnUrlContracts() throws Exception {
    CalmLensServerClient client = client(request -> fail("Sent " + request.uri() + " to build a URL"));
    return cases(array("paths.json", "cdnUrls"), c -> c.get("options"), cdn -> {
      JsonObject options = cdn.getAsJsonObject("options");
      // Every fixture option must reach the request model, so a new option can't be silently ignored.
      if (cdn.has("url")) {
        java.util.Set<String> mapped = new java.util.HashSet<>(Models.encode(Fixtures.decode(options, Models.CdnRequest.class)).keySet());
        mapped.add("transform");
        assertTrue(mapped.containsAll(options.keySet()), cdn.toString());
        assertEquals(cdn.get("url").getAsString(), client.cdn.getAssetUrl(Fixtures.decode(options, Models.CdnRequest.class)));
      } else {
        // Options the typed transform model cannot hold are rejected while decoding them.
        assertEquals(cdn.get("error").getAsString(), assertThrows(CalmLensException.class,
            () -> client.cdn.getAssetUrl(Fixtures.decode(options, Models.CdnRequest.class))).getCode(), cdn.toString());
      }
    });
  }

  // errors.json

  @Test void errorCodeConstantsMatchThePublicApi() throws Exception {
    Map<String, Integer> expected = new HashMap<>();
    for (JsonElement item : array("errors.json"))
      expected.put(item.getAsJsonObject().get("code").getAsString(), item.getAsJsonObject().get("status").getAsInt());
    assertEquals(expected, ErrorCodes.apiStatuses());
    assertTrue(ErrorCodes.httpStatus(ErrorCodes.SDK_TIMEOUT).isEmpty());
  }

  @TestFactory Stream<DynamicTest> eachErrorCodeHasItsHttpStatus() throws Exception {
    return cases(array("errors.json"), e -> e.get("code").getAsString(), entry ->
        assertEquals(entry.get("status").getAsInt(), ErrorCodes.httpStatus(entry.get("code").getAsString()).orElseThrow()));
  }

  // webhooks.json

  @TestFactory Stream<DynamicTest> webhookVerificationContracts() throws Exception {
    return cases(array("webhooks.json", "verification"), v -> v.get("name").getAsString(), v -> {
      long tolerance = v.has("toleranceSeconds") ? v.get("toleranceSeconds").getAsLong() : CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
      byte[] body = v.get("body").getAsString().getBytes(StandardCharsets.UTF_8);
      String signature = v.get("signature").getAsString(), timestamp = v.get("timestamp").getAsString(), secret = v.get("secret").getAsString();
      long now = v.get("now").getAsLong();
      boolean valid = v.get("valid").getAsBoolean();
      assertEquals(valid, CalmLensServerClient.verifyWebhookSignature(v.get("body").getAsString(), signature, timestamp, secret, now, tolerance));
      assertEquals(valid, CalmLensServerClient.verifyWebhookSignature(body, signature, timestamp, secret, now, tolerance), "bytes");
      // A verified body that is not a delivery (such as "{}") fails parsing, never verification.
      try {
        CalmLensServerClient.parseWebhookEvent(body, signature, timestamp, secret, now, tolerance);
        assertTrue(valid);
      } catch (CalmLensException error) {
        assertEquals(valid ? ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD : ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE, error.getCode());
      }
    });
  }

  @TestFactory Stream<DynamicTest> webhookSignatureContracts() throws Exception {
    return cases(array("webhooks.json", "signatures"), v -> v.get("timestamp").getAsString(), v -> {
      String header = CalmLensServerClient.createWebhookSignatureHeader(v.get("secret").getAsString(), v.get("timestamp").getAsString(), v.get("body").getAsString());
      assertEquals(v.get("signature").getAsString(), header);
    });
  }

  @Test void deliveryHeadersMatchTheSignatureContract() throws Exception {
    JsonObject vector = array("webhooks.json", "signatures").get(0).getAsJsonObject();
    String timestamp = vector.get("timestamp").getAsString();
    assertEquals(Map.of("content-type", "application/json", CalmLensServerClient.WEBHOOK_DELIVERY_HEADER, "delivery-1",
            CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER, timestamp, CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER, vector.get("signature").getAsString()),
        CalmLensServerClient.createWebhookHeaders(vector.get("secret").getAsString(), vector.get("body").getAsString(), "delivery-1", Long.parseLong(timestamp)));
  }

  @TestFactory Stream<DynamicTest> futureWebhookFieldsAndTypesAreAccepted() throws Exception {
    return cases(array("webhooks.json", "parsing"), f -> f.get("expectedType").getAsString(), f -> {
      Models.WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(
          f.get("body").getAsString().getBytes(StandardCharsets.UTF_8), f.get("signature").getAsString(),
          f.get("timestamp").getAsString(), f.get("secret").getAsString(), f.get("now").getAsLong(), 300);
      assertEquals(f.get("expectedType").getAsString(), event.type());
      assertEquals(f.get("expectedFactKey").getAsString(), event.data().facts().get(0).key());
    });
  }

  /** CalmLens converts each stored event to the delivered payload the same way. */
  @TestFactory Stream<DynamicTest> webhookPayloadConversionContracts() throws Exception {
    return cases(array("webhooks.json", "payloads"), p -> p.getAsJsonObject("event").get("type").getAsString(), entry -> {
      Models.Event event = Json.GSON.fromJson(entry.get("event"), Models.Event.class);
      assertEquals(Json.GSON.fromJson(entry.get("payload"), Models.WebhookEventPayload.class), CalmLensServerClient.toWebhookEventPayload(event));
    });
  }

  @TestFactory Stream<DynamicTest> webhookPayloadParsingContracts() throws Exception {
    return cases(array("webhooks.json", "payloads"), p -> p.getAsJsonObject("event").get("type").getAsString(), item -> {
      JsonObject expected = item.getAsJsonObject("payload");
      JsonObject data = expected.getAsJsonObject("data");
      Models.WebhookEventPayload parsed = CalmLensServerClient.readWebhookEvent(expected.toString());
      assertEquals(expected.get("id").getAsString(), parsed.id());
      assertEquals(expected.get("type").getAsString(), parsed.type());
      assertEquals(Instant.ofEpochMilli(expected.get("createdAt").getAsLong()), parsed.createdAt());
      assertEquals(expected.get("projectId").getAsString(), parsed.projectId());
      assertEquals(data.get("severity").getAsString(), parsed.data().severity());
      assertEquals(data.get("title").getAsString(), parsed.data().title());
      assertEquals(data.get("description").isJsonNull() ? null : data.get("description").getAsString(), parsed.data().description());
      assertEquals(data.get("assetId").isJsonNull() ? null : data.get("assetId").getAsString(), parsed.data().assetId());
      if (data.get("asset").isJsonNull()) assertNull(parsed.data().asset());
      else assertEventAsset(data.getAsJsonObject("asset"), parsed.data().asset());
      assertEquals(data.get("facts"), Json.GSON.toJsonTree(parsed.data().facts()));
    });
  }

  private static String string(JsonObject object, String name) {
    JsonElement value = object.get(name);
    return value == null || value.isJsonNull() ? null : value.getAsString();
  }

  private static void assertEventAsset(JsonObject expected, Models.EventAsset asset) {
    assertEquals(string(expected, "id"), asset.id());
    assertEquals(string(expected, "externalId"), asset.externalId());
    assertEquals(string(expected.getAsJsonObject("classification"), "status"), asset.classification().status().value());
    assertEquals(string(expected.getAsJsonObject("classification").getAsJsonObject("moderation"), "status"), asset.classification().moderation().status().value());
    assertEquals(string(expected.getAsJsonObject("content"), "status"), asset.content().status().value());
  }

  // transform-options.json

  /** Every transform option, decoded into ImageTransformOptions and serialized, gives the step the CDN writes. */
  @TestFactory Stream<DynamicTest> transformOptionContracts() throws Exception {
    return cases(array("transform-options.json", "cases"), c -> c.get("selector").getAsString(), testCase -> {
      Models.ImageTransformOptions options = Json.GSON.fromJson(testCase.get("options"), Models.ImageTransformOptions.class);
      assertEquals(testCase.get("selector").getAsString(), CalmLensServerClient.serializeTransform(Models.Transform.image(options)));
    });
  }

  // mock-scenarios.json: replayed against MockCalmLensServerClient.

  /** Follows a dotted path: numeric segments index arrays, {@code length} is an array's length. */
  private static JsonElement at(JsonElement value, String path) {
    for (String segment : path.split("\\.")) {
      if (value == null || value.isJsonNull()) return JsonNull.INSTANCE;
      if (value.isJsonArray()) {
        JsonArray items = value.getAsJsonArray();
        value = segment.equals("length") ? new JsonPrimitive(items.size()) : items.get(Integer.parseInt(segment));
      } else if (value.isJsonObject()) {
        value = value.getAsJsonObject().get(segment);
      } else {
        return JsonNull.INSTANCE;
      }
    }
    return value == null ? JsonNull.INSTANCE : value;
  }

  private static JsonElement resolve(JsonElement value, Map<String, JsonElement> saved) {
    if (value.isJsonObject()) {
      JsonObject object = value.getAsJsonObject();
      if (object.has("$ref")) {
        String[] reference = object.get("$ref").getAsString().split("\\.", 2);
        return at(saved.get(reference[0]), reference[1]);
      }
      JsonObject resolved = new JsonObject();
      object.entrySet().forEach(entry -> resolved.add(entry.getKey(), resolve(entry.getValue(), saved)));
      return resolved;
    }
    if (value.isJsonArray()) {
      JsonArray resolved = new JsonArray();
      value.getAsJsonArray().forEach(item -> resolved.add(resolve(item, saved)));
      return resolved;
    }
    return value;
  }

  /** A missing value compares as JSON null; Gson compares numbers by value. */
  private static JsonElement normalize(JsonElement value) { return value == null ? JsonNull.INSTANCE : value; }

  private static Outcome outcome(JsonObject mock, String key, Outcome fallback) {
    if (!mock.has(key)) return fallback;
    String value = mock.get(key).getAsString();
    return Arrays.stream(Outcome.values()).filter(outcome -> outcome.value().equals(value)).findFirst().orElseThrow();
  }

  private static JsonElement tree(Object result) { return result == null ? JsonNull.INSTANCE : Json.GSON.toJsonTree(result); }

  private static JsonElement run(MockCalmLensServerClient mock, String operation, JsonObject args) throws Throwable {
    switch (operation) {
      case "mock.decide":
        return tree(mock.decide(args.get("assetId").getAsString(), outcome(args, "outcome", null)));
      case "mock.enqueueEvent": {
        List<Models.EventFact> facts = new ArrayList<>();
        for (JsonElement fact : args.getAsJsonArray("facts")) facts.add(Json.GSON.fromJson(fact, Models.EventFact.class));
        return tree(mock.enqueueEvent(args.get("type").getAsString(), args.get("assetId").getAsString(), facts.toArray(Models.EventFact[]::new)));
      }
      case "cdn.serve": {
        try (CdnResponse response = mock.client.cdn.serve(Fixtures.decode(args, Models.CdnRequest.class))) {
          String body = new String(response.readAllBytes(1_000_000), StandardCharsets.UTF_8);
          JsonObject result = new JsonObject();
          result.addProperty("status", response.status());
          String type = response.header("content-type");
          result.add("code", type != null && type.startsWith("application/json") ? JsonParser.parseString(body).getAsJsonObject().get("code") : JsonNull.INSTANCE);
          result.addProperty("body", body);
          // Header names are case-insensitive: keep them lowercase.
          JsonObject headers = new JsonObject();
          response.headers().forEach((key, values) -> headers.addProperty(key.toLowerCase(java.util.Locale.ROOT), String.join(", ", values)));
          result.add("headers", headers);
          return result;
        }
      }
      case "assets.waitForDecision":
        return tree(mock.client.assets.waitForDecision(new Models.WaitForDecision(args.get("assetId").getAsString())
            .timeout(Duration.ofMillis(args.get("timeoutMs").getAsLong()))));
      default:
        if (args.has("idempotencyKey")) {
          RequestOptions request = new RequestOptions().idempotencyKey(args.remove("idempotencyKey").getAsString());
          Models.SubmitAsset submit = Fixtures.decode(args, Models.SubmitAsset.class);
          return tree(operation.equals("assets.create") ? mock.client.assets.create(submit, request) : mock.client.assets.classify(submit, request));
        }
        return tree(Fixtures.invoke(mock.client, operation, args));
    }
  }

  private static void check(MockCalmLensServerClient mock, String scenario, JsonObject step, Map<String, JsonElement> saved) throws Throwable {
    String operation = step.get("operation").getAsString();
    String label = scenario + ": " + operation + " " + step.get("args");
    JsonObject args = step.has("args") ? resolve(step.get("args"), saved).getAsJsonObject() : new JsonObject();
    JsonObject expect = step.has("expect") ? step.getAsJsonObject("expect") : new JsonObject();
    if (expect.has("error")) {
      CalmLensException error = assertThrows(CalmLensException.class, () -> run(mock, operation, args), label);
      JsonObject actual = new JsonObject();
      actual.addProperty("code", error.getCode());
      actual.add("status", error.getStatus() == 0 ? JsonNull.INSTANCE : new JsonPrimitive(error.getStatus()));
      assertEquals(normalize(expect.get("error")), normalize(actual), label);
      return;
    }
    JsonElement result = run(mock, operation, args);
    if (expect.has("cdn"))
      for (Map.Entry<String, JsonElement> entry : expect.getAsJsonObject("cdn").entrySet()) {
        if (entry.getKey().equals("headers")) {
          JsonObject served = result.getAsJsonObject().getAsJsonObject("headers");
          for (Map.Entry<String, JsonElement> header : entry.getValue().getAsJsonObject().entrySet())
            assertEquals(header.getValue(), normalize(served.get(header.getKey().toLowerCase(java.util.Locale.ROOT))), label + ": cdn header " + header.getKey());
        } else {
          assertEquals(normalize(entry.getValue()), normalize(at(result, entry.getKey())), label + ": cdn " + entry.getKey());
        }
      }
    if (expect.has("sameAs")) {
      String name = expect.get("sameAs").getAsString();
      assertTrue(saved.containsKey(name), label + ": nothing saved as " + name);
      assertEquals(saved.get(name), result, label + ": same as " + name);
    }
    if (expect.has("result"))
      for (Map.Entry<String, JsonElement> entry : expect.getAsJsonObject("result").entrySet()) {
        JsonElement raw = entry.getValue(), actual = at(result, entry.getKey());
        if (raw.isJsonObject() && raw.getAsJsonObject().has("$contains")) {
          JsonElement member = normalize(resolve(raw.getAsJsonObject().get("$contains"), saved));
          assertTrue(actual.isJsonArray(), label + ": " + entry.getKey() + " is not an array");
          boolean found = false;
          for (JsonElement item : actual.getAsJsonArray()) found |= normalize(item).equals(member);
          assertTrue(found, label + ": " + entry.getKey() + " " + actual + " lacks " + member);
        } else {
          assertEquals(normalize(resolve(raw, saved)), normalize(actual), label + ": " + entry.getKey());
        }
      }
    if (step.has("save")) saved.put(step.get("save").getAsString(), result);
  }

  @TestFactory Stream<DynamicTest> mockScenarios() throws Exception {
    return cases(array("mock-scenarios.json", "scenarios"), s -> s.get("name").getAsString(), scenario -> {
      String name = scenario.get("name").getAsString();
      JsonObject options = scenario.getAsJsonObject("mock");
      List<Grant> grants = new ArrayList<>();
      if (options.has("apiKeyGrants"))
        for (JsonElement grant : options.getAsJsonArray("apiKeyGrants")) {
          JsonObject g = grant.getAsJsonObject();
          List<String> actions = new ArrayList<>();
          g.getAsJsonArray("actions").forEach(action -> actions.add(action.getAsString()));
          grants.add(new Grant(actions, g.get("folderId").isJsonNull() ? null : g.get("folderId").getAsString(), g.get("includeSubfolders").getAsBoolean()));
        }
      MockCalmLensServerClient mock = new MockCalmLensServerClient(
          CalmLensServerClient.builder(MockCalmLensServerClient.createMockApiKey(grants.toArray(Grant[]::new)), "project-1")
              .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1").maxRetries(0),
          new Options().queuedOutcome(outcome(options, "queuedOutcome", Outcome.PENDING))
              .analyzedOutcome(outcome(options, "analyzedOutcome", Outcome.ALLOWED)));
      Map<String, JsonElement> saved = new HashMap<>();
      long started = System.nanoTime();
      for (JsonElement step : scenario.getAsJsonArray("steps")) check(mock, name, step.getAsJsonObject(), saved);
      // Mock waits take no real time.
      assertTrue(System.nanoTime() - started < Duration.ofSeconds(5).toNanos());
    });
  }

  // surface.json: every capability a server SDK must offer exists under its Java name.

  private static CalmLensServerClient refusing() {
    return CalmLensServerClient.builder("key", "project-1").maxRetries(0).transport(request -> fail("Sent " + request.uri())).build();
  }

  /** A class of the SDK by its simple name, including nested model and mock classes. */
  private static Class<?> sdkClass(String name) {
    for (String candidate : List.of("com.calmlens." + name, "com.calmlens.Models$" + name, "com.calmlens.MockCalmLensServerClient$" + name)) {
      try {
        return Class.forName(candidate);
      } catch (ClassNotFoundException next) {
        // try the next location
      }
    }
    return null;
  }

  private static boolean hasMethod(Class<?> type, String name, boolean isStatic) {
    return type != null && Arrays.stream(type.getMethods())
        .anyMatch(m -> m.getName().equals(name) && Modifier.isStatic(m.getModifiers()) == isStatic);
  }

  private static Object constant(String name) {
    int dot = name.lastIndexOf('.');
    Class<?> type = sdkClass(name.substring(0, dot));
    try {
      Field field = type == null ? null : type.getField(name.substring(dot + 1));
      return field != null && Modifier.isStatic(field.getModifiers()) ? field.get(null) : null;
    } catch (ReflectiveOperationException missing) {
      return null;
    }
  }

  private static CalmLensException raisedError(JsonObject spec) {
    CalmLensServerClient failing = CalmLensServerClient.builder("key", "project-1").maxRetries(0).transport(request -> {
      Map<String, List<String>> headers = new HashMap<>();
      spec.getAsJsonObject("headers").entrySet().forEach(e -> headers.put(e.getKey(), List.of(e.getValue().getAsString())));
      return new Transport.Response(spec.get("status").getAsInt(), headers, spec.get("body").toString().getBytes(StandardCharsets.UTF_8));
    }).build();
    return assertThrows(CalmLensException.class,
        () -> Fixtures.invoke(failing, spec.get("operation").getAsString(), spec.getAsJsonObject("options")));
  }

  private static boolean present(JsonObject capability, JsonObject surface) throws Exception {
    String name = capability.getAsJsonObject("names").get("java").getAsString();
    String value = capability.has("value") ? capability.get("value").getAsString() : null;
    switch (capability.get("kind").getAsString()) {
      case "method": {
        String[] parts = name.split("\\.");
        Class<?> target = CalmLensServerClient.class;
        if (parts.length == 2) {
          try {
            target = CalmLensServerClient.class.getField(parts[0]).getType();
          } catch (NoSuchFieldException missing) {
            return false;
          }
        }
        return hasMethod(target, parts[parts.length - 1], false);
      }
      case "function":
      case "mock-function": {
        int dot = name.lastIndexOf('.');
        return hasMethod(sdkClass(name.substring(0, dot)), name.substring(dot + 1), true);
      }
      case "constant":
        return value.equals(constant(name));
      case "error-field": {
        JsonObject spec = surface.getAsJsonObject("errorResponse");
        JsonObject expected = spec.getAsJsonObject("expected");
        Object want = switch (capability.get("id").getAsString()) {
          case "errors.code" -> expected.get("code").getAsString();
          case "errors.status" -> expected.get("status").getAsInt();
          case "errors.requestId" -> expected.get("requestId").getAsString();
          case "errors.retryAfter" -> Optional.of(Duration.ofSeconds(expected.get("retryAfterSeconds").getAsLong()));
          default -> throw new AssertionError(capability);
        };
        CalmLensException error = raisedError(spec);
        Method accessor;
        try {
          accessor = error.getClass().getMethod(name);
        } catch (NoSuchMethodException missing) {
          return false;
        }
        return want.equals(accessor.invoke(error));
      }
      case "cdn-resource":
        return refusing().cdn.getAssetUrl(new Models.CdnRequest("asset-1").resource(name)).endsWith("/asset-1/" + value);
      case "cdn-option":
      case "mock-option": {
        int dot = name.lastIndexOf('.');
        return hasMethod(sdkClass(name.substring(0, dot)), name.substring(dot + 1), false);
      }
      case "mock-client":
        return sdkClass(name) != null;
      case "mock-method":
        return hasMethod(MockCalmLensServerClient.class, name, false);
      default:
        throw new AssertionError("Unknown capability kind " + capability);
    }
  }

  @TestFactory Stream<DynamicTest> offersEveryCapability() throws Exception {
    JsonObject surface = Fixtures.read("surface.json").getAsJsonObject();
    return cases(surface.getAsJsonArray("capabilities"), c -> c.get("id").getAsString(), capability ->
        assertTrue(present(capability, surface), capability.getAsJsonObject("names").get("java").getAsString()));
  }

  // rejections.json: every request the API would reject is refused before anything is sent.

  /** Fixture options a Java type cannot hold, so the type already refuses the request. */
  private static final Map<String, String> REJECTED_BY_TYPE = Map.of(
      "signed URL lifetime of a fraction of a second", "SignedUrlOptions.expiresInSeconds is a Long");

  @TestFactory Stream<DynamicTest> refusesRejectedRequestsBeforeSending() throws Exception {
    CalmLensServerClient client = refusing();
    return cases(array("rejections.json"), r -> r.get("name").getAsString(), rejection -> {
      String name = rejection.get("name").getAsString();
      JsonObject options = rejection.getAsJsonObject("options");
      if (REJECTED_BY_TYPE.containsKey(name)) {
        // The typed options cannot hold the fixture's value: it does not survive decoding.
        JsonObject typed = Models.encode(Fixtures.decode(options, Models.SignedUrlOptions.class));
        assertNotEquals(options, typed, REJECTED_BY_TYPE.get(name));
        return;
      }
      Throwable failure = assertThrows(Throwable.class, () -> Fixtures.invoke(client, rejection.get("operation").getAsString(), options));
      assertInstanceOf(CalmLensException.class, failure);
      assertEquals(rejection.get("error").getAsString(), ((CalmLensException) failure).getCode());
    });
  }
}
