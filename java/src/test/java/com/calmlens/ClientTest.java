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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ClientTest {
  private static CalmLensServerClient client(Transport transport) {
    return CalmLensServerClient.builder("key", "project-1").transport(transport).build();
  }

  @Test void versionComesFromTheManifestAndIsSentAsUserAgent() throws Exception {
    Matcher version = Pattern.compile("<artifactId>calmlens-sdk</artifactId>\\s*<version>([^<]+)</version>").matcher(Files.readString(Path.of("pom.xml")));
    assertTrue(version.find());
    assertEquals(version.group(1), CalmLensServerClient.VERSION);
    String[] agent = {null};
    client(request -> { agent[0] = request.headers().get("User-Agent"); return Fixtures.json(200, Fixtures.assetJson("a", "completed", "allowed")); })
        .assets.retrieve(new Models.AssetId("a"));
    assertEquals("calmlens-java/" + CalmLensServerClient.VERSION + " (Java " + Runtime.version() + ")", agent[0]);
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

  @Test void invalidWebhookPayloads() {
    for (String body : new String[] {"", "not json", "[]", "{\"type\":\"asset.classified\",\"data\":{}}",
        "{\"id\":\"event-1\",\"data\":{}}", "{\"id\":\"event-1\",\"type\":\"asset.classified\"}",
        "{\"id\":\"event-1\",\"type\":\"asset.classified\",\"data\":{}}"}) {
      CalmLensException error = assertThrows(CalmLensException.class, () -> CalmLensServerClient.readWebhookEvent(body), body);
      assertEquals(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, error.getCode(), body);
    }
    assertEquals(List.of(), CalmLensServerClient.readWebhookEvent("{\"id\":\"event-1\",\"type\":\"test.sent\",\"projectId\":\"project-1\",\"data\":{}}").data().facts());
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
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/x/rendered/@one/format=avif/%5Bx%5D",
        client.cdn.getAssetUrl(new Models.CdnRequest("x").lens("one").transform("format=avif/[x]")));
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
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a%2Fb/rendered", client.cdn.getAssetUrl(new Models.CdnRequest("a/b")));
  }

  @Test void typedImageTransformOptionsSerializeLikeJavaScriptNumbers() {
    CalmLensServerClient client = client(request -> fail("Building a URL made an HTTP request"));
    Models.Transform image = Models.Transform.image(new Models.ImageTransformOptions().width(640).blur(2.0).sharpen(0.25).format("webp"));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/blur=2,format=webp,sharpen=0.25,width=640",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(image)));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/blur=1e%2B21,sharpen=1e-7",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(Models.Transform.image(new Models.ImageTransformOptions().blur(1e21).sharpen(1e-7)))));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(Models.Transform.image(new Models.ImageTransformOptions().blur(Double.NaN))))).getCode());
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/@thumb/blur=2,format=webp,sharpen=0.25,width=640",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").lens("thumb").transform(image)));
    Models.Transform quality = Models.Transform.image(new Models.ImageTransformOptions()
        .dpr(2.0).anim(false).quality(Models.Quality.level("high")).background("#FFAA00"));
    Models.Transform numeric = Models.Transform.image(new Models.ImageTransformOptions()
        .quality(Models.Quality.of(80)).border(new Models.ImageBorder("rgb(0, 0, 0)", null)));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/anim=false,background=ffaa00,dpr=2,quality=high/border.color=rgb%280%2C%200%2C%200%29,quality=80",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(List.of(quality, numeric))));
  }

  @Test void malformedAndOversizedResponsesAreInvalidResponses() {
    ApiException malformed = assertThrows(ApiException.class,
        () -> client(request -> Fixtures.json(200, "not-json")).assets.retrieve(new Models.AssetId("asset-1")));
    assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, malformed.getCode());
    // An asset without a processing or moderation status cannot be acted on.
    for (String body : new String[] {"{\"id\":\"asset-1\"}", "{\"id\":\"asset-1\",\"processing\":{\"status\":\"done\"}}",
        "{\"id\":\"asset-1\",\"moderation\":{\"status\":\"allowed\"}}", "{\"id\":\"asset-1\",\"processing\":{},\"moderation\":{\"status\":\"allowed\"}}"}) {
      ApiException noStatus = assertThrows(ApiException.class,
          () -> client(request -> Fixtures.json(200, body)).assets.retrieve(new Models.AssetId("asset-1")), body);
      assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, noStatus.getCode(), body);
    }
    Map<String, Object> described = Fixtures.asset("asset-1", "completed", "allowed");
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
