package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ClientTest {
  private static CalmLensServerClient client(Transport transport) {
    return CalmLensServerClient.builder("key", "project-1").transport(transport).build();
  }

  @Test void requestContracts() throws Throwable {
    for (JsonElement item : Fixtures.read("requests.json").getAsJsonArray()) {
      JsonObject fixture = item.getAsJsonObject();
      JsonObject[] captured = {null};
      CalmLensServerClient client = client(request -> {
        assertEquals("key", request.headers().get("X-Api-Key"));
        captured[0] = Fixtures.describe(request.method(), request.uri(), request.headers(), Fixtures.body(request));
        return Fixtures.json(200, fixture.get("response").toString());
      });
      String operation = fixture.get("operation").getAsString();
      Fixtures.invoke(client, operation, fixture.getAsJsonObject("options"));
      assertEquals(fixture.get("request"), captured[0], operation);
    }
  }

  @Test void pathSafetyContracts() throws Throwable {
    JsonObject paths = Fixtures.read("paths.json").getAsJsonObject();
    CalmLensServerClient client = client(request -> fail("Sent " + request.uri() + " for a rejected ID"));
    for (JsonElement item : paths.getAsJsonArray("rejections")) {
      JsonObject rejection = item.getAsJsonObject();
      String operation = rejection.get("operation").getAsString();
      CalmLensException error = assertThrows(CalmLensException.class, () -> Fixtures.invoke(client, operation, rejection.getAsJsonObject("options")), rejection.toString());
      assertEquals(rejection.get("error").getAsString(), error.getCode(), rejection.toString());
    }
    for (JsonElement item : paths.getAsJsonArray("cdnUrls")) {
      JsonObject cdn = item.getAsJsonObject();
      JsonObject options = cdn.getAsJsonObject("options");
      if (cdn.has("url")) assertEquals(cdn.get("url").getAsString(), client.cdn.getAssetUrl(Fixtures.decode(options, Models.CdnRequest.class)));
      // Options the typed transform model cannot hold are rejected while decoding them.
      else assertEquals(cdn.get("error").getAsString(), assertThrows(CalmLensException.class,
          () -> client.cdn.getAssetUrl(Fixtures.decode(options, Models.CdnRequest.class))).getCode(), cdn.toString());
    }
  }

  @Test void errorCodeConstantsMatchThePublicApi() throws Exception {
    Map<String, Integer> expected = new HashMap<>();
    for (JsonElement item : Fixtures.read("errors.json").getAsJsonArray())
      expected.put(item.getAsJsonObject().get("code").getAsString(), item.getAsJsonObject().get("status").getAsInt());
    assertEquals(expected, ErrorCodes.apiStatuses());
    for (var entry : expected.entrySet()) assertEquals(entry.getValue(), ErrorCodes.httpStatus(entry.getKey()).orElseThrow(), entry.getKey());
    assertTrue(ErrorCodes.httpStatus(ErrorCodes.SDK_TIMEOUT).isEmpty());
  }

  @Test void versionComesFromTheManifestAndIsSentAsUserAgent() throws Exception {
    Matcher version = Pattern.compile("<artifactId>calmlens-sdk</artifactId>\\s*<version>([^<]+)</version>").matcher(Files.readString(Path.of("pom.xml")));
    assertTrue(version.find());
    assertEquals(version.group(1), CalmLensServerClient.VERSION);
    String[] agent = {null};
    client(request -> { agent[0] = request.headers().get("User-Agent"); return Fixtures.json(200, Fixtures.assetJson("a", "completed", "approved")); })
        .assets.retrieve(new Models.AssetId("a"));
    assertEquals("calmlens-java/" + CalmLensServerClient.VERSION + " (Java " + Runtime.version() + ")", agent[0]);
  }

  @Test void webhookVerificationContracts() throws Exception {
    for (JsonElement item : Fixtures.read("webhooks.json").getAsJsonObject().getAsJsonArray("verification")) {
      JsonObject v = item.getAsJsonObject();
      long tolerance = v.has("toleranceSeconds") ? v.get("toleranceSeconds").getAsLong() : CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
      String name = v.get("name").getAsString();
      byte[] body = v.get("body").getAsString().getBytes(StandardCharsets.UTF_8);
      String signature = v.get("signature").getAsString(), timestamp = v.get("timestamp").getAsString(), secret = v.get("secret").getAsString();
      long now = v.get("now").getAsLong();
      boolean valid = v.get("valid").getAsBoolean();
      assertEquals(valid, CalmLensServerClient.verifyWebhookSignature(v.get("body").getAsString(), signature, timestamp, secret, now, tolerance), name);
      assertEquals(valid, CalmLensServerClient.verifyWebhookSignature(body, signature, timestamp, secret, now, tolerance), name + " (bytes)");
      // A verified body that is not a delivery (such as "{}") fails parsing, never verification.
      try {
        CalmLensServerClient.parseWebhookEvent(body, signature, timestamp, secret, now, tolerance);
        assertTrue(valid, name);
      } catch (CalmLensException error) {
        assertEquals(valid ? ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD : ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE, error.getCode(), name);
      }
    }
  }

  @Test void parseWebhookEventVerifiesThenParses() throws Exception {
    JsonObject payload = Fixtures.read("webhooks.json").getAsJsonObject().getAsJsonArray("payloads").get(0).getAsJsonObject().getAsJsonObject("payload");
    byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
    String now = Long.toString(System.currentTimeMillis() / 1000);
    String header = CalmLensServerClient.createWebhookSignatureHeader("whsec", now, body);
    Models.WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(body, header, now, "whsec");
    assertEquals(payload.get("id").getAsString(), event.id());
    assertEquals(payload.get("type").getAsString(), event.type());
    assertEquals(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE,
        assertThrows(CalmLensException.class, () -> CalmLensServerClient.parseWebhookEvent(body, header, now, "other-secret")).getCode());
    String stale = Long.toString(System.currentTimeMillis() / 1000 - CalmLensServerClient.WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 5);
    assertEquals(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE, assertThrows(CalmLensException.class,
        () -> CalmLensServerClient.parseWebhookEvent(body, CalmLensServerClient.createWebhookSignatureHeader("whsec", stale, body), stale, "whsec")).getCode());
    byte[] notAnEvent = "{\"hello\":1}".getBytes(StandardCharsets.UTF_8);
    assertEquals(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, assertThrows(CalmLensException.class,
        () -> CalmLensServerClient.parseWebhookEvent(notAnEvent, CalmLensServerClient.createWebhookSignatureHeader("whsec", now, notAnEvent), now, "whsec")).getCode());
  }

  @Test void webhookVerificationUsesExactRawBytes() {
    // 0xff is not valid UTF-8: decoding it to a String replaces it, so only the byte overload matches.
    byte[] body = {'{', '"', 'a', '"', ':', '"', (byte) 0xff, '"', '}'};
    String header = CalmLensServerClient.createWebhookSignatureHeader("key", "1700000000", body);
    assertTrue(CalmLensServerClient.verifyWebhookSignature(body, header, "1700000000", "key", 1700000000, 300));
    assertFalse(CalmLensServerClient.verifyWebhookSignature(new String(body, StandardCharsets.UTF_8), header, "1700000000", "key", 1700000000, 300));
    byte[] tampered = body.clone();
    tampered[6] = (byte) 0xfe;
    assertFalse(CalmLensServerClient.verifyWebhookSignature(tampered, header, "1700000000", "key", 1700000000, 300));
    assertFalse(CalmLensServerClient.verifyWebhookSignature((byte[]) null, header, "1700000000", "key", 1700000000, 300));
  }

  @Test void futureWebhookFieldsAndTypesAreAccepted() throws Exception {
    for (JsonElement item : Fixtures.read("webhooks.json").getAsJsonObject().getAsJsonArray("parsing")) {
      JsonObject f = item.getAsJsonObject();
      Models.WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(
        f.get("body").getAsString().getBytes(StandardCharsets.UTF_8), f.get("signature").getAsString(),
        f.get("timestamp").getAsString(), f.get("secret").getAsString(), f.get("now").getAsLong(), 300);
      assertEquals(f.get("expectedType").getAsString(), event.type());
      assertEquals(f.get("expectedFactKey").getAsString(), event.data().facts().get(0).key());
    }
  }

  @Test void webhookPayloadContracts() throws Exception {
    var payloads = Fixtures.read("webhooks.json").getAsJsonObject().getAsJsonArray("payloads");
    assertTrue(payloads.size() >= 2);
    for (JsonElement item : payloads) {
      JsonObject expected = item.getAsJsonObject().getAsJsonObject("payload");
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
    }
  }

  private static String string(JsonObject object, String name) {
    JsonElement value = object.get(name);
    return value == null || value.isJsonNull() ? null : value.getAsString();
  }

  private static void assertEventAsset(JsonObject expected, Models.EventAsset asset) {
    assertEquals(string(expected, "id"), asset.id());
    assertEquals(string(expected, "externalId"), asset.externalId());
    assertEquals(string(expected.getAsJsonObject("classification"), "status"), asset.classification().status().value());
    assertEquals(string(expected.getAsJsonObject("classification").getAsJsonObject("moderation"), "decision"), asset.classification().moderation().decision().value());
    assertEquals(string(expected.getAsJsonObject("classification").getAsJsonObject("moderation"), "action"), asset.classification().moderation().action());
    assertEquals(string(expected.getAsJsonObject("content"), "status"), asset.content().status().value());
  }

  @Test void invalidWebhookPayloads() {
    for (String body : new String[] {"", "not json", "[]", "{\"type\":\"asset.flagged\",\"data\":{}}",
        "{\"id\":\"event-1\",\"data\":{}}", "{\"id\":\"event-1\",\"type\":\"asset.flagged\"}",
        "{\"id\":\"event-1\",\"type\":\"asset.flagged\",\"data\":{}}"}) {
      CalmLensException error = assertThrows(CalmLensException.class, () -> CalmLensServerClient.readWebhookEvent(body), body);
      assertEquals(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, error.getCode(), body);
    }
    assertEquals(List.of(), CalmLensServerClient.readWebhookEvent("{\"id\":\"event-1\",\"type\":\"test.sent\",\"projectId\":\"project-1\",\"data\":{}}").data().facts());
  }

  @Test void webhookSignatureContracts() throws Exception {
    for (JsonElement item : Fixtures.read("webhooks.json").getAsJsonObject().getAsJsonArray("signatures")) {
      JsonObject v = item.getAsJsonObject();
      String header = CalmLensServerClient.createWebhookSignatureHeader(v.get("secret").getAsString(), v.get("timestamp").getAsString(), v.get("body").getAsString());
      assertEquals(v.get("signature").getAsString(), header);
    }
  }

  @Test void apiErrorsCarryStatusRequestIdHeadersAndDetails() {
    CalmLensServerClient client = client(request -> Fixtures.json(400,
        "{\"code\":\"test/error\",\"message\":\"bad\",\"details\":{\"field\":\"name\"},\"traceId\":\"trace\"}",
        Map.of("X-Request-Id", List.of("req_123"), "Retry-After", List.of("7"))));
    ApiException error = assertThrows(ApiException.class, () -> client.assets.retrieve(new Models.AssetId("asset")));
    assertEquals("test/error", error.getCode());
    assertEquals("[calmlens] bad", error.getMessage());
    assertEquals(400, error.getStatus());
    assertEquals("req_123", error.getRequestId());
    assertEquals("req_123", error.getHeaders().get("x-request-id").get(0));
    assertEquals(Duration.ofSeconds(7), error.getRetryAfter().orElseThrow());
    assertEquals("trace", error.getTraceId());
    assertEquals(Map.of("field", "name", "network", true, "traceId", "trace"), error.getDetails());
    assertFalse(error.isRetryable());
    assertFalse(error.isNotFound());
    ApiException missing = assertThrows(ApiException.class,
        () -> client(request -> Fixtures.json(404, "{\"code\":\"asset/not-found\"}")).assets.retrieve(new Models.AssetId("gone")));
    assertTrue(missing.isNotFound());
    ApiException html = assertThrows(ApiException.class,
        () -> client(request -> Fixtures.json(500, "<html>")).assets.retrieve(new Models.AssetId("asset")));
    assertEquals(ErrorCodes.SDK_HTTP_ERROR, html.getCode());
    assertEquals(500, html.getStatus());
  }

  @Test void argumentAndConfigurationErrorsHaveTheirOwnCodes() {
    CalmLensServerClient client = client(request -> fail("Validation made an HTTP request"));
    assertEquals(ErrorCodes.INVALID_UPLOAD_PAYLOAD, assertThrows(CalmLensException.class,
        () -> client.assets.create(new Models.SubmitAsset("x", new Models.Content().base64("!").mimeType("text/plain")))).getCode());
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/x/content/@one,imageTransform[format=avif]",
        client.cdn.getAssetUrl(new Models.CdnRequest("x").lens("one").transform("imageTransform[format=avif]")));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> client.assets.retrieve(new Models.AssetId(""))).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> client.assets.retrieve(null)).getCode());
    for (String value : List.of("a\r\nX-Injected: 1", "a\nb", "a\u0000b")) {
      CalmLensException error = assertThrows(CalmLensException.class,
          () -> client.cdn.serve(new Models.CdnRequest("x").init(new Models.HttpOptions().headers(Map.of("Range", value)))), value);
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
    }
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.cdn.serve(new Models.CdnRequest("x").init(new Models.HttpOptions().headers(Map.of("Host", "evil"))))).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.assets.create(Models.SubmitAsset.text("hi"), new RequestOptions().idempotencyKey("bad\nkey"))).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class, () -> CalmLensServerClient.builder("", "project").build()).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class, () -> CalmLensServerClient.builder("key", "project").maxRetries(-1).build()).getCode());
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a%2Fb/content", client.cdn.getAssetUrl(new Models.CdnRequest("a/b")));
  }

  @Test void typedImageTransformOptionsSerializeLikeJavaScriptNumbers() {
    CalmLensServerClient client = client(request -> fail("Building a URL made an HTTP request"));
    Models.Transform image = Models.Transform.image(new Models.ImageTransformOptions().width(640).blur(2.0).sharpen(0.25).format("webp"));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/content/imageTransform[blur=2,format=webp,sharpen=0.25,width=640]",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(image)));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/content/imageTransform[blur=1e%2B21,sharpen=1e-7]",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(Models.Transform.image(new Models.ImageTransformOptions().blur(1e21).sharpen(1e-7)))));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(Models.Transform.image(new Models.ImageTransformOptions().blur(Double.NaN))))).getCode());
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/content/@thumb,imageTransform[blur=2,format=webp,sharpen=0.25,width=640]",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").lens("thumb").transform(image)));
  }

  @Test void malformedAndOversizedResponsesAreInvalidResponses() {
    ApiException malformed = assertThrows(ApiException.class,
        () -> client(request -> Fixtures.json(200, "not-json")).assets.retrieve(new Models.AssetId("asset-1")));
    assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, malformed.getCode());
    // An asset without a processing or moderation status cannot be acted on.
    for (String body : new String[] {"{\"id\":\"asset-1\"}", "{\"id\":\"asset-1\",\"processing\":{\"status\":\"done\"}}",
        "{\"id\":\"asset-1\",\"moderation\":{\"status\":\"approved\"}}", "{\"id\":\"asset-1\",\"processing\":{},\"moderation\":{\"status\":\"approved\"}}"}) {
      ApiException noStatus = assertThrows(ApiException.class,
          () -> client(request -> Fixtures.json(200, body)).assets.retrieve(new Models.AssetId("asset-1")), body);
      assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, noStatus.getCode(), body);
    }
    Map<String, Object> described = Fixtures.asset("asset-1", "completed", "approved");
    described.put("description", "x".repeat(4096));
    String large = Fixtures.JSON.toJson(described);
    ApiException tooLarge = assertThrows(ApiException.class, () -> CalmLensServerClient.builder("key", "project").maxResponseBytes(1024)
        .transport(request -> Fixtures.json(200, large)).build().assets.retrieve(new Models.AssetId("asset-1")));
    assertEquals(ErrorCodes.SDK_RESPONSE_TOO_LARGE, tooLarge.getCode());
  }

  @Test void ensureLensesSendsLargeBatchesInConsecutiveRequests() {
    List<String> methods = new ArrayList<>();
    List<List<String>> sent = new ArrayList<>();
    CalmLensServerClient client = client(request -> {
      methods.add(request.method());
      JsonArray lenses = JsonParser.parseString(new String(Fixtures.body(request), StandardCharsets.UTF_8))
          .getAsJsonObject().getAsJsonArray("lenses");
      List<String> identifiers = new ArrayList<>();
      JsonArray returned = new JsonArray();
      for (JsonElement lens : lenses) {
        String identifier = lens.getAsJsonObject().get("identifier").getAsString();
        identifiers.add(identifier);
        JsonObject created = lens.getAsJsonObject().deepCopy();
        created.addProperty("id", "id-" + identifier);
        returned.add(created);
      }
      sent.add(identifiers);
      JsonObject body = new JsonObject();
      body.add("lenses", returned);
      return Fixtures.json(200, body.toString());
    });
    List<Models.LensDefinition> definitions = new ArrayList<>();
    List<String> expected = new ArrayList<>();
    for (int i = 0; i <= CalmLensServerClient.ENSURE_LENSES_MAX_PER_REQUEST; i++) {
      definitions.add(new Models.LensDefinition("lens-" + i, "Lens", "image", true, 1));
      expected.add("lens-" + i);
    }
    List<Models.Lens> result = client.ensureLenses(new Models.EnsureLenses(definitions));
    assertEquals(List.of("PUT", "PUT"), methods);
    assertEquals(List.of(expected.subList(0, 100), expected.subList(100, 101)), sent);
    assertEquals(expected, result.stream().map(Models.Lens::identifier).toList());
    assertEquals(expected.stream().map(identifier -> "id-" + identifier).toList(), result.stream().map(Models.Lens::id).toList());
  }
}
