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
    assertEquals("calmlens-java/" + CalmLensServerClient.VERSION + " (java/" + Runtime.version() + ")", agent[0]);
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

  /** The fields every SDK has are checked by errors.json and client-cases.json; these accessors are Java's own. */
  @Test void apiErrorsExposeTheirMessageHeadersAndTraceId() {
    CalmLensServerClient client = client(request -> Fixtures.json(400,
        "{\"code\":\"test/error\",\"message\":\"bad\",\"traceId\":\"trace\"}", Map.of("X-Request-Id", List.of("req_123"))));
    ApiException error = assertThrows(ApiException.class, () -> client.assets.retrieve(new Models.AssetId("asset")));
    assertEquals("[calmlens] bad", error.getMessage());
    assertEquals("req_123", error.getHeaders().get("x-request-id").get(0));
    assertEquals("trace", error.getTraceId());
    assertFalse(error.isNotFound());
    ApiException missing = assertThrows(ApiException.class,
        () -> client(request -> Fixtures.json(404, "{\"code\":\"asset/not-found\"}")).assets.retrieve(new Models.AssetId("gone")));
    assertTrue(missing.isNotFound());
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

  @Test void multipartSizesAreRefusedBeforeSendingWithoutAStatus() {
    CalmLensServerClient client = client(request -> fail("A refused part made an HTTP request"));
    int mib = 1024 * 1024;
    Map<String, org.junit.jupiter.api.function.Executable> refusals = new java.util.LinkedHashMap<>();
    refusals.put(ErrorCodes.INVALID_UPLOAD_PAYLOAD + " first", () -> client.assets.create(
        new Models.SubmitAsset().name("clip.mp4").part(Models.Content.bytes(new byte[mib], "video/mp4").partNumber(1).isFinal(false))));
    refusals.put(ErrorCodes.INVALID_UPLOAD_PAYLOAD + " later", () -> client.assets.uploadPart(
        new Models.UploadPart("asset-1", Models.Content.bytes(new byte[mib], "video/mp4").partNumber(2).isFinal(false))));
    refusals.put(ErrorCodes.MULTIPART_IMAGE_TOO_SMALL, () -> client.assets.create(
        new Models.SubmitAsset().name("small.png").part(Models.Content.bytes(new byte[mib], "image/png").partNumber(1).isFinal(true))));
    refusals.put(ErrorCodes.MULTIPART_IMAGE_TOO_LARGE, () -> client.assets.create(
        new Models.SubmitAsset().name("large.png").part(Models.Content.bytes(new byte[21 * mib], "image/png").partNumber(1).isFinal(false))));
    refusals.forEach((name, call) -> {
      CalmLensException error = assertThrows(CalmLensException.class, call, name);
      assertEquals(name.split(" ")[0], error.getCode(), name);
      assertEquals(0, error.getStatus(), name);
    });
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

  @Test void assetsWithoutTheirStatusesAreInvalidResponses() {
    // An asset without a processing or moderation status cannot be acted on.
    for (String body : new String[] {"{\"id\":\"asset-1\"}", "{\"id\":\"asset-1\",\"processing\":{\"status\":\"done\"}}",
        "{\"id\":\"asset-1\",\"moderation\":{\"status\":\"allowed\"}}", "{\"id\":\"asset-1\",\"processing\":{},\"moderation\":{\"status\":\"allowed\"}}"}) {
      ApiException noStatus = assertThrows(ApiException.class,
          () -> client(request -> Fixtures.json(200, body)).assets.retrieve(new Models.AssetId("asset-1")), body);
      assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, noStatus.getCode(), body);
    }
  }


  private static Transport.Response lensReply(Transport.Request request) throws java.io.IOException {
    JsonObject body = JsonParser.parseString(new String(Fixtures.body(request), StandardCharsets.UTF_8)).getAsJsonObject();
    for (JsonElement lens : body.getAsJsonArray("lenses")) lens.getAsJsonObject().addProperty("id", "id-" + lens.getAsJsonObject().get("identifier").getAsString());
    return Fixtures.json(200, body.toString());
  }

  @Test void concurrentEnsuresOfTheSameNewLensShareOneRequest() throws Exception {
    java.util.concurrent.CountDownLatch inRequest = new java.util.concurrent.CountDownLatch(1), release = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.atomic.AtomicInteger sent = new java.util.concurrent.atomic.AtomicInteger();
    CalmLensServerClient client = client(request -> {
      sent.incrementAndGet();
      inRequest.countDown();
      if (!release.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new java.io.IOException("not released");
      return lensReply(request);
    });
    Models.EnsureLenses definition = new Models.EnsureLenses(List.of(new Models.LensDefinition("thumb", "Thumbnail", "image", true, 1)));
    java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors.newFixedThreadPool(2);
    try {
      var first = executor.submit(() -> client.ensureLenses(definition));
      assertTrue(inRequest.await(5, java.util.concurrent.TimeUnit.SECONDS));
      Thread[] second = {null};
      var waiting = executor.submit(() -> { second[0] = Thread.currentThread(); return client.ensureLenses(definition); });
      // Let the second call reach the in-flight request (or, without sharing, a request of its own).
      long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
      while ((second[0] == null || second[0].getState() != Thread.State.WAITING && second[0].getState() != Thread.State.TIMED_WAITING) && System.nanoTime() < deadline)
        Thread.sleep(5);
      release.countDown();
      assertEquals(first.get(5, java.util.concurrent.TimeUnit.SECONDS), waiting.get(5, java.util.concurrent.TimeUnit.SECONDS));
      assertEquals(1, sent.get());
    } finally {
      executor.shutdownNow();
    }
  }

  @Test void derivedClientsUseTheirOwnRetriesAndShareTheLensCache() {
    List<String> methods = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").transport(request -> {
      methods.add(request.method());
      return request.method().equals("PUT") ? lensReply(request) : Fixtures.json(503, "{}");
    }).build(null, delay -> {});
    CalmLensServerClient patient = client.withRequestOptions(new RequestOptions().maxRetries(0).timeout(Duration.ofSeconds(5)));
    assertEquals(503, assertThrows(ApiException.class, () -> patient.assets.retrieve(new Models.AssetId("a"))).getStatus());
    assertEquals(List.of("GET"), methods);
    Models.EnsureLenses definition = new Models.EnsureLenses(List.of(new Models.LensDefinition("thumb", "Thumbnail", "image", true, 1)));
    Models.Lens lens = client.ensureLenses(definition).get(0);
    assertEquals(lens, patient.ensureLenses(definition).get(0));
    assertEquals(List.of("GET", "PUT"), methods);
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.withRequestOptions(new RequestOptions().idempotencyKey("one-call"))).getCode());
  }
}
