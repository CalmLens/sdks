package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.*;
import com.calmlens.internal.Json;
import com.calmlens.models.*;
import com.calmlens.params.*;
import com.calmlens.testing.*;

import com.calmlens.testing.MockCalmLensServerClient.Grant;
import com.calmlens.testing.MockCalmLensServerClient.Options;
import com.calmlens.testing.MockCalmLensServerClient.Outcome;
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
 * the capability surface (its capabilities, errorResponse and retryable errors), refused requests
 * and the declared types ({@code types.json}, compared by {@link DeclaredTypes}). {@link ClientCasesTest} replays the client cases and surface.json's defaults; each
 * fixture is replayed in one of the two, read through {@link Fixtures#read}. Each fixture case is
 * its own dynamic test.
 */
class ContractTest {
  private static CalmLensServerClient client(Transport transport) {
    return CalmLensServerClient.builder().apiKey("key").projectId("project-1").transport(transport).build();
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
   * the lenses for {@code ensureLenses}, the typed body otherwise, compared with {@link
   * Fixtures#assertMatches}.
   */
  @TestFactory Stream<DynamicTest> requestContracts() throws Exception {
    return cases(array("requests.json"), f -> f.get("operation").getAsString(), fixture -> {
      JsonObject[] captured = {null};
      Transport transport = request -> {
        assertEquals("key", request.headers().get("X-Api-Key"));
        captured[0] = Fixtures.describe(request.method(), request.uri(), request.headers(), Fixtures.body(request));
        return Fixtures.json(200, fixture.get("response").toString());
      };
      CalmLensServerClient client = client(transport);
      String operation = fixture.get("operation").getAsString();
      if (fixture.has("inputContract")) Fixtures.assertSignature(client, operation, fixture.getAsJsonObject("options"));
      // A fixture's result is what the method returns when it isn't the response body.
      JsonElement response = fixture.has("result") ? fixture.get("result") : fixture.get("response");
      JsonElement expected = operation.endsWith(".delete") || operation.equals("hashLists.removeEntry") ? JsonNull.INSTANCE
          : operation.equals("ensureLenses") ? response.getAsJsonObject().get("lenses") : response;
      // The same request and result through the synchronous client and its asynchronous form.
      for (boolean async : new boolean[] {false, true}) {
        captured[0] = null;
        String label = async ? "async result" : "result";
        // A fresh client each time, so ensureLenses' cache doesn't answer the second call.
        Object result = Fixtures.invoke(client(transport), operation, fixture.getAsJsonObject("options"), async && !Fixtures.isIterator(operation));
        assertEquals(fixture.get("request"), captured[0], label + " request");
        Fixtures.assertMatches(expected, Fixtures.isIterator(operation) ? collect((Iterable<?>) result) : Fixtures.typed(result), label);
      }
    });
  }

  /** Queued responses still pass through the real client, so every request contract holds against the mock. */
  @TestFactory Stream<DynamicTest> requestContractsThroughTheMock() throws Exception {
    return cases(array("requests.json"), f -> f.get("operation").getAsString(), fixture -> {
      MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueue(200, fixture.get("response"));
      Fixtures.invoke(mock.client(), fixture.get("operation").getAsString(), fixture.getAsJsonObject("options"));
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
      if (rejection.has("kind")) Fixtures.assertKind(error, rejection.get("kind").getAsString(), rejection.toString());
    });
  }

  @TestFactory Stream<DynamicTest> cdnUrlContracts() throws Exception {
    CalmLensServerClient client = client(request -> fail("Sent " + request.uri() + " to build a URL"));
    return cases(array("paths.json", "cdnUrls"), c -> c.get("options"), cdn -> {
      JsonObject options = cdn.getAsJsonObject("options");
      // Every fixture option must reach the request model, so a new option can't be silently ignored.
      if (cdn.has("url")) {
        java.util.Set<String> mapped = new java.util.HashSet<>(Fixtures.encode(Fixtures.decode(options, CdnRequestParams.class)).keySet());
        mapped.add("transform");
        assertTrue(mapped.containsAll(options.keySet()), cdn.toString());
        assertEquals(cdn.get("url").getAsString(), client.cdn().getAssetUrl(Fixtures.decode(options, CdnRequestParams.class)));
      } else {
        // Options the typed transform model cannot hold are rejected while decoding them.
        assertEquals(cdn.get("error").getAsString(), assertThrows(CalmLensException.class,
            () -> client.cdn().getAssetUrl(Fixtures.decode(options, CdnRequestParams.class))).getCode(), cdn.toString());
      }
    });
  }

  // errors.json

  @Test void errorCodeConstantsMatchThePublicApi() throws Exception {
    Map<String, Integer> expected = new HashMap<>();
    for (JsonElement item : array("errors.json")) {
      String code = item.getAsJsonObject().get("code").getAsString();
      // The proxy cases are sdk/http-error at each status: the SDK's own code, not an API one.
      if (!code.startsWith("sdk/")) expected.put(code, item.getAsJsonObject().get("status").getAsInt());
    }
    assertEquals(expected, ErrorCodes.apiStatuses());
    assertTrue(ErrorCodes.httpStatus(ErrorCodes.SDK_TIMEOUT).isEmpty());
  }

  @TestFactory Stream<DynamicTest> eachErrorCodeHasItsHttpStatus() throws Exception {
    return cases(array("errors.json"), e -> e.get("code").getAsString(), entry -> {
      String code = entry.get("code").getAsString();
      if (code.startsWith("sdk/")) assertTrue(ErrorCodes.httpStatus(code).isEmpty(), code + " has no status of its own");
      else assertEquals(entry.get("status").getAsInt(), ErrorCodes.httpStatus(code).orElseThrow());
    });
  }

  /** Each API error code, answered to a real call (retries off), becomes a typed error with every field. */
  @TestFactory Stream<DynamicTest> eachErrorCodeBecomesATypedError() throws Exception {
    return cases(array("errors.json"), e -> e.get("code").getAsString(), entry -> {
      JsonObject response = entry.getAsJsonObject("response");
      CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1").maxRetries(0).transport(request -> {
        Map<String, List<String>> headers = new HashMap<>();
        response.getAsJsonObject("headers").entrySet().forEach(h -> headers.put(h.getKey(), List.of(h.getValue().getAsString())));
        String body = response.has("bodyText") ? response.get("bodyText").getAsString() : response.get("body").toString();
        return new Transport.Response(response.get("status").getAsInt(), headers, body.getBytes(StandardCharsets.UTF_8));
      }).build();
      for (boolean async : new boolean[] {false, true}) {
        CalmLensException error = assertThrows(CalmLensException.class,
            () -> Fixtures.invoke(client, entry.get("operation").getAsString(), entry.getAsJsonObject("args"), async));
        assertEquals(entry.get("expected"), Fixtures.errorFields(error));
        Fixtures.assertKind(error, entry.get("kind").getAsString(), entry.get("code").getAsString());
        // A proxy's page is kept as the raw body.
        if (response.has("bodyText")) assertEquals(response.get("bodyText").getAsString(), error.getBody().orElseThrow());
      }
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
      WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(
          f.get("body").getAsString().getBytes(StandardCharsets.UTF_8), f.get("signature").getAsString(),
          f.get("timestamp").getAsString(), f.get("secret").getAsString(), f.get("now").getAsLong(), 300);
      assertEquals(f.get("expectedType").getAsString(), event.getRawJsonObject().get("type").getAsString());
      assertEquals(f.get("expectedFactKey").getAsString(), event.getFacts().get(0).getKey());
    });
  }

  /** CalmLens converts each stored event to the delivered payload the same way. */
  @TestFactory Stream<DynamicTest> webhookPayloadConversionContracts() throws Exception {
    return cases(array("webhooks.json", "payloads"), p -> p.getAsJsonObject("event").get("type").getAsString(), entry -> {
      Event event = Json.GSON.fromJson(entry.get("event"), Event.class);
      assertEquals(Json.GSON.fromJson(entry.get("payload"), WebhookEventPayload.class), CalmLensServerClient.toWebhookEventPayload(event));
    });
  }

  @TestFactory Stream<DynamicTest> webhookPayloadParsingContracts() throws Exception {
    return cases(array("webhooks.json", "payloads"), p -> p.getAsJsonObject("event").get("type").getAsString(), item -> {
      JsonObject expected = item.getAsJsonObject("payload");
      WebhookEventPayload parsed = CalmLensServerClient.readWebhookEvent(expected.toString());
      assertEquals(expected.get("id").getAsString(), parsed.getId());
      assertEquals(expected.get("projectId").getAsString(), parsed.getProjectId());
      assertEquals(EventType.fromValue(expected.get("type").getAsString()), parsed.getType());
      assertEquals(EventSeverity.fromValue(expected.get("severity").getAsString()), parsed.getSeverity());
      assertEquals(expected.get("title").getAsString(), parsed.getTitle());
      assertEquals(string(expected, "description"), parsed.getDescription().orElse(null));
      assertEquals(string(expected, "assetId"), parsed.getAssetId().orElse(null));
      if (expected.get("asset").isJsonNull()) assertTrue(parsed.getAsset().isEmpty());
      else assertEventAsset(expected.getAsJsonObject("asset"), parsed.getAsset().orElseThrow());
      assertEquals(expected.get("facts"), Json.GSON.toJsonTree(parsed.getFacts()));
      assertEquals(Instant.ofEpochMilli(expected.get("createdAt").getAsLong()), parsed.getCreatedAt());
    });
  }

  private static String string(JsonObject object, String name) {
    JsonElement value = object.get(name);
    return value == null || value.isJsonNull() ? null : value.getAsString();
  }

  private static void assertEventAsset(JsonObject expected, EventAsset asset) {
    assertEquals(string(expected, "id"), asset.getId());
    assertEquals(string(expected, "externalId"), asset.getExternalId().orElse(null));
    assertEquals(string(expected.getAsJsonObject("classification"), "status"), asset.getClassification().getStatus().getValue());
    assertEquals(string(expected.getAsJsonObject("classification").getAsJsonObject("moderation"), "decision"),
        asset.getClassification().getModeration().getDecision().map(AssetModerationDecision::getValue).orElse(null));
    assertEquals(string(expected.getAsJsonObject("content"), "status"), asset.getContent().getStatus().getValue());
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
      WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(
          c.get("body").getAsString().getBytes(StandardCharsets.UTF_8), c.get("signature").getAsString(), c.get("timestamp").getAsString(),
          c.get("secret").getAsString(), c.get("now").getAsLong(), CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
      assertEquals(c.get("expected"), tree(event));
      assertEquals(c.get("isTest").getAsBoolean(), CalmLensServerClient.isTestWebhookEvent(event));
    });
  }

  @TestFactory Stream<DynamicTest> webhookTestFacts() throws Exception {
    return cases(array("webhooks.json", "testFacts"), c -> c.get("name").getAsString(), c ->
        assertEquals(c.get("isTest").getAsBoolean(), CalmLensServerClient.isTestWebhookEvent(Json.GSON.fromJson(c.get("event"), WebhookEventPayload.class))));
  }

  /** getEventFact reads one fact's value by key, null when the event lacks it, from a delivery and from a feed event. */
  @TestFactory Stream<DynamicTest> webhookFactLookups() throws Exception {
    return cases(array("webhooks.json", "factLookups"), c -> c.get("name").getAsString(), c -> {
      String key = c.get("key").getAsString();
      assertEquals(c.get("value"), tree(CalmLensServerClient.getEventFact(Json.GSON.fromJson(c.get("event"), WebhookEventPayload.class), key)));
      assertEquals(c.get("value"), tree(CalmLensServerClient.getEventFact(Json.GSON.fromJson(c.get("event"), Event.class), key)));
    });
  }

  /** getEventFacts gives every fact's value by key, from a delivery and from a feed event. */
  @TestFactory Stream<DynamicTest> webhookFactObjects() throws Exception {
    return cases(array("webhooks.json", "factObjects"), c -> c.get("name").getAsString(), c -> {
      assertEquals(c.get("facts"), tree(CalmLensServerClient.getEventFacts(Json.GSON.fromJson(c.get("event"), WebhookEventPayload.class))));
      assertEquals(c.get("facts"), tree(CalmLensServerClient.getEventFacts(Json.GSON.fromJson(c.get("event"), Event.class))));
    });
  }

  @TestFactory Stream<DynamicTest> webhookAssetSequences() throws Exception {
    return cases(array("webhooks.json", "assetSequences"), c -> c.get("name").getAsString(), c -> {
      Long lastSequence = c.get("lastSequence").isJsonNull() ? null : c.get("lastSequence").getAsLong();
      boolean newer = c.get("newer").getAsBoolean();
      assertEquals(newer, CalmLensServerClient.isNewerAssetEvent(Json.GSON.fromJson(c.get("event"), WebhookEventPayload.class), lastSequence));
      assertEquals(newer, CalmLensServerClient.isNewerAssetEvent(Json.GSON.fromJson(c.get("event"), Event.class), lastSequence));
    });
  }

  /** An event becomes its delivery body, is signed into delivery headers, and parses back from them. */
  @TestFactory Stream<DynamicTest> webhookRoundTrips() throws Exception {
    return cases(array("webhooks.json", "roundTrips"), c -> c.get("name").getAsString(), c -> {
      WebhookEventPayload payload = CalmLensServerClient.toWebhookEventPayload(Json.GSON.fromJson(c.get("event"), Event.class));
      assertEquals(c.get("payload"), tree(payload));
      String body = c.get("body").getAsString();
      assertEquals(body, Json.GSON.toJson(payload));
      Map<String, String> headers = CalmLensServerClient.createWebhookHeaders(c.get("secret").getAsString(), body,
          c.get("deliveryId").getAsString(), c.get("timestampSeconds").getAsLong());
      assertEquals(Json.GSON.fromJson(c.get("headers"), new com.google.gson.reflect.TypeToken<Map<String, String>>() {}.getType()), headers);
      WebhookEventPayload received = CalmLensServerClient.parseWebhookRequest(headers, body.getBytes(StandardCharsets.UTF_8),
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
    assertEquals(payload.get("id").getAsString(), CalmLensServerClient.parseWebhookEvent(body, header, now, "whsec").getId());
    assertEquals(payload.get("id").getAsString(), CalmLensServerClient.parseWebhookRequest(
        Map.of(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER, header, CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER, now), body, "whsec").getId());
    String stale = Long.toString(System.currentTimeMillis() / 1000 - CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 5);
    assertFalse(CalmLensServerClient.verifyWebhookRequest(Map.of(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER,
        CalmLensServerClient.createWebhookSignatureHeader("whsec", stale, body), CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER, stale), body, "whsec"));
  }

  // upload-tokens.json

  /** Options a Java type cannot hold, so the type already refuses them. */
  private static final Map<String, String> TOKEN_OPTIONS_REJECTED_BY_TYPE = Map.of(
      "fractional lifetime", "UploadTokenSignParams.expiresIn is an Integer");

  private static UploadTokenSignParams tokenOptions(JsonObject options) {
    UploadTokenSignParams.Builder typed = UploadTokenSignParams.builder().setUploadPresetId(options.get("uploadPresetId").getAsString());
    if (options.has("externalId")) typed.setExternalId(options.get("externalId").getAsString());
    if (options.has("expiresIn")) typed.setExpiresIn(options.get("expiresIn").getAsInt());
    return typed.build();
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
      SignedUploadToken signed = MockCalmLensServerClient.signUploadToken(c.get("apiKey").getAsString(),
          tokenOptions(c.getAsJsonObject("options")), c.get("now").getAsLong(), c.get("nonce").getAsString());
      assertEquals(expected.get("token").getAsString(), signed.getToken());
      assertEquals(expected.get("expiresAt").getAsLong(), signed.getExpiresAt());
    });
  }

  @TestFactory Stream<DynamicTest> uploadTokensSignWithTheClientsClockAndAFreshNonce() throws Exception {
    JsonObject fixture = Fixtures.read("upload-tokens.json").getAsJsonObject();
    String context = fixture.get("signingContext").getAsString();
    return cases(fixture.getAsJsonArray("signing"), c -> c.get("name").getAsString(), c -> {
      JsonObject expected = c.getAsJsonObject("expected");
      CalmLensServerClient client = CalmLensServerClient.builder().apiKey(c.get("apiKey").getAsString()).projectId("project-1").build();
      long before = System.currentTimeMillis();
      SignedUploadToken signed = client.uploadTokens().sign(tokenOptions(c.getAsJsonObject("options")));
      long after = System.currentTimeMillis();
      JsonObject claims = tokenClaims(signed.getToken());
      JsonObject want = expected.getAsJsonObject("claims").deepCopy();
      want.addProperty("e", signed.getExpiresAt());
      want.add("n", claims.get("n"));
      assertEquals(want, claims);
      assertNotEquals(c.get("nonce").getAsString(), claims.get("n").getAsString());
      long lifetime = expected.get("expiresAt").getAsLong() - c.get("now").getAsLong();
      assertTrue(signed.getExpiresAt() - before >= lifetime && signed.getExpiresAt() - after <= lifetime, "expiry within the lifetime");
      String body = signed.getToken().substring("clut_".length(), signed.getToken().indexOf('.'));
      assertEquals(hmacHex(expected.get("signingSecret").getAsString(), context + body), signed.getToken().substring(signed.getToken().indexOf('.') + 1));
    });
  }

  @TestFactory Stream<DynamicTest> uploadTokensRefuseInvalidOptions() throws Exception {
    return cases(array("upload-tokens.json", "rejections"), c -> c.get("name").getAsString(), c -> {
      String name = c.get("name").getAsString();
      JsonObject options = c.getAsJsonObject("options");
      if (TOKEN_OPTIONS_REJECTED_BY_TYPE.containsKey(name)) {
        // The typed option cannot hold the fixture's value.
        assertThrows(NumberFormatException.class, () -> Integer.parseInt(options.get("expiresIn").getAsString()), TOKEN_OPTIONS_REJECTED_BY_TYPE.get(name));
        return;
      }
      String apiKey = c.get("apiKey").getAsString();
      CalmLensServerClient client = CalmLensServerClient.builder().apiKey(apiKey).projectId("project-1").transport(request -> fail("Sent " + request.uri())).build();
      assertEquals(c.get("error").getAsString(), assertThrows(CalmLensException.class, () -> client.uploadTokens().sign(tokenOptions(options))).getCode());
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

  /** Every transform option, decoded into ImageTransformOptions and serialized, gives the selector the CDN writes. */
  @TestFactory Stream<DynamicTest> transformOptionContracts() throws Exception {
    return cases(array("transform-options.json", "cases"), c -> c.get("selector").getAsString(), testCase -> {
      ImageTransformOptions options = Json.GSON.fromJson(testCase.get("options"), ImageTransformOptions.class);
      assertEquals(testCase.get("selector").getAsString(), CalmLensServerClient.serializeTransform(options));
    });
  }

  /**
   * Invalid cases {@link ImageTransformOptions} cannot hold: unknown options and values of
   * another type do not survive decoding, so no Java caller can pass them.
   */
  private static final Map<String, String> TRANSFORM_OPTIONS_REJECTED_BY_TYPE = Map.of(
      "{\"type\":\"imageTransform\",\"options\":{\"format\":\"webp\",\"width\":640}}", "ImageTransformOptions has no type or options option",
      "{\"bogus\":1}", "ImageTransformOptions has no bogus option",
      "{\"width\":640,\"border\":{\"colour\":\"#ffffff\"}}", "ImageBorder has color, not colour",
      "{\"trim\":{\"border\":{\"keep\":1,\"size\":2}}}", "TrimBorder has no size",
      "{\"gravity\":{\"x\":0.5,\"y\":0.5}}", "Gravity.point requires a mode",
      "{\"width\":10.5}", "width is an Integer",
      "{\"quality\":1.5}", "a numeric Quality is an int",
      "{\"anim\":\"false\"}", "anim is a Boolean",
      "{\"fit\":\"cover\",\"trim\":{\"border\":{\"keep\":\"x\"}}}", "TrimBorder.keep is a Double");

  /** Structured options as decoded and encoded again, or null when they do not decode. */
  private static JsonElement transformRoundTrip(JsonElement options) {
    try {
      return Json.GSON.toJsonTree(Json.GSON.fromJson(options, ImageTransformOptions.class));
    } catch (RuntimeException undecodable) {
      return null;
    }
  }

  /** Options the CDN refuses are refused before any URL is built, naming every refused key. */
  @TestFactory Stream<DynamicTest> refusesInvalidTransformOptions() throws Exception {
    return cases(array("transform-options.json", "invalid"), c -> c.get("options").toString(), testCase -> {
      JsonElement options = testCase.get("options");
      String reason = TRANSFORM_OPTIONS_REJECTED_BY_TYPE.get(options.toString());
      if (reason != null) {
        assertNotEquals(options, transformRoundTrip(options), reason);
        return;
      }
      assertEquals(options, transformRoundTrip(options), "decodes into ImageTransformOptions");
      ImageTransformOptions typed = Json.GSON.fromJson(options, ImageTransformOptions.class);
      CalmLensException error = assertThrows(CalmLensException.class,
          () -> refusing().cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("asset-1").setResource("rendered").setTransform(typed).build()));
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
      List<String> unknownKeys = Json.GSON.fromJson(testCase.get("unknownKeys"), new com.google.gson.reflect.TypeToken<List<String>>() {}.getType());
      List<String> invalidKeys = Json.GSON.fromJson(testCase.get("invalidKeys"), new com.google.gson.reflect.TypeToken<List<String>>() {}.getType());
      assertEquals(Map.of("unknownKeys", unknownKeys, "invalidKeys", invalidKeys), error.getDetails());
      for (String key : unknownKeys) assertTrue(error.getMessage().contains(key), error.getMessage());
      for (String key : invalidKeys) assertTrue(error.getMessage().contains(key), error.getMessage());
    });
  }

  // upload-mime-types.json

  /** Each type the API refuses is refused by {@code assets.create} before anything is sent. */
  @TestFactory Stream<DynamicTest> refusesUploadsOfRefusedMimeTypesBeforeSending() throws Exception {
    JsonArray refused = array("upload-mime-types.json", "refused");
    assertFalse(refused.isEmpty(), "no fixture cases");
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonElement element : refused) {
      String type = element.getAsString();
      tests.add(DynamicTest.dynamicTest(type, () -> {
        CalmLensException error = assertThrows(CalmLensException.class, () -> refusing().assets().create(
            AssetCreateParams.builder().setName("x").setContent(Content.base64("aGVsbG8=", type)).build()));
        assertEquals(ErrorCodes.UNSUPPORTED_UPLOAD_TYPE, error.getCode());
        assertEquals(Map.of("mimeType", type, "source", "calmlens"), error.getDetails());
      }));
    }
    return tests.stream();
  }

  // mock-scenarios.json: replayed against MockCalmLensServerClient.

  /**
   * Follows a dotted path: numeric segments index arrays, {@code length} is an array's length.
   * Returns Java null when the path is absent, so an expected null needs a present null.
   */
  private static JsonElement at(JsonElement value, String path) {
    for (String segment : path.split("\\.")) {
      if (value == null || !(value.isJsonArray() || value.isJsonObject())) return null;
      if (value.isJsonArray()) {
        JsonArray items = value.getAsJsonArray();
        if (segment.equals("length")) value = new JsonPrimitive(items.size());
        else {
          int index = Integer.parseInt(segment);
          value = index < items.size() ? items.get(index) : null;
        }
      } else {
        value = value.getAsJsonObject().get(segment);
      }
    }
    return value;
  }

  /** Resolves {@code $ref}, {@code $concat} and {@code $base64Repeat} markers (packages/sdk-contract/README.md). */
  static JsonElement resolve(JsonElement value, Map<String, JsonElement> saved) {
    if (value.isJsonObject()) {
      JsonObject object = value.getAsJsonObject();
      if (object.has("$ref")) {
        String[] reference = object.get("$ref").getAsString().split("\\.", 2);
        JsonElement root = saved.get(reference[0]);
        return normalize(reference.length == 1 ? root : at(root, reference[1]));
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

  /**
   * Compares {@code actual} with {@code expected} where an object lists only the members to compare
   * and an array must have as many items, each compared the same way.
   */
  static void assertListed(JsonElement expected, JsonElement actual, String label) {
    JsonElement value = normalize(actual);
    if (expected.isJsonObject()) {
      assertTrue(value.isJsonObject(), label + ": expected an object, got " + value);
      for (Map.Entry<String, JsonElement> member : expected.getAsJsonObject().entrySet())
        assertListed(member.getValue(), value.getAsJsonObject().get(member.getKey()), label + "." + member.getKey());
    } else if (expected.isJsonArray()) {
      assertTrue(value.isJsonArray(), label + ": expected an array, got " + value);
      assertEquals(expected.getAsJsonArray().size(), value.getAsJsonArray().size(), label + ".length");
      for (int i = 0; i < expected.getAsJsonArray().size(); i++)
        assertListed(expected.getAsJsonArray().get(i), value.getAsJsonArray().get(i), label + "." + i);
    } else {
      assertEquals(normalize(expected), value, label);
    }
  }

  private static Outcome outcome(String value) {
    return Arrays.stream(Outcome.values()).filter(outcome -> outcome.value().equals(value)).findFirst().orElseThrow();
  }

  /** Builds a decision with the builder, in the order the fixture lists its calls: a status, or a status with flags, notEvaluated and pendingReview. */
  static MockDecision buildDecision(JsonElement spec) {
    if (spec.isJsonPrimitive()) return MockDecision.of(spec.getAsString());
    JsonObject object = spec.getAsJsonObject();
    MockDecision decision = MockDecision.of(object.get("status").getAsString());
    if (object.has("flags"))
      for (JsonElement item : object.getAsJsonArray("flags")) {
        JsonObject flag = item.getAsJsonObject();
        Map<String, Double> qualifiers = new java.util.LinkedHashMap<>();
        if (flag.has("qualifiers")) flag.getAsJsonObject("qualifiers").entrySet().forEach(q -> qualifiers.put(q.getKey(), q.getValue().getAsDouble()));
        decision.flag(flag.get("category").getAsString(), flag.get("score").getAsDouble(), qualifiers);
      }
    if (object.has("notEvaluated")) for (JsonElement category : object.getAsJsonArray("notEvaluated")) decision.notEvaluated(category.getAsString());
    if (object.has("pendingReview")) {
      JsonObject review = object.getAsJsonObject("pendingReview");
      String reason = review.get("reason").getAsString();
      if (!review.has("uncertainCategories")) return decision.pendingReview(reason);
      List<String> uncertain = new ArrayList<>();
      review.getAsJsonArray("uncertainCategories").forEach(category -> uncertain.add(category.getAsString()));
      decision.pendingReview(reason, uncertain);
    }
    return decision;
  }

  /**
   * The scenario's {@code moderate}: answers by asset name for any trigger, else by queue mode for
   * uploads, else like the mock's default, recording what it was given in {@code calls}.
   */
  private static java.util.function.Function<MockCalmLensServerClient.ModerationInput, MockDecision> recordingModerate(JsonObject moderate, JsonArray calls) {
    return input -> {
      JsonObject call = new JsonObject();
      call.addProperty("trigger", input.trigger().value());
      call.addProperty("queued", input.queued());
      call.addProperty("assetId", input.asset().getId());
      call.addProperty("name", input.asset().getName());
      call.addProperty("text", input.content().text());
      byte[] bytes = input.content().bytes();
      call.addProperty("bytesBase64", bytes == null ? null : java.util.Base64.getEncoder().encodeToString(bytes));
      calls.add(call);
      String name = input.asset().getName();
      JsonElement spec = moderate.has("byName") && name != null ? moderate.getAsJsonObject("byName").get(name) : null;
      if (spec == null && input.trigger() == MockCalmLensServerClient.Trigger.UPLOAD) spec = moderate.get(input.queued() ? "queued" : "analyzed");
      if (spec != null) return buildDecision(spec);
      return MockDecision.of(input.queued() && input.trigger() != MockCalmLensServerClient.Trigger.COMPLETE ? "pending" : "allowed");
    };
  }

  /** Typed results as JSON, with each declared field that is null written as null. */
  static JsonElement tree(Object result) { return result == null ? JsonNull.INSTANCE : Fixtures.WITH_NULLS.toJsonTree(result); }

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

  /** A CDN response as the scenarios compare it: status, error code, body and lowercase headers. */
  private static JsonObject served(CdnResponse served) {
    try (CdnResponse response = served) {
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

  private static JsonElement run(MockCalmLensServerClient mock, String operation, JsonObject args, JsonArray moderateCalls) throws Throwable {
    switch (operation) {
      case "mock.decide":
        return tree(mock.decide(args.get("assetId").getAsString(), outcome(args.get("outcome").getAsString())));
      case "mock.completeProcessing":
        return tree(mock.completeProcessing(args.get("assetId").getAsString(), args.has("decision") ? buildDecision(args.get("decision")) : null));
      case "mock.moderateCalls":
        return moderateCalls.deepCopy();
      case "mock.buildDecision":
        buildDecision(args);
        return JsonNull.INSTANCE;
      case "mock.requests": {
        JsonArray requests = new JsonArray();
        for (MockCalmLensServerClient.Request request : mock.requests()) {
          JsonObject item = new JsonObject();
          item.addProperty("method", request.method());
          item.addProperty("path", request.path());
          JsonObject query = new JsonObject();
          request.query().forEach(query::addProperty);
          item.add("query", query);
          item.addProperty("status", request.status());
          requests.add(item);
        }
        return requests;
      }
      case "mock.clearRequests":
        mock.clearRequests();
        return JsonNull.INSTANCE;
      case "mock.enqueueEvent": {
        List<EventFact> facts = new ArrayList<>();
        for (JsonElement fact : args.getAsJsonArray("facts")) facts.add(Json.GSON.fromJson(fact, EventFact.class));
        String assetId = args.has("assetId") && !args.get("assetId").isJsonNull() ? args.get("assetId").getAsString() : null;
        EventFact[] list = facts.toArray(EventFact[]::new);
        return tree(args.has("actor")
            ? mock.enqueueEvent(args.get("type").getAsString(), assetId, Json.GSON.fromJson(args.get("actor"), EventActor.class), list)
            : mock.enqueueEvent(args.get("type").getAsString(), assetId, list));
      }
      case "mock.grant":
        mock.setApiKeyGrants(grants(args.getAsJsonArray("grants")));
        return JsonNull.INSTANCE;
      case "mock.failNext": {
        MockCalmLensServerClient.FailureOptions failure = new MockCalmLensServerClient.FailureOptions();
        if (args.has("operation")) failure.operation(args.get("operation").getAsString());
        if (args.has("details")) failure.details(Json.GSON.fromJson(args.get("details"), new com.google.gson.reflect.TypeToken<Map<String, Object>>() {}.getType()));
        if (args.has("retryAfter")) failure.retryAfter(args.get("retryAfter").getAsInt());
        mock.failNextRequest(args.get("failure").getAsString(), failure);
        return JsonNull.INSTANCE;
      }
      case "cdn.serve":
        return served(mock.client().cdn().serve(Fixtures.decode(args, CdnRequestParams.class)));
      case "mock.fetchCdn":
        return served(mock.fetchCdn(args.get("url").getAsString()));
      case "cdn.getAssetInfo":
        return tree(mock.client().cdn().getAssetInfo(args.get("url").getAsString(),
            args.has("viewerClaims") ? Json.GSON.fromJson(args.get("viewerClaims"), ViewerClaims.class) : null));
      case "assets.waitForDecision":
        return tree(mock.client().assets().waitForDecision(args.get("assetId").getAsString(), Duration.ofMillis(args.get("timeoutMs").getAsLong())));
      case "events.pages":
        return collect(mock.client().events().pages(Fixtures.decode(args, EventListParams.class)));
      default:
        if (args.has("idempotencyKey")) {
          RequestOptions request = RequestOptions.builder().setIdempotencyKey(args.remove("idempotencyKey").getAsString()).build();
          AssetCreateParams submit = Fixtures.decode(args, AssetCreateParams.class);
          return tree(operation.equals("assets.create") ? mock.client().assets().create(submit, request) : mock.client().assets().classify(submit, request));
        }
        Object result = Fixtures.invoke(mock.client(), operation, args);
        // Every list's iterator yields its items in order.
        return Fixtures.isIterator(operation) ? collect((Iterable<?>) result) : tree(result);
    }
  }

  private static void check(MockCalmLensServerClient mock, String scenario, JsonObject step, Map<String, JsonElement> saved, JsonArray moderateCalls) throws Throwable {
    String operation = step.get("operation").getAsString();
    String label = scenario + ": " + operation + " " + step.get("args");
    JsonObject args = step.has("args") ? resolve(step.get("args"), saved).getAsJsonObject() : new JsonObject();
    JsonObject expect = step.has("expect") ? step.getAsJsonObject("expect") : new JsonObject();
    if (expect.has("error")) {
      CalmLensException error = assertThrows(CalmLensException.class, () -> run(mock, operation, args, moderateCalls), label);
      JsonObject wanted = expect.getAsJsonObject("error");
      JsonObject actual = new JsonObject();
      actual.addProperty("code", error.getCode());
      actual.add("status", error.getStatus() == 0 ? JsonNull.INSTANCE : new JsonPrimitive(error.getStatus()));
      JsonObject want = new JsonObject();
      want.add("code", wanted.get("code"));
      want.add("status", wanted.get("status"));
      assertEquals(want, actual, label);
      if (wanted.has("kind")) Fixtures.assertKind(error, wanted.get("kind").getAsString(), label);
      if (wanted.has("retryAfter")) {
        assertInstanceOf(ApiException.class, error, label);
        assertEquals(Optional.of(Duration.ofSeconds(wanted.get("retryAfter").getAsLong())), ((ApiException) error).getRetryAfter(), label + ": retryAfter");
      }
      // `details` lists only the keys to compare, and objects in them (such as each of a
      // validation error's `issues`) only the fields to compare.
      if (wanted.has("details")) {
        JsonObject details = Json.GSON.toJsonTree(error.getDetails()).getAsJsonObject();
        for (Map.Entry<String, JsonElement> detail : wanted.getAsJsonObject("details").entrySet())
          assertListed(resolve(detail.getValue(), saved), details.get(detail.getKey()), label + ": details." + detail.getKey());
      }
      return;
    }
    int sent = mock.requests().size();
    JsonElement result = run(mock, operation, args, moderateCalls);
    if (expect.has("httpStatus")) {
      // The status of the last response the in-memory API sent during the step, so retries and
      // polls are judged by their final attempt.
      List<MockCalmLensServerClient.Request> requests = mock.requests();
      Integer status = requests.size() > sent ? requests.get(requests.size() - 1).status() : null;
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
          assertTrue(actual != null && actual.isJsonArray(), label + ": " + entry.getKey() + " is not an array");
          boolean found = false;
          for (JsonElement item : actual.getAsJsonArray()) found |= normalize(item).equals(member);
          assertTrue(found, label + ": " + entry.getKey() + " " + actual + " lacks " + member);
        } else if (raw.isJsonObject() && raw.getAsJsonObject().has("$queryJson")) {
          Map<String, String> query = new HashMap<>();
          String rawQuery = java.net.URI.create(actual.getAsString()).getRawQuery();
          for (String pair : rawQuery == null ? new String[0] : rawQuery.split("&")) {
            int equals = pair.indexOf('=');
            query.put(java.net.URLDecoder.decode(equals < 0 ? pair : pair.substring(0, equals), StandardCharsets.UTF_8),
                equals < 0 ? "" : java.net.URLDecoder.decode(pair.substring(equals + 1), StandardCharsets.UTF_8));
          }
          for (Map.Entry<String, JsonElement> param : raw.getAsJsonObject().getAsJsonObject("$queryJson").entrySet()) {
            assertTrue(query.containsKey(param.getKey()), label + ": " + entry.getKey() + " lacks ?" + param.getKey());
            assertEquals(normalize(param.getValue()), normalize(JsonParser.parseString(query.get(param.getKey()))),
                label + ": " + entry.getKey() + " ?" + param.getKey());
          }
        } else if (raw.isJsonObject() && raw.getAsJsonObject().has("$id")) {
          String prefix = raw.getAsJsonObject().get("$id").getAsString();
          assertTrue(actual != null && actual.isJsonPrimitive() && actual.getAsString().matches(prefix + "_[0-9A-Za-z]{20}"),
              label + ": " + entry.getKey() + " " + actual + " is not a " + prefix + "_ ID");
        } else {
          Fixtures.assertMatches(resolve(raw, saved), actual, label + ": " + entry.getKey());
        }
      }
    if (step.has("save")) saved.put(step.get("save").getAsString(), result);
  }

  @TestFactory Stream<DynamicTest> mockScenarios() throws Exception {
    return cases(array("mock-scenarios.json", "scenarios"), s -> s.get("name").getAsString(), scenario -> {
      String name = scenario.get("name").getAsString();
      if (scenario.has("untypedArgs")) {
        // The scenario passes arguments the SDK's option types cannot hold.
        String reason = scenario.get("untypedArgs").getAsString();
        System.out.println("Skipping " + name + " (untyped args: " + reason + ")");
        Assumptions.abort("untyped args: " + reason);
      }
      JsonObject options = scenario.getAsJsonObject("mock");
      Grant[] grants = options.has("apiKeyGrants") ? grants(options.getAsJsonArray("apiKeyGrants")) : new Grant[0];
      JsonArray moderateCalls = new JsonArray();
      Options mockOptions = new Options();
      if (options.has("moderate")) mockOptions.moderate(recordingModerate(options.getAsJsonObject("moderate"), moderateCalls));
      MockCalmLensServerClient mock;
      if (options.has("defaultProject")) {
        // Built without a client builder, so without a project ID; retries stay off.
        assertFalse(options.has("maxRetries"), name + ": maxRetries needs a client builder");
        mock = new MockCalmLensServerClient(mockOptions);
        mock.setApiKeyGrants(grants);
      } else {
        CalmLensServerClient.Builder builder = CalmLensServerClient.builder().apiKey(MockCalmLensServerClient.createMockApiKey(grants)).projectId("project-1")
            .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1");
        if (options.has("maxRetries")) builder.maxRetries(options.get("maxRetries").getAsInt());
        mock = new MockCalmLensServerClient(builder, mockOptions);
      }
      Map<String, JsonElement> saved = new HashMap<>();
      long started = System.nanoTime();
      for (JsonElement step : scenario.getAsJsonArray("steps")) {
        int runs = step.getAsJsonObject().has("repeat") ? step.getAsJsonObject().get("repeat").getAsInt() : 1;
        for (int run = 0; run < runs; run++) check(mock, name, step.getAsJsonObject(), saved, moderateCalls);
      }
      // Mock waits take no real time.
      assertTrue(System.nanoTime() - started < Duration.ofSeconds(5).toNanos());
    });
  }

  /** The categories and qualifiers {@link MockDecision} accepts are surface.json's. */
  @Test void mockDecisionClassificationMatchesTheSurface() throws Exception {
    JsonObject classification = Fixtures.read("surface.json").getAsJsonObject().getAsJsonObject("classification");
    assertEquals(classification.get("categories"), Json.GSON.toJsonTree(MockClassificationValues.categories()));
    assertEquals(classification.get("qualifiers"), Json.GSON.toJsonTree(MockClassificationValues.qualifiers()));
  }

  /**
   * Public methods of the client and its resources that no surface.json capability names, each
   * with why it is plumbing rather than an API capability. Anything else unnamed is stale.
   */
  private static final Map<String, String> PLUMBING = Map.ofEntries(
      Map.entry("close", "closes the client"),
      Map.entry("withRequestOptions", "a client with changed per-call options"),
      Map.entry("async", "the asynchronous form of the same capabilities (surface.json asyncClient)"),
      Map.entry("request", "the raw request for API paths the SDK has no method for yet (client cases)"),
      Map.entry("getProjectId", "reads the client's configuration"),
      Map.entry("getBaseUrl", "reads the client's configuration"),
      Map.entry("getCdnBaseUrl", "reads the client's configuration"),
      Map.entry("getTimeout", "reads the client's configuration"),
      Map.entry("getUploadTimeout", "reads the client's configuration"),
      Map.entry("getMaxRetries", "reads the client's configuration"),
      Map.entry("getMaxResponseBytes", "reads the client's configuration"),
      Map.entry("getPartSizeBytes", "reads the client's configuration"),
      Map.entry("CalmLensServerClient.builder", "starts the client's configuration"),
      Map.entry("CalmLensServerClient.fromEnv", "builds the client from the environment (client cases)"),
      Map.entry("CalmLensServerClient.parseWebhookRequest", "parseWebhookEvent reading the signature and timestamp from the request's headers"),
      Map.entry("events().pages", "events.iterate a page at a time, with each page's cursor, which mock-scenarios.json replays"),
      Map.entry("toString", "Java's object description"));

  /** The capability name of a public method: {@code resource().name}, {@code name} or {@code CalmLensServerClient.name}. */
  private static List<String> publicMethodNames() {
    java.util.Set<String> names = new java.util.TreeSet<>();
    java.util.Set<Class<?>> resources = new java.util.HashSet<>();
    for (Method method : CalmLensServerClient.class.getDeclaredMethods()) {
      if (!Modifier.isPublic(method.getModifiers()) || method.isSynthetic()) continue;
      // A resource accessor, such as assets(), leads to that resource's methods.
      if (method.getParameterCount() == 0 && method.getReturnType().getEnclosingClass() == CalmLensServerClient.class
          && method.getReturnType().getSimpleName().endsWith("Service")) {
        resources.add(method.getReturnType());
        for (Method member : method.getReturnType().getDeclaredMethods())
          if (Modifier.isPublic(member.getModifiers()) && !member.isSynthetic()) names.add(method.getName() + "()." + member.getName());
        continue;
      }
      names.add(Modifier.isStatic(method.getModifiers()) ? "CalmLensServerClient." + method.getName() : method.getName());
    }
    assertFalse(resources.isEmpty(), "the client has no resources");
    return List.copyOf(names);
  }

  /** Every public method of the client and its resources is a surface.json capability, or listed plumbing. */
  @Test void offersNoStaleMethods() throws Exception {
    java.util.Set<String> capabilities = new java.util.HashSet<>();
    for (JsonElement element : Fixtures.read("surface.json").getAsJsonObject().getAsJsonArray("capabilities")) {
      JsonObject capability = element.getAsJsonObject();
      String kind = capability.get("kind").getAsString();
      JsonElement name = capability.getAsJsonObject("names").get("java");
      if ((kind.equals("method") || kind.equals("function")) && name != null && !name.isJsonNull()) capabilities.add(name.getAsString());
    }
    List<String> methods = publicMethodNames();
    List<String> stale = methods.stream().filter(name -> !capabilities.contains(name) && !PLUMBING.containsKey(name)).toList();
    List<String> unusedPlumbing = PLUMBING.keySet().stream().filter(name -> !methods.contains(name)).sorted().toList();
    assertTrue(stale.isEmpty() && unusedPlumbing.isEmpty(), "methods no capability names: " + stale + "; plumbing no longer public: " + unusedPlumbing);
  }

  /** surface.json asyncClient: the client's asynchronous form, whose operations return futures. */
  @Test void offersTheAsyncClient() throws Exception {
    String name = Fixtures.read("surface.json").getAsJsonObject().getAsJsonObject("asyncClient").getAsJsonObject("names").get("java").getAsString();
    int dot = name.lastIndexOf('.');
    Method async = sdkClass(name.substring(0, dot)).getMethod(name.substring(dot + 1));
    Method retrieve = async.getReturnType().getMethod("assets").getReturnType().getMethod("retrieve", String.class);
    assertEquals(java.util.concurrent.CompletableFuture.class, retrieve.getReturnType());
  }

  /** surface.json errorKinds: every kind's Java class exists, and extends its parent kind's class. */
  @TestFactory Stream<DynamicTest> errorKindsResolve() throws Exception {
    return cases(array("surface.json", "errorKinds"), k -> k.get("id").getAsString(), kind -> {
      Class<?> type = Fixtures.errorKindClass(kind.get("id").getAsString());
      assertTrue(CalmLensException.class.isAssignableFrom(type), type.getName());
      JsonElement parent = kind.get("parent");
      if (parent != null && !parent.isJsonNull()) assertEquals(Fixtures.errorKindClass(parent.getAsString()), type.getSuperclass());
    });
  }

  // surface.json retryable: whether an error is retryable follows from its code and status alone.

  @TestFactory Stream<DynamicTest> retryableFollowsTheCodeAndStatus() throws Exception {
    return cases(array("surface.json", "retryable"), r -> r.get("code").getAsString() + " " + r.get("status"), entry -> {
      String code = entry.get("code").getAsString();
      boolean expected = entry.get("retryable").getAsBoolean();
      // The exception the client raises for the code and status.
      CalmLensException error = CalmLensException.of(code, null, null, entry.get("status").isJsonNull() ? 0 : entry.get("status").getAsInt(),
          Map.of(), null, null, null);
      assertEquals(expected, error.isRetryable(), error.getClass().getSimpleName());
      assertEquals(entry.get("local").getAsBoolean(), error.isLocal(), error.getClass().getSimpleName());
      Fixtures.assertKind(error, entry.get("kind").getAsString(), code);
    });
  }

  // surface.json: every capability a server SDK must offer exists under its Java name.

  private static CalmLensServerClient refusing() {
    return CalmLensServerClient.builder().apiKey("key").projectId("project-1").maxRetries(0).transport(request -> fail("Sent " + request.uri())).build();
  }

  /** A class of the SDK by its simple name, including nested model and mock classes. */
  private static Class<?> sdkClass(String name) {
    // A nested class is named with dots, as in CdnRequestParams.Builder.
    String binary = name.contains(".") ? name.substring(0, name.lastIndexOf('.')) + "$" + name.substring(name.lastIndexOf('.') + 1) : name;
    for (String candidate : List.of("com.calmlens." + name, "com.calmlens.testing." + name, "com.calmlens.models." + name,
        "com.calmlens.params." + name, "com.calmlens.params." + binary, "com.calmlens.testing.MockCalmLensServerClient$" + name)) {
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
    CalmLensServerClient failing = CalmLensServerClient.builder().apiKey("key").projectId("project-1").maxRetries(0).transport(request -> {
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
        String[] parts = name.replace("()", "").split("\\.");
        Class<?> target = CalmLensServerClient.class;
        if (parts.length == 2) {
          try {
            target = CalmLensServerClient.class.getMethod(parts[0]).getReturnType();
          } catch (NoSuchMethodException missing) {
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
          case "errors.requestId" -> Optional.of(expected.get("requestId").getAsString());
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
        return refusing().cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("asset-1").setResource(name).build()).endsWith("/asset-1/" + capability.get("path").getAsString());
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
      "signed URL lifetime of a fraction of a second", "CdnSignAssetUrlParams.expiresIn is a Long",
      "signed URL with an unknown transform option", "ImageTransformOptions has no bogus option");
  private static final Map<String, Class<?>> REJECTED_TYPES = Map.of(
      "signed URL lifetime of a fraction of a second", CdnSignAssetUrlParams.class);

  @TestFactory Stream<DynamicTest> refusesRejectedRequestsBeforeSending() throws Exception {
    CalmLensServerClient client = refusing();
    return cases(array("rejections.json"), r -> r.get("name").getAsString(), rejection -> {
      String name = rejection.get("name").getAsString();
      JsonObject options = rejection.getAsJsonObject("options");
      if (REJECTED_BY_TYPE.containsKey(name)) {
        // The typed options cannot hold the fixture's value: it does not survive decoding.
        if (options.has("transform") && options.get("transform").isJsonObject()) {
          JsonElement transform = options.get("transform");
          assertNotEquals(transform, transformRoundTrip(transform), REJECTED_BY_TYPE.get(name));
          return;
        }
        JsonObject typed = Fixtures.encode(Fixtures.decode(options, REJECTED_TYPES.get(name)));
        assertNotEquals(options, typed, REJECTED_BY_TYPE.get(name));
        return;
      }
      Throwable failure = assertThrows(Throwable.class, () -> Fixtures.invoke(client, rejection.get("operation").getAsString(), options));
      assertInstanceOf(CalmLensException.class, failure);
      CalmLensException error = (CalmLensException) failure;
      assertEquals(rejection.get("error").getAsString(), error.getCode());
      assertTrue(error.isLocal(), name);
      assertEquals(0, error.getStatus(), name);
      assertTrue(error.getRequestId().isEmpty(), name);
    });
  }

  // types.json

  /**
   * Differences from types.json that Java keeps on purpose, keyed by {@code <operation|*>
   * <options|result|*> <path and problem>}: a problem matches when its operation and side match and
   * its {@code $.<path>: <problem>} contains the key's text.
   */
  private static final Map<String, String> TYPE_DIFFERENCES = Map.of(
      "* result facts[].value: optional, but",
      "A fact's value is untyped JSON, which an Object field can't tell from a missing one, so getValue() returns it or null rather than failing; getRawJsonObject() keeps both",
      "* * features.aiGeneratedDetection: declared, but",
      "Behind ENABLE_AI_GENERATED_DETECTION (packages/shared/src/SharedConstants.ts), which is off, so the API hides the option",
      "* result classification.aiGeneratedDetection: declared, but",
      "Behind ENABLE_AI_GENERATED_DETECTION (packages/shared/src/SharedConstants.ts), which is off, so the API hides the result",
      "* result classification.linkSafety: declared, but",
      "Behind ENABLE_LINK_SAFETY (packages/shared/src/SharedConstants.ts), which is off, so the API hides the result",
      "* result moderation.linkSafety: declared, but",
      "Behind ENABLE_LINK_SAFETY (packages/shared/src/SharedConstants.ts), which is off, so the API hides the link-safety decision",
      "* * settings.linkSafety: declared, but",
      "Behind ENABLE_LINK_SAFETY (packages/shared/src/SharedConstants.ts), which is off, so the API hides the policy's link-safety settings");

  private static final String CATEGORY_KEYS = "Maps keyed by moderation category keep String keys: an EnumMap can't hold"
      + " two categories this SDK version doesn't know, which would both be UNKNOWN; ModerationCategory.fromValue reads a key";
  private static final String QUALIFIERS = "Qualifier names are Strings: they ship with moderation policy updates, more often"
      + " than SDK releases, and a policy round-trips them unchanged";
  private static final String FACT_KEYS = "Fact keys are Strings, read with getEventFact by their registered key; the set grows"
      + " with each event type, and getEventFacts keeps facts this SDK version doesn't know";

  /** Fields the SDK keeps as open Strings where the API lists values, by {@code Class.field}, with the reason. */
  private static final Map<String, String> OPEN_STRINGS = openStrings(
      CATEGORY_KEYS, List.of("AssetModeration.categories{key}", "MediaClassificationSegment.categories{key}", "ModerationRaw.categories{key}",
          "PolicySettings.categorySettings{key}", "PolicySettingsParams.categorySettings{key}"),
      QUALIFIERS, List.of("CategoryResult.qualifiers{key}", "PolicyRuleSnapshot.unless[]", "PolicyRuleSnapshot.when[]",
          "PolicyRuleParams.unless[]", "PolicyRuleParams.when[]"),
      FACT_KEYS, List.of("EventFact.key"));

  private static Map<String, String> openStrings(Object... reasonsAndFields) {
    Map<String, String> fields = new HashMap<>();
    for (int i = 0; i < reasonsAndFields.length; i += 2)
      for (Object field : (List<?>) reasonsAndFields[i + 1]) assertNull(fields.put((String) field, (String) reasonsAndFields[i]), (String) field);
    return fields;
  }

  /** The client method an operation's {@code names.java} names, such as {@code assets().update}: the overload without request options. */
  private static Method typedMethod(String name) throws Exception {
    String[] parts = name.replace("()", "").split("\\.");
    Class<?> target = parts.length == 1 ? CalmLensServerClient.class : CalmLensServerClient.class.getMethod(parts[0]).getReturnType();
    String method = parts[parts.length - 1];
    // The overload with params, else the one with the most parameters.
    return Arrays.stream(target.getMethods())
        .filter(m -> m.getName().equals(method) && Arrays.stream(m.getParameterTypes()).noneMatch(t -> t == RequestOptions.class))
        .max(java.util.Comparator.<Method>comparingInt(m -> Arrays.stream(m.getParameterTypes()).anyMatch(com.calmlens.params.ApiParams.class::isAssignableFrom) ? 1 : 0)
            .thenComparingInt(Method::getParameterCount))
        .orElseThrow(() -> new AssertionError("no method " + name));
  }

  private static boolean allowed(String problem, Map<String, Boolean> used) {
    for (String key : TYPE_DIFFERENCES.keySet()) {
      String[] parts = key.split(" ", 3);
      String[] actual = problem.split(" ", 3);
      if ((parts[0].equals("*") || parts[0].equals(actual[0])) && (parts[1].equals("*") || parts[1].equals(actual[1])) && actual[2].contains(parts[2])) {
        used.put(key, true);
        return true;
      }
    }
    return false;
  }

  /**
   * Each operation's options builder and result model match its schema in types.json, compared by
   * {@link DeclaredTypes}; every difference fails with its path, and every listed difference is
   * still found.
   */
  @Test void declaredTypesMatchTheApi() throws Exception {
    JsonObject contract = Fixtures.read("types.json").getAsJsonObject();
    List<String> problems = new ArrayList<>();
    Map<String, Boolean> used = new HashMap<>();
    java.util.Set<String> usedOpenStrings = new java.util.HashSet<>();
    for (JsonElement element : contract.getAsJsonArray("operations")) {
      JsonObject operation = element.getAsJsonObject();
      Method method = typedMethod(operation.getAsJsonObject("names").get("java").getAsString());
      for (String problem : new DeclaredTypes(contract, OPEN_STRINGS, usedOpenStrings).check(operation, method))
        if (!allowed(problem, used)) problems.add(problem);
    }
    List<String> stale = Stream.concat(TYPE_DIFFERENCES.keySet().stream().filter(k -> !used.containsKey(k)),
        OPEN_STRINGS.keySet().stream().filter(k -> !usedOpenStrings.contains(k))).sorted().toList();
    assertTrue(problems.isEmpty() && stale.isEmpty(),
        "declared types differ from types.json:\n" + String.join("\n", problems) + (stale.isEmpty() ? "" : "\nunused differences: " + stale));
  }
}
