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
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.function.ThrowingConsumer;

/**
 * Replays the shared SDK contract fixtures in {@code testdata/} (packages/sdk-contract/README.md):
 * requests, paths, webhooks, errors, upload tokens, transform options, mock behaviour scenarios,
 * the capability surface (its capabilities, errorResponse and retryable errors) and refused
 * requests. {@link ClientCasesTest} replays the client cases and surface.json's defaults; each
 * fixture is replayed in one of the two, read through {@link Fixtures#read}. Each fixture case is
 * its own dynamic test.
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

  /**
   * Each request fixture sends the recorded request and returns the response: nothing for deletes,
   * the lenses for {@code ensureLenses}, the typed body otherwise. Typed results omit unset fields,
   * so both sides are compared without null members.
   */
  @TestFactory Stream<DynamicTest> requestContracts() throws Exception {
    return cases(array("requests.json"), f -> f.get("operation").getAsString(), fixture -> {
      JsonObject[] captured = {null};
      CalmLensServerClient client = client(request -> {
        assertEquals("key", request.headers().get("X-Api-Key"));
        captured[0] = Fixtures.describe(request.method(), request.uri(), request.headers(), Fixtures.body(request));
        return Fixtures.json(200, fixture.get("response").toString());
      });
      String operation = fixture.get("operation").getAsString();
      Object result = Fixtures.invoke(client, operation, fixture.getAsJsonObject("options"));
      assertEquals(fixture.get("request"), captured[0]);
      JsonElement response = fixture.get("response");
      JsonElement expected = operation.endsWith(".delete") || operation.equals("hashLists.removeEntry") ? JsonNull.INSTANCE
          : operation.equals("ensureLenses") ? response.getAsJsonObject().get("lenses") : response;
      assertEquals(Fixtures.withoutNulls(expected), Fixtures.withoutNulls(tree(result)), "result");
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

  /** Each API error code, answered to a real call (retries off), becomes a typed error with every field. */
  @TestFactory Stream<DynamicTest> eachErrorCodeBecomesATypedError() throws Exception {
    return cases(array("errors.json"), e -> e.get("code").getAsString(), entry -> {
      JsonObject response = entry.getAsJsonObject("response");
      CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").maxRetries(0).transport(request -> {
        Map<String, List<String>> headers = new HashMap<>();
        response.getAsJsonObject("headers").entrySet().forEach(h -> headers.put(h.getKey(), List.of(h.getValue().getAsString())));
        return new Transport.Response(response.get("status").getAsInt(), headers, response.get("body").toString().getBytes(StandardCharsets.UTF_8));
      }).build();
      CalmLensException error = assertThrows(CalmLensException.class,
          () -> Fixtures.invoke(client, entry.get("operation").getAsString(), entry.getAsJsonObject("args")));
      assertEquals(entry.get("expected"), Fixtures.errorFields(error));
    });
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
      assertEquals(f.get("expectedFactKey").getAsString(), event.facts().get(0).key());
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
      Models.WebhookEventPayload parsed = CalmLensServerClient.readWebhookEvent(expected.toString());
      assertEquals(expected.get("id").getAsString(), parsed.id());
      assertEquals(expected.get("projectId").getAsString(), parsed.projectId());
      assertEquals(expected.get("type").getAsString(), parsed.type());
      assertEquals(expected.get("severity").getAsString(), parsed.severity());
      assertEquals(expected.get("title").getAsString(), parsed.title());
      assertEquals(string(expected, "description"), parsed.description());
      assertEquals(string(expected, "assetId"), parsed.assetId());
      if (expected.get("asset").isJsonNull()) assertNull(parsed.asset());
      else assertEventAsset(expected.getAsJsonObject("asset"), parsed.asset());
      assertEquals(expected.get("facts"), Json.GSON.toJsonTree(parsed.facts()));
      assertEquals(Instant.ofEpochMilli(expected.get("createdAt").getAsLong()), parsed.createdAt());
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

  /** The header containers a Java receiver gets: values as given (strings or lists), and every value as a list. */
  private static Map<String, Map<String, ?>> headerContainers(JsonObject headers) {
    Map<String, Object> given = new HashMap<>();
    Map<String, List<String>> lists = new HashMap<>();
    headers.entrySet().forEach(entry -> {
      List<String> values = new ArrayList<>();
      if (entry.getValue().isJsonArray()) entry.getValue().getAsJsonArray().forEach(v -> values.add(v.getAsString()));
      else values.add(entry.getValue().getAsString());
      given.put(entry.getKey(), entry.getValue().isJsonArray() ? values : values.get(0));
      lists.put(entry.getKey(), values);
    });
    return Map.of("strings and lists", given, "lists", lists);
  }

  @TestFactory Stream<DynamicTest> webhookHeaderCases() throws Exception {
    return cases(array("webhooks.json", "headerCases"), c -> c.get("name").getAsString(), c -> {
      for (var container : headerContainers(c.getAsJsonObject("headers")).entrySet()) {
        boolean valid = c.get("valid").getAsBoolean();
        byte[] body = c.get("body").getAsString().getBytes(StandardCharsets.UTF_8);
        assertEquals(valid, CalmLensServerClient.verifyWebhookRequest(container.getValue(), body, c.get("secret").getAsString(),
            c.get("now").getAsLong(), CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS), container.getKey());
      }
    });
  }

  @TestFactory Stream<DynamicTest> webhookParseErrors() throws Exception {
    return cases(array("webhooks.json", "parseErrors"), c -> c.get("name").getAsString(), c -> {
      CalmLensException error = assertThrows(CalmLensException.class, () -> CalmLensServerClient.parseWebhookEvent(
          c.get("body").getAsString().getBytes(StandardCharsets.UTF_8), c.get("signature").getAsString(), c.get("timestamp").getAsString(),
          c.get("secret").getAsString(), c.get("now").getAsLong(), CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS));
      assertEquals(c.get("error").getAsString(), error.getCode());
    });
  }

  /** A parsed delivery equals the body as a whole, unknown fields included, and knows whether it is a test send. */
  @TestFactory Stream<DynamicTest> webhookParsedEvents() throws Exception {
    return cases(array("webhooks.json", "parsed"), c -> c.get("name").getAsString(), c -> {
      Models.WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(
          c.get("body").getAsString().getBytes(StandardCharsets.UTF_8), c.get("signature").getAsString(), c.get("timestamp").getAsString(),
          c.get("secret").getAsString(), c.get("now").getAsLong(), CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
      assertEquals(c.get("expected"), tree(event));
      assertEquals(c.get("isTest").getAsBoolean(), CalmLensServerClient.isTestWebhookEvent(event));
    });
  }

  @TestFactory Stream<DynamicTest> webhookTestFacts() throws Exception {
    return cases(array("webhooks.json", "testFacts"), c -> c.get("name").getAsString(), c ->
        assertEquals(c.get("isTest").getAsBoolean(), CalmLensServerClient.isTestWebhookEvent(Json.GSON.fromJson(c.get("event"), Models.WebhookEventPayload.class))));
  }

  /** An event becomes its delivery body, is signed into delivery headers, and parses back from them. */
  @TestFactory Stream<DynamicTest> webhookRoundTrips() throws Exception {
    return cases(array("webhooks.json", "roundTrips"), c -> c.get("name").getAsString(), c -> {
      Models.WebhookEventPayload payload = CalmLensServerClient.toWebhookEventPayload(Json.GSON.fromJson(c.get("event"), Models.Event.class));
      assertEquals(c.get("payload"), tree(payload));
      String body = c.get("body").getAsString();
      assertEquals(body, Json.GSON.toJson(payload));
      Map<String, String> headers = CalmLensServerClient.createWebhookHeaders(c.get("secret").getAsString(), body,
          c.get("deliveryId").getAsString(), c.get("timestampSeconds").getAsLong());
      assertEquals(Json.GSON.fromJson(c.get("headers"), new com.google.gson.reflect.TypeToken<Map<String, String>>() {}.getType()), headers);
      Models.WebhookEventPayload received = CalmLensServerClient.parseWebhookRequest(headers, body.getBytes(StandardCharsets.UTF_8),
          c.get("secret").getAsString(), c.get("timestampSeconds").getAsLong(), CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
      assertEquals(c.get("payload"), tree(received));
      assertEquals(payload, received);
      assertEquals(c.get("isTest").getAsBoolean(), CalmLensServerClient.isTestWebhookEvent(received));
    });
  }

  /** The overloads without {@code now} use the system clock; webhooks.json covers the rules at fixed times. */
  @Test void webhookHelpersWithoutANowUseTheSystemClock() throws Exception {
    JsonObject payload = array("webhooks.json", "payloads").get(0).getAsJsonObject().getAsJsonObject("payload");
    byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
    String now = Long.toString(System.currentTimeMillis() / 1000);
    String header = CalmLensServerClient.createWebhookSignatureHeader("whsec", now, body);
    assertEquals(payload.get("id").getAsString(), CalmLensServerClient.parseWebhookEvent(body, header, now, "whsec").id());
    assertEquals(payload.get("id").getAsString(), CalmLensServerClient.parseWebhookRequest(
        Map.of(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER, header, CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER, now), body, "whsec").id());
    String stale = Long.toString(System.currentTimeMillis() / 1000 - CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 5);
    assertFalse(CalmLensServerClient.verifyWebhookRequest(Map.of(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER,
        CalmLensServerClient.createWebhookSignatureHeader("whsec", stale, body), CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER, stale), body, "whsec"));
  }

  // upload-tokens.json

  /** Options a Java type cannot hold, so the type already refuses them. */
  private static final Map<String, String> TOKEN_OPTIONS_REJECTED_BY_TYPE = Map.of(
      "fractional lifetime", "SignUploadToken.expiresInSeconds is an Integer");

  private static Models.SignUploadToken tokenOptions(JsonObject options) {
    Models.SignUploadToken typed = new Models.SignUploadToken(options.get("uploadPresetId").getAsString());
    if (options.has("externalId")) typed.externalId(options.get("externalId").getAsString());
    if (options.has("expiresInSeconds")) typed.expiresInSeconds(options.get("expiresInSeconds").getAsInt());
    return typed;
  }

  private static JsonObject tokenClaims(String token) {
    String body = token.substring("clut_".length(), token.indexOf('.'));
    return JsonParser.parseString(new String(java.util.Base64.getUrlDecoder().decode(body), StandardCharsets.UTF_8)).getAsJsonObject();
  }

  private static String hmacHex(String key, String message) throws Exception {
    javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
    mac.init(new javax.crypto.spec.SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return java.util.HexFormat.of().formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
  }

  @TestFactory Stream<DynamicTest> uploadTokensSignExactly() throws Exception {
    return cases(array("upload-tokens.json", "signing"), c -> c.get("name").getAsString(), c -> {
      JsonObject expected = c.getAsJsonObject("expected");
      Models.SignedUploadToken signed = MockCalmLensServerClient.signUploadToken(c.get("apiKey").getAsString(),
          tokenOptions(c.getAsJsonObject("options")), c.get("now").getAsLong(), c.get("nonce").getAsString());
      assertEquals(new Models.SignedUploadToken(expected.get("token").getAsString(), expected.get("expiresAt").getAsLong()), signed);
    });
  }

  @TestFactory Stream<DynamicTest> uploadTokensSignWithTheClientsClockAndAFreshNonce() throws Exception {
    JsonObject fixture = Fixtures.read("upload-tokens.json").getAsJsonObject();
    String context = fixture.get("signingContext").getAsString();
    return cases(fixture.getAsJsonArray("signing"), c -> c.get("name").getAsString(), c -> {
      JsonObject expected = c.getAsJsonObject("expected");
      CalmLensServerClient client = CalmLensServerClient.builder(c.get("apiKey").getAsString(), "project-1").build();
      long before = System.currentTimeMillis();
      Models.SignedUploadToken signed = client.uploadTokens.sign(tokenOptions(c.getAsJsonObject("options")));
      long after = System.currentTimeMillis();
      JsonObject claims = tokenClaims(signed.token());
      JsonObject want = expected.getAsJsonObject("claims").deepCopy();
      want.addProperty("e", signed.expiresAt());
      want.add("n", claims.get("n"));
      assertEquals(want, claims);
      assertNotEquals(c.get("nonce").getAsString(), claims.get("n").getAsString());
      long lifetime = expected.get("expiresAt").getAsLong() - c.get("now").getAsLong();
      assertTrue(signed.expiresAt() - before >= lifetime && signed.expiresAt() - after <= lifetime, "expiry within the lifetime");
      String body = signed.token().substring("clut_".length(), signed.token().indexOf('.'));
      assertEquals(hmacHex(expected.get("signingSecret").getAsString(), context + body), signed.token().substring(signed.token().indexOf('.') + 1));
    });
  }

  @TestFactory Stream<DynamicTest> uploadTokensRefuseInvalidOptions() throws Exception {
    return cases(array("upload-tokens.json", "rejections"), c -> c.get("name").getAsString(), c -> {
      String name = c.get("name").getAsString();
      JsonObject options = c.getAsJsonObject("options");
      if (TOKEN_OPTIONS_REJECTED_BY_TYPE.containsKey(name)) {
        // The typed option cannot hold the fixture's value.
        assertThrows(NumberFormatException.class, () -> Integer.parseInt(options.get("expiresInSeconds").getAsString()), TOKEN_OPTIONS_REJECTED_BY_TYPE.get(name));
        return;
      }
      String apiKey = c.get("apiKey").getAsString();
      CalmLensServerClient client = CalmLensServerClient.builder(apiKey, "project-1").transport(request -> fail("Sent " + request.uri())).build();
      assertEquals(c.get("error").getAsString(), assertThrows(CalmLensException.class, () -> client.uploadTokens.sign(tokenOptions(options))).getCode());
      assertEquals(c.get("error").getAsString(), assertThrows(CalmLensException.class,
          () -> MockCalmLensServerClient.signUploadToken(apiKey, tokenOptions(options), 0, "n")).getCode());
    });
  }

  /** The server's verification rules: a well-formed token decodes and its signature verifies with the key's hash. */
  @TestFactory Stream<DynamicTest> uploadTokensDecodeAndVerify() throws Exception {
    JsonObject fixture = Fixtures.read("upload-tokens.json").getAsJsonObject();
    String context = fixture.get("signingContext").getAsString(), prefix = fixture.get("prefix").getAsString();
    return cases(fixture.getAsJsonArray("verification"), c -> c.get("name").getAsString(), c -> {
      String token = c.get("token").getAsString();
      boolean verified = false;
      int dot = token.indexOf('.');
      if (token.startsWith(prefix) && dot > prefix.length() && token.indexOf('.', dot + 1) < 0) {
        String body = token.substring(prefix.length(), dot), signature = token.substring(dot + 1);
        String secret = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(c.get("apiKey").getAsString().getBytes(StandardCharsets.UTF_8)));
        try {
          JsonElement claims = JsonParser.parseString(new String(java.util.Base64.getUrlDecoder().decode(body), StandardCharsets.UTF_8));
          // Version 1 claims: the preset, key prefix, integer expiry and nonce, and an optional external ID.
          boolean wellFormed = claims instanceof JsonObject decoded && decoded.get("v") instanceof JsonPrimitive v && v.isNumber() && v.getAsDouble() == 1
              && decoded.get("u") instanceof JsonPrimitive u && u.isString() && decoded.get("k") instanceof JsonPrimitive k && k.isString()
              && decoded.get("e") instanceof JsonPrimitive e && e.isNumber() && e.getAsDouble() == Math.floor(e.getAsDouble())
              && decoded.get("n") instanceof JsonPrimitive n && n.isString() && (!decoded.has("x") || decoded.get("x") instanceof JsonPrimitive x && x.isString());
          verified = wellFormed && signature.equals(hmacHex(secret, context + body));
        } catch (RuntimeException malformed) {
          verified = false;
        }
      }
      assertEquals(c.get("decodesAndVerifies").getAsBoolean(), verified);
    });
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

  /** Resolves {@code $ref}, {@code $concat} and {@code $base64Repeat} markers (packages/sdk-contract/README.md). */
  static JsonElement resolve(JsonElement value, Map<String, JsonElement> saved) {
    if (value.isJsonObject()) {
      JsonObject object = value.getAsJsonObject();
      if (object.has("$ref")) {
        String[] reference = object.get("$ref").getAsString().split("\\.", 2);
        JsonElement root = saved.get(reference[0]);
        return reference.length == 1 ? normalize(root) : at(root, reference[1]);
      }
      if (object.has("$concat")) {
        StringBuilder joined = new StringBuilder();
        for (JsonElement part : object.getAsJsonArray("$concat")) joined.append(resolve(part, saved).getAsString());
        return new JsonPrimitive(joined.toString());
      }
      if (object.has("$base64Repeat")) {
        JsonObject repeat = object.getAsJsonObject("$base64Repeat");
        String text = repeat.get("text").getAsString().repeat(repeat.get("count").getAsInt());
        return new JsonPrimitive(java.util.Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)));
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
  static JsonElement normalize(JsonElement value) { return value == null ? JsonNull.INSTANCE : value; }

  private static Outcome outcome(JsonObject mock, String key, Outcome fallback) {
    if (!mock.has(key)) return fallback;
    String value = mock.get(key).getAsString();
    return Arrays.stream(Outcome.values()).filter(outcome -> outcome.value().equals(value)).findFirst().orElseThrow();
  }

  static JsonElement tree(Object result) { return result == null ? JsonNull.INSTANCE : Json.GSON.toJsonTree(result); }

  /** Every item an iterable yields, as JSON. */
  static JsonArray collect(Iterable<?> items) {
    JsonArray all = new JsonArray();
    for (Object item : items) all.add(tree(item));
    return all;
  }

  private static Grant[] grants(JsonArray list) {
    List<Grant> grants = new ArrayList<>();
    for (JsonElement grant : list) {
      JsonObject g = grant.getAsJsonObject();
      List<String> actions = new ArrayList<>();
      g.getAsJsonArray("actions").forEach(action -> actions.add(action.getAsString()));
      grants.add(new Grant(actions, g.get("folderId").isJsonNull() ? null : g.get("folderId").getAsString(), g.get("includeSubfolders").getAsBoolean()));
    }
    return grants.toArray(Grant[]::new);
  }

  private static JsonElement run(MockCalmLensServerClient mock, String operation, JsonObject args) throws Throwable {
    switch (operation) {
      case "mock.decide":
        return tree(mock.decide(args.get("assetId").getAsString(), outcome(args, "outcome", null)));
      case "mock.enqueueEvent": {
        List<Models.EventFact> facts = new ArrayList<>();
        for (JsonElement fact : args.getAsJsonArray("facts")) facts.add(Json.GSON.fromJson(fact, Models.EventFact.class));
        String assetId = args.has("assetId") && !args.get("assetId").isJsonNull() ? args.get("assetId").getAsString() : null;
        return tree(mock.enqueueEvent(args.get("type").getAsString(), assetId, facts.toArray(Models.EventFact[]::new)));
      }
      case "mock.grant":
        mock.setApiKeyGrants(grants(args.getAsJsonArray("grants")));
        return JsonNull.INSTANCE;
      case "mock.failNext":
        mock.failNextRequest(args.get("failure").getAsString(), args.has("operation") ? args.get("operation").getAsString() : null);
        return JsonNull.INSTANCE;
      case "cdn.serve": {
        try (CdnResponse response = mock.client.cdn.serve(Fixtures.decode(args, Models.CdnRequest.class))) {
          byte[] bytes = response.readAllBytes(100_000_000);
          String body = new String(bytes, StandardCharsets.UTF_8);
          JsonObject result = new JsonObject();
          result.addProperty("status", response.status());
          String type = response.header("content-type");
          result.add("code", type != null && type.startsWith("application/json") ? JsonParser.parseString(body).getAsJsonObject().get("code") : JsonNull.INSTANCE);
          result.addProperty("body", body);
          result.addProperty("bodyBase64", java.util.Base64.getEncoder().encodeToString(bytes));
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
      case "assets.iterate":
        return collect(mock.client.assets.iterate(Fixtures.decode(args, Models.ListAssets.class)));
      case "assets.iterateChildren":
        return collect(mock.client.assets.iterateChildren(Fixtures.decode(args, Models.ListChildren.class)));
      case "events.pages":
        return collect(mock.client.events.pages(Fixtures.decode(args, Models.ListEvents.class)));
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
      JsonObject wanted = expect.getAsJsonObject("error");
      JsonObject actual = new JsonObject();
      actual.addProperty("code", error.getCode());
      actual.add("status", error.getStatus() == 0 ? JsonNull.INSTANCE : new JsonPrimitive(error.getStatus()));
      JsonObject want = new JsonObject();
      want.add("code", wanted.get("code"));
      want.add("status", wanted.get("status"));
      assertEquals(want, actual, label);
      // `details` lists only the keys to compare.
      if (wanted.has("details")) {
        JsonObject details = Json.GSON.toJsonTree(error.getDetails()).getAsJsonObject();
        for (Map.Entry<String, JsonElement> detail : wanted.getAsJsonObject("details").entrySet())
          assertEquals(normalize(resolve(detail.getValue(), saved)), normalize(details.get(detail.getKey())), label + ": details." + detail.getKey());
      }
      return;
    }
    synchronized (mock) {
      mock.lastStatus = null;
    }
    JsonElement result = run(mock, operation, args);
    if (expect.has("httpStatus")) {
      Integer status;
      synchronized (mock) {
        status = mock.lastStatus;
      }
      assertEquals(Integer.valueOf(expect.get("httpStatus").getAsInt()), status, label + ": final response status");
    }
    if (expect.has("cdn")) {
      JsonObject cdn = resolve(expect.get("cdn"), saved).getAsJsonObject();
      JsonObject served = result.getAsJsonObject().getAsJsonObject("headers");
      for (Map.Entry<String, JsonElement> entry : cdn.entrySet()) {
        switch (entry.getKey()) {
          case "headers" -> {
            for (Map.Entry<String, JsonElement> header : entry.getValue().getAsJsonObject().entrySet())
              assertEquals(header.getValue(), normalize(served.get(header.getKey().toLowerCase(java.util.Locale.ROOT))), label + ": cdn header " + header.getKey());
          }
          case "headersPresent" -> entry.getValue().getAsJsonArray().forEach(name ->
              assertTrue(served.has(name.getAsString().toLowerCase(java.util.Locale.ROOT)), label + ": cdn header " + name.getAsString() + " is present"));
          case "bodyPrefixBase64" -> {
            byte[] prefix = java.util.Base64.getDecoder().decode(entry.getValue().getAsString());
            byte[] body = java.util.Base64.getDecoder().decode(result.getAsJsonObject().get("bodyBase64").getAsString());
            assertArrayEquals(prefix, Arrays.copyOf(body, Math.min(prefix.length, body.length)), label + ": cdn body prefix");
          }
          default -> assertEquals(normalize(entry.getValue()), normalize(at(result, entry.getKey())), label + ": cdn " + entry.getKey());
        }
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
        } else if (raw.isJsonObject() && raw.getAsJsonObject().has("$id")) {
          String prefix = raw.getAsJsonObject().get("$id").getAsString();
          assertTrue(actual != null && actual.isJsonPrimitive() && actual.getAsString().matches(prefix + "_[0-9A-Za-z]{20}"),
              label + ": " + entry.getKey() + " " + actual + " is not a " + prefix + "_ ID");
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
      Grant[] grants = options.has("apiKeyGrants") ? grants(options.getAsJsonArray("apiKeyGrants")) : new Grant[0];
      MockCalmLensServerClient mock = new MockCalmLensServerClient(
          CalmLensServerClient.builder(MockCalmLensServerClient.createMockApiKey(grants), "project-1")
              .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1").maxRetries(0),
          new Options().queuedOutcome(outcome(options, "queuedOutcome", Outcome.PENDING))
              .analyzedOutcome(outcome(options, "analyzedOutcome", Outcome.ALLOWED)));
      Map<String, JsonElement> saved = new HashMap<>();
      long started = System.nanoTime();
      for (JsonElement step : scenario.getAsJsonArray("steps")) {
        int runs = step.getAsJsonObject().has("repeat") ? step.getAsJsonObject().get("repeat").getAsInt() : 1;
        for (int run = 0; run < runs; run++) check(mock, name, step.getAsJsonObject(), saved);
      }
      // Mock waits take no real time.
      assertTrue(System.nanoTime() - started < Duration.ofSeconds(5).toNanos());
    });
  }

  // surface.json retryable: whether an error is retryable follows from its code and status alone.

  @TestFactory Stream<DynamicTest> retryableFollowsTheCodeAndStatus() throws Exception {
    return cases(array("surface.json", "retryable"), r -> r.get("code").getAsString() + " " + r.get("status"), entry -> {
      String code = entry.get("code").getAsString();
      boolean expected = entry.get("retryable").getAsBoolean();
      List<CalmLensException> errors = new ArrayList<>();
      if (entry.get("status").isJsonNull()) {
        errors.add(new CalmLensException(code, null));
        // The classes the client raises for failures without a response.
        if (code.equals(ErrorCodes.SDK_TRANSPORT_ERROR)) errors.add(new TransportException(code, null, null));
        if (code.equals(ErrorCodes.SDK_TIMEOUT)) errors.add(new RequestTimeoutException(null, null));
      } else {
        errors.add(new ApiException(code, null, null, entry.get("status").getAsInt(), Map.of(), null));
      }
      for (CalmLensException error : errors) assertEquals(expected, error.isRetryable(), error.getClass().getSimpleName());
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

  /** Why a capability does not apply to Java, from surface.json, or null when it does. */
  static String notApplicable(JsonObject capability) {
    JsonElement reasons = capability.get("notApplicable");
    return reasons != null && reasons.isJsonObject() && reasons.getAsJsonObject().has("java")
        ? reasons.getAsJsonObject().get("java").getAsString() : null;
  }

  @TestFactory Stream<DynamicTest> offersEveryCapability() throws Exception {
    JsonObject surface = Fixtures.read("surface.json").getAsJsonObject();
    return cases(surface.getAsJsonArray("capabilities"), c -> c.get("id").getAsString(), capability -> {
      String reason = notApplicable(capability);
      if (reason != null) {
        System.out.println("Skipping " + capability.get("id").getAsString() + " (not applicable: " + reason + ")");
        Assumptions.abort("not applicable: " + reason);
      }
      assertTrue(present(capability, surface), capability.getAsJsonObject("names").get("java").getAsString());
    });
  }

  // rejections.json: every request the API would reject is refused before anything is sent.

  /** Fixture options a Java type cannot hold, so the type already refuses the request. */
  private static final Map<String, String> REJECTED_BY_TYPE = Map.of(
      "signed URL lifetime of a fraction of a second", "SignedUrlOptions.expiresInSeconds is a Long",
      "batch with an unknown operation", "BatchAssets.operation is an AssetBatchOperation enum");
  private static final Map<String, Class<?>> REJECTED_TYPES = Map.of(
      "signed URL lifetime of a fraction of a second", Models.SignedUrlOptions.class,
      "batch with an unknown operation", Models.BatchAssets.class);

  @TestFactory Stream<DynamicTest> refusesRejectedRequestsBeforeSending() throws Exception {
    CalmLensServerClient client = refusing();
    return cases(array("rejections.json"), r -> r.get("name").getAsString(), rejection -> {
      String name = rejection.get("name").getAsString();
      JsonObject options = rejection.getAsJsonObject("options");
      if (REJECTED_BY_TYPE.containsKey(name)) {
        // The typed options cannot hold the fixture's value: it does not survive decoding.
        JsonObject typed = Models.encode(Fixtures.decode(options, REJECTED_TYPES.get(name)));
        assertNotEquals(options, typed, REJECTED_BY_TYPE.get(name));
        return;
      }
      Throwable failure = assertThrows(Throwable.class, () -> Fixtures.invoke(client, rejection.get("operation").getAsString(), options));
      assertInstanceOf(CalmLensException.class, failure);
      assertEquals(rejection.get("error").getAsString(), ((CalmLensException) failure).getCode());
    });
  }
}
