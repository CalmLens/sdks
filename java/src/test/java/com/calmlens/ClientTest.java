package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.*;
import com.calmlens.internal.ClientAccess;
import com.calmlens.models.Asset;
import com.calmlens.models.AssetModerationDecision;
import com.calmlens.models.ImageBorder;
import com.calmlens.models.ImageTransformOptions;
import com.calmlens.models.Lens;
import com.calmlens.models.LensType;
import com.calmlens.models.Quality;
import com.calmlens.params.AssetCreateParams;
import com.calmlens.params.AssetUploadPartParams;
import com.calmlens.params.CdnRequestParams;
import com.calmlens.params.Content;
import com.calmlens.params.HttpOptions;
import com.calmlens.params.LensCreateParams;
import com.calmlens.params.LensUpdateParams;
import com.calmlens.params.ModerationContextItemParams;
import com.calmlens.params.ModerationContextParams;
import com.calmlens.params.TextClassifyParams;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ClientTest {
  private static CalmLensServerClient client(Transport transport) {
    return CalmLensServerClient.builder().apiKey("key").projectId("project-1").transport(transport).build();
  }

  /** A client whose retries don't sleep. */
  static CalmLensServerClient client(CalmLensServerClient.Builder builder, Transport transport) {
    return ClientAccess.Holder.get().build(builder, transport, delay -> {}, System::nanoTime, CalmLensServerClient.DEFAULT_MAX_RETRIES, false);
  }

  /** A complete asset response with these classification and moderation statuses; {@code pending} sends a null decision. */
  static Map<String, Object> asset(String id, String classification, String decision) {
    Map<String, Object> asset = new LinkedHashMap<>();
    asset.put("id", id);
    asset.put("name", id);
    asset.put("projectId", "project-1");
    asset.put("type", "image");
    asset.put("metadata", List.of());
    asset.put("parentPages", List.of());
    asset.put("createdAt", 1700000000000L);
    asset.put("tags", List.of());
    asset.put("visibility", "private");
    asset.put("upload", Map.of("status", "completed"));
    Map<String, Object> moderation = new LinkedHashMap<>();
    moderation.put("decision", "pending".equals(decision) ? null : decision);
    moderation.put("manualReviews", List.of());
    moderation.put("flaggedCategories", List.of());
    moderation.put("regions", List.of());
    Map<String, Object> classified = new LinkedHashMap<>();
    classified.put("status", classification);
    classified.put("testInput", false);
    classified.put("moderation", moderation);
    asset.put("classification", classified);
    asset.put("content", Map.of("status", "stored"));
    return asset;
  }

  /** {@link #asset} as JSON, nulls kept. */
  static String assetJson(String id, String classification, String decision) { return Fixtures.WITH_NULLS.toJson(asset(id, classification, decision)); }

  private static final String ALLOWED = assetJson("a", "completed", "allowed");

  @Test void versionComesFromTheManifestAndIsSentAsUserAgent() throws Exception {
    Matcher version = Pattern.compile("<artifactId>calmlens-sdk</artifactId>\\s*<version>([^<]+)</version>").matcher(Files.readString(Path.of("pom.xml")));
    assertTrue(version.find());
    assertEquals(version.group(1), CalmLensServerClient.VERSION);
    String[] agent = {null};
    client(request -> { agent[0] = request.headers().get("User-Agent"); return Fixtures.json(200, ALLOWED); }).assets().retrieve("a");
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

  /** request-contract fixtures trim within the limit; the newest post is kept even when it alone is over it. */
  @Test void anOverLongNewestPostIsStillSentAlone() {
    String[] context = {null};
    CalmLensServerClient client = client(request -> {
      // Text goes as a JSON body, its context with it.
      context[0] = JsonParser.parseString(new String(Fixtures.body(request), StandardCharsets.UTF_8)).getAsJsonObject().get("context").toString();
      return Fixtures.json(200, ALLOWED);
    });
    String newest = "z".repeat(ModerationContextParams.USED_CHARACTERS + 1);
    client.text().classify(TextClassifyParams.builder().setText("Same to you").setContext(ModerationContextParams.of(List.of(
        ModerationContextItemParams.of("older", "user-1"), ModerationContextItemParams.of(newest)))).build());
    assertEquals(JsonParser.parseString("{\"items\":[{\"text\":\"" + newest + "\"}]}"), JsonParser.parseString(context[0]));
  }

  @Test void malformedContextIsRefusedBeforeSending() {
    CalmLensServerClient client = client(request -> fail("Sent a malformed context"));
    // A context without items, or a post without text, can't be built.
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class, () -> ModerationContextParams.builder().build()).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class,
        () -> ModerationContextItemParams.builder().setAuthorId("user-1").build()).getCode());
    // A null post is refused when sent.
    ModerationContextParams withNull = ModerationContextParams.of(java.util.Arrays.asList(ModerationContextItemParams.of("a"), null));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class,
        () -> client.assets().create(AssetCreateParams.builder().setName("reply").setUrl("https://example.com/9").setContext(withNull).build())).getCode());
  }

  /** The fields every SDK has are checked by errors.json and client-cases.json; these accessors are Java's own. */
  @Test void apiErrorsExposeTheirHeadersAndKind() {
    CalmLensServerClient client = client(request -> Fixtures.json(400,
        "{\"code\":\"test/error\",\"message\":\"bad\",\"requestId\":\"req_123\",\"details\":{}}", Map.of("X-Request-Id", List.of("req_123"))));
    BadRequestException error = assertThrows(BadRequestException.class, () -> client.assets().retrieve("asset"));
    assertEquals("test/error", error.getCode());
    assertEquals("req_123", error.getHeaders().get("x-request-id").get(0));
    assertFalse(error.isLocal());
    NotFoundException missing = assertThrows(NotFoundException.class,
        () -> client(request -> Fixtures.json(404, "{\"code\":\"asset/not-found\"}")).assets().retrieve("gone"));
    assertEquals(ErrorCodes.ASSET_NOT_FOUND, missing.getCode());
  }

  /** client-cases.json's body-request-ID case still sends the header, so the fallback is checked here. */
  @Test void anApiErrorWithoutARequestIdHeaderTakesItFromItsBody() {
    ApiException error = assertThrows(ApiException.class, () -> client(request -> Fixtures.json(404,
        "{\"code\":\"asset/not-found\",\"message\":\"gone\",\"requestId\":\"req_body\",\"details\":{}}")).assets().retrieve("gone"));
    assertEquals("req_body", error.getRequestId().orElseThrow());
    ApiException withHeader = assertThrows(ApiException.class, () -> client(request -> Fixtures.json(404,
        "{\"code\":\"asset/not-found\",\"message\":\"gone\",\"requestId\":\"req_body\",\"details\":{}}",
        Map.of("X-Request-Id", List.of("req_header")))).assets().retrieve("gone"));
    assertEquals("req_header", withHeader.getRequestId().orElseThrow());
  }

  @Test void errorKindsFollowTheStatus() {
    Map<Integer, Class<? extends ApiException>> kinds = new LinkedHashMap<>();
    kinds.put(400, BadRequestException.class);
    kinds.put(401, AuthenticationException.class);
    kinds.put(403, PermissionDeniedException.class);
    kinds.put(404, NotFoundException.class);
    kinds.put(409, ConflictException.class);
    kinds.put(413, PayloadTooLargeException.class);
    kinds.put(422, UnprocessableEntityException.class);
    kinds.put(429, RateLimitException.class);
    kinds.put(500, ServerException.class);
    kinds.put(503, ServerException.class);
    kinds.forEach((status, kind) -> {
      CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1").maxRetries(0)
          .transport(request -> Fixtures.json(status, "{\"code\":\"test/error\"}")).build();
      ApiException error = assertThrows(ApiException.class, () -> client.assets().retrieve("a"), "HTTP " + status);
      assertSame(kind, error.getClass(), "HTTP " + status);
      assertEquals(status, error.getStatus(), "HTTP " + status);
      assertEquals("test/error", error.getCode(), "HTTP " + status);
    });
    // Another status is a plain API error.
    ApiException teapot = assertThrows(ApiException.class, () -> client(request -> Fixtures.json(418, "{\"code\":\"test/error\"}")).assets().retrieve("a"));
    assertSame(ApiException.class, teapot.getClass());
  }

  @Test void aProxyErrorPageIsKeptAsTheBody() {
    String html = "<html><body><h1>502 Bad Gateway</h1></body></html>";
    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1").maxRetries(0)
        .transport(request -> new Transport.Response(502, Map.of("Content-Type", List.of("text/html")), html.getBytes(StandardCharsets.UTF_8))).build();
    ServerException error = assertThrows(ServerException.class, () -> client.assets().retrieve("a"));
    assertEquals(ErrorCodes.SDK_HTTP_ERROR, error.getCode());
    assertEquals(502, error.getStatus());
    assertEquals(html, error.getBody().orElseThrow());
    // A JSON error keeps its raw body too.
    String json = "{\"code\":\"asset/not-found\"}";
    assertEquals(json, assertThrows(NotFoundException.class, () -> client(request -> Fixtures.json(404, json)).assets().retrieve("a")).getBody().orElseThrow());
  }

  @Test void rawRequestsAreRetriedLikeTheSdksOwnCalls() {
    List<Transport.Request> sent = Collections.synchronizedList(new ArrayList<>());
    List<byte[]> bodies = Collections.synchronizedList(new ArrayList<>());
    Transport flaky = request -> {
      sent.add(request);
      bodies.add(Fixtures.body(request));
      return sent.size() % 2 == 1 ? Fixtures.json(503, "{\"code\":\"test/unavailable\"}")
          : Fixtures.json(200, "{\"ok\":true}", Map.of("X-Request-Id", List.of("req_raw")));
    };
    CalmLensServerClient client = client(CalmLensServerClient.builder().apiKey("key").projectId("project-1"), flaky);

    // A GET is retried, and its body returned.
    RawResponse response = client.request("GET", "/projects/project-1/things", Map.of("limit", "5"), null, null);
    assertEquals(200, response.getStatus());
    assertEquals(JsonParser.parseString("{\"ok\":true}"), response.getBody());
    assertEquals("req_raw", response.getRequestId().orElseThrow());
    assertEquals(2, sent.size());
    assertEquals("https://api.calmlens.com/v1/projects/project-1/things?limit=5", sent.get(0).uri().toString());
    assertEquals("key", sent.get(0).headers().get("X-Api-Key"));

    // A POST without an idempotency key is sent once.
    sent.clear();
    bodies.clear();
    ServerException error = assertThrows(ServerException.class, () -> client.request("POST", "/things", null, Map.of("name", "x"), null));
    assertEquals(503, error.getStatus());
    assertEquals("test/unavailable", error.getCode());
    assertEquals(1, sent.size());
    assertEquals(JsonParser.parseString("{\"name\":\"x\"}"), JsonParser.parseString(new String(bodies.get(0), StandardCharsets.UTF_8)));

    // With one it is retried, sending the same key each time.
    sent.clear();
    RawResponse retried = client.request("POST", "/things", null, Map.of("name", "x"), RequestOptions.builder().setIdempotencyKey("one").build());
    assertEquals(200, retried.getStatus());
    assertEquals(2, sent.size());
    assertEquals(List.of("one", "one"), sent.stream().map(request -> request.headers().get("Idempotency-Key")).toList());

    // Errors map to their kinds.
    assertThrows(NotFoundException.class, () -> client(request -> Fixtures.json(404, "{\"code\":\"asset/not-found\"}")).request("GET", "/assets/a"));
    // Paths must be beneath the base URL.
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class, () -> client.request("GET", "assets")).getCode());
    // The body reads as a model.
    Asset asset = client(request -> Fixtures.json(200, ALLOWED, Map.of("X-Request-Id", List.of("req_model")))).request("GET", "/assets/a").getBodyAs(Asset.class);
    assertSame(AssetModerationDecision.ALLOWED, asset.getClassification().getModeration().getDecision().orElseThrow());
    assertEquals("req_model", asset.getLastResponse().orElseThrow().getRequestId().orElseThrow());
  }

  @Test void theRequestListenerReceivesEveryAttempt() {
    List<RequestEvent> events = Collections.synchronizedList(new ArrayList<>());
    int[] calls = {0};
    Transport flaky = request -> ++calls[0] == 1
        ? Fixtures.json(503, "{\"code\":\"test/unavailable\"}", Map.of("X-Request-Id", List.of("req_1")))
        : Fixtures.json(200, ALLOWED, Map.of("X-Request-Id", List.of("req_2")));
    CalmLensServerClient client = client(CalmLensServerClient.builder().apiKey("key").projectId("project-1").requestListener(events::add), flaky);
    client.assets().retrieve("a");
    assertEquals(2, events.size());
    RequestEvent first = events.get(0), second = events.get(1);
    assertEquals("assets.retrieve", first.getOperation().orElseThrow());
    assertEquals("assets.retrieve", second.getOperation().orElseThrow());
    assertEquals(List.of("GET", "GET"), List.of(first.getMethod(), second.getMethod()));
    assertEquals(List.of("/v1/assets/a", "/v1/assets/a"), List.of(first.getPath(), second.getPath()));
    assertEquals(List.of(1, 2), List.of(first.getAttempt(), second.getAttempt()));
    assertEquals(List.of(503, 200), List.of(first.getStatus(), second.getStatus()));
    assertEquals("req_1", first.getRequestId().orElseThrow());
    assertEquals("req_2", second.getRequestId().orElseThrow());
    assertEquals("test/unavailable", first.getErrorCode().orElseThrow());
    assertTrue(second.getErrorCode().isEmpty());
    // The first attempt is retried after a delay; the last isn't.
    assertTrue(first.getDelay().orElseThrow().compareTo(Duration.ZERO) > 0, first.toString());
    assertTrue(second.getDelay().isEmpty());

    // Signed grants are redacted and queries left out.
    events.clear();
    CalmLensServerClient raw = client(CalmLensServerClient.builder().apiKey("key").projectId("project-1").requestListener(events::add),
        request -> Fixtures.json(200, "{}"));
    raw.request("GET", "/assets/project-1/sig_secretgrant/info", Map.of("token", "secret-query"), null, null);
    assertEquals(1, events.size());
    RequestEvent signed = events.get(0);
    assertTrue(signed.getOperation().isEmpty());
    assertFalse(signed.getPath().contains("secretgrant"), signed.getPath());
    assertFalse(signed.getPath().contains("?"), signed.getPath());
    assertFalse(signed.toString().contains("secret"), signed.toString());
    assertTrue(signed.getPath().startsWith("/v1/assets/project-1/sig_"), signed.getPath());
    assertTrue(signed.getPath().endsWith("/info"), signed.getPath());

    // A listener that throws doesn't fail the call.
    CalmLensServerClient throwing = client(CalmLensServerClient.builder().apiKey("key").projectId("project-1")
        .requestListener(event -> { throw new IllegalStateException("listener"); }), request -> Fixtures.json(200, ALLOWED));
    assertEquals("a", throwing.assets().retrieve("a").getId());
  }

  @Test void asyncCallsCompleteWithTheSameResultsAndErrors() throws Exception {
    try (CalmLensServerClient client = client(request -> request.uri().getPath().endsWith("/gone")
        ? Fixtures.json(404, "{\"code\":\"asset/not-found\"}") : Fixtures.json(200, ALLOWED))) {
      CompletableFuture<Asset> future = client.async().assets().retrieve("a");
      assertEquals(client.assets().retrieve("a"), future.get(5, TimeUnit.SECONDS));

      CompletableFuture<Asset> missing = client.async().assets().retrieve("gone");
      ExecutionException failed = assertThrows(ExecutionException.class, () -> missing.get(5, TimeUnit.SECONDS));
      assertInstanceOf(NotFoundException.class, failed.getCause());
      assertEquals(ErrorCodes.ASSET_NOT_FOUND, ((CalmLensException) failed.getCause()).getCode());
      CompletionException joined = assertThrows(CompletionException.class, missing::join);
      assertInstanceOf(NotFoundException.class, joined.getCause());

      RawResponse raw = client.async().request("GET", "/assets/a").get(5, TimeUnit.SECONDS);
      assertEquals(client.request("GET", "/assets/a").getBody(), raw.getBody());
      // An argument refused before sending fails the future the same way.
      ExecutionException refused = assertThrows(ExecutionException.class, () -> client.async().assets().retrieve("").get(5, TimeUnit.SECONDS));
      assertInstanceOf(InvalidArgumentException.class, refused.getCause());
    }
  }

  @Test void argumentAndConfigurationErrorsHaveTheirOwnCodes() {
    CalmLensServerClient client = client(request -> fail("Validation made an HTTP request"));
    assertEquals(ErrorCodes.INVALID_UPLOAD_PAYLOAD, assertThrows(CalmLensException.class,
        () -> client.assets().create(AssetCreateParams.builder().setName("x").setContent(Content.base64("!", "text/plain")).build())).getCode());
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/x/rendered/@one,format=avif,%5Bx%5D",
        client.cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("x").setResource("rendered").setLens("one").setTransform("format=avif,[x]").build()));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class, () -> client.assets().retrieve("")).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class, () -> client.assets().retrieve(null)).getCode());
    for (String value : List.of("a\r\nX-Injected: 1", "a\nb", "a\u0000b")) {
      CalmLensException error = assertThrows(CalmLensException.class,
          () -> client.cdn().serve(CdnRequestParams.builder().setAssetId("x").setInit(HttpOptions.builder().setHeaders(Map.of("Range", value)).build()).build()), value);
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
    }
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.cdn().serve(CdnRequestParams.builder().setAssetId("x").setInit(HttpOptions.builder().setHeaders(Map.of("Host", "evil")).build()).build())).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.assets().create(AssetCreateParams.builder().setName("hi").setContent(Content.text("hi")).build(),
            RequestOptions.builder().setIdempotencyKey("bad\nkey").build())).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(ConfigurationException.class,
        () -> CalmLensServerClient.builder().apiKey("").projectId("project").build()).getCode());
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(ConfigurationException.class,
        () -> CalmLensServerClient.builder().apiKey("key").projectId("project").maxRetries(-1).build()).getCode());
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a%2Fb", client.cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("a/b").build()));
  }

  @Test void multipartSizesAreRefusedBeforeSendingWithoutAStatus() {
    CalmLensServerClient client = client(request -> fail("A refused part made an HTTP request"));
    int mib = 1024 * 1024;
    Map<String, org.junit.jupiter.api.function.Executable> refusals = new LinkedHashMap<>();
    refusals.put(ErrorCodes.INVALID_UPLOAD_PAYLOAD + " first", () -> client.assets().create(AssetCreateParams.builder().setName("clip.mp4")
        .setPart(Content.bytes(new byte[mib], "video/mp4").withPartNumber(1).withIsFinal(false)).build()));
    refusals.put(ErrorCodes.INVALID_UPLOAD_PAYLOAD + " later", () -> client.assets().uploadPart("asset-1",
        AssetUploadPartParams.builder().setPart(Content.bytes(new byte[mib], "video/mp4").withPartNumber(2).withIsFinal(false)).build()));
    refusals.put(ErrorCodes.UPLOAD_TOO_LARGE, () -> client.assets().create(AssetCreateParams.builder().setName("large.png")
        .setPart(Content.bytes(new byte[21 * mib], "image/png").withPartNumber(1).withIsFinal(false)).build()));
    refusals.forEach((name, call) -> {
      CalmLensException error = assertThrows(CalmLensException.class, call, name);
      assertEquals(name.split(" ")[0], error.getCode(), name);
      assertEquals(0, error.getStatus(), name);
      assertTrue(error.isLocal(), name);
    });
  }

  @Test void oversizedOneRequestUploadsAreRefusedBeforeSending() {
    CalmLensServerClient client = client(request -> fail("A refused upload made an HTTP request"));
    long mib = 1024 * 1024;
    Map<String, Long> sizes = Map.of("image/png", 10 * mib + 1, "video/mp4", 50 * mib + 1, "application/pdf", 5000 * mib + 1);
    sizes.forEach((type, size) -> {
      // The stream is never read: its declared size is refused first.
      CalmLensException error = assertThrows(CalmLensException.class, () -> client.assets().create(AssetCreateParams.builder().setName("big")
          .setContent(Content.stream(new java.io.ByteArrayInputStream(new byte[0]), size, type)).build()), type);
      assertEquals(ErrorCodes.UPLOAD_TOO_LARGE, error.getCode(), type);
      assertEquals(Map.of("limitBytes", size - 1, "source", "plan"), error.getDetails(), type);
    });
  }

  private static String url(CalmLensServerClient client, ImageTransformOptions transform) {
    return client.cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("a").setResource("rendered").setTransform(transform).build());
  }

  @Test void typedImageTransformOptionsSerializeLikeJavaScriptNumbers() {
    CalmLensServerClient client = client(request -> fail("Building a URL made an HTTP request"));
    ImageTransformOptions image = new ImageTransformOptions().width(640).blur(2.0).sharpen(0.25).format("webp");
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/blur=2,format=webp,sharpen=0.25,width=640", url(client, image));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/blur=1e%2B21,sharpen=1e-7",
        url(client, new ImageTransformOptions().blur(1e21).sharpen(1e-7)));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> url(client, new ImageTransformOptions().blur(Double.NaN))).getCode());
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/@thumb,blur=2,format=webp,sharpen=0.25,width=640",
        client.cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("a").setResource("rendered").setLens("thumb").setTransform(image).build()));
    ImageTransformOptions quality = new ImageTransformOptions()
        .dpr(2.0).anim(false).quality(Quality.level("high")).background("#FFAA00").border(new ImageBorder("rgb(0, 0, 0)", null));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/anim=false,background=ffaa00,border.color=rgb%280%2C%200%2C%200%29,dpr=2,quality=high",
        url(client, quality));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> url(client, new ImageTransformOptions())).getCode());
  }

  @Test void assetsWithoutTheirStatusesAreInvalidResponses() {
    // An asset without its upload, classification, moderation or decision field cannot be acted on.
    Map<String, java.util.function.Consumer<Map<String, Object>>> removals = new LinkedHashMap<>();
    removals.put("upload", asset -> asset.remove("upload"));
    removals.put("classification", asset -> asset.remove("classification"));
    removals.put("classification.status", asset -> classification(asset).remove("status"));
    removals.put("moderation", asset -> classification(asset).remove("moderation"));
    removals.put("decision", asset -> moderation(asset).remove("decision"));
    removals.put("content", asset -> asset.remove("content"));
    removals.forEach((name, removal) -> {
      Map<String, Object> asset = asset("asset-1", "completed", "allowed");
      removal.accept(asset);
      String body = Fixtures.WITH_NULLS.toJson(asset);
      InvalidResponseException noStatus = assertThrows(InvalidResponseException.class,
          () -> client(request -> Fixtures.json(200, body)).assets().retrieve("asset-1"), name);
      assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, noStatus.getCode(), name);
      assertEquals(200, noStatus.getStatus(), name);
    });
    // A decision sent as null is a pending asset, not an invalid one.
    Asset pending = client(request -> Fixtures.json(200, assetJson("asset-1", "processing", "pending"))).assets().retrieve("asset-1");
    assertTrue(pending.getClassification().getModeration().getDecision().isEmpty());
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> classification(Map<String, Object> asset) { return (Map<String, Object>) asset.get("classification"); }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> moderation(Map<String, Object> asset) { return (Map<String, Object>) classification(asset).get("moderation"); }

  /** Answers an ensure with the lenses sent, each given an ID and the fields the API adds. */
  private static Transport.Response lensReply(Transport.Request request) throws java.io.IOException {
    JsonObject body = JsonParser.parseString(new String(Fixtures.body(request), StandardCharsets.UTF_8)).getAsJsonObject();
    for (JsonElement element : body.getAsJsonArray("lenses")) {
      JsonObject lens = element.getAsJsonObject();
      lens.addProperty("id", "id-" + lens.get("identifier").getAsString());
      if (!lens.has("active")) lens.addProperty("active", true);
      lens.addProperty("createdAt", 1700000000000L);
    }
    return Fixtures.json(200, body.toString());
  }

  private static LensCreateParams thumb(Boolean active) {
    LensCreateParams.Builder builder = LensCreateParams.builder().setIdentifier("thumb").setName("Thumbnail").setType(LensType.IMAGE);
    return (active == null ? builder : builder.setActive(active)).build();
  }

  @Test void concurrentEnsuresOfTheSameNewLensShareOneRequest() throws Exception {
    java.util.concurrent.CountDownLatch inRequest = new java.util.concurrent.CountDownLatch(1), release = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.atomic.AtomicInteger sent = new java.util.concurrent.atomic.AtomicInteger();
    CalmLensServerClient client = client(request -> {
      sent.incrementAndGet();
      inRequest.countDown();
      if (!release.await(5, TimeUnit.SECONDS)) throw new java.io.IOException("not released");
      return lensReply(request);
    });
    List<LensCreateParams> definition = List.of(thumb(true));
    java.util.concurrent.ExecutorService executor = java.util.concurrent.Executors.newFixedThreadPool(2);
    try {
      var first = executor.submit(() -> client.ensureLenses(definition));
      assertTrue(inRequest.await(5, TimeUnit.SECONDS));
      Thread[] second = {null};
      var waiting = executor.submit(() -> { second[0] = Thread.currentThread(); return client.ensureLenses(definition); });
      // Let the second call reach the in-flight request (or, without sharing, a request of its own).
      long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
      while ((second[0] == null || second[0].getState() != Thread.State.WAITING && second[0].getState() != Thread.State.TIMED_WAITING) && System.nanoTime() < deadline)
        Thread.sleep(5);
      release.countDown();
      assertEquals(first.get(5, TimeUnit.SECONDS), waiting.get(5, TimeUnit.SECONDS));
      assertEquals(1, sent.get());
    } finally {
      executor.shutdownNow();
    }
  }

  @Test void aDefinitionWithoutActiveSendsNoneAndSharesTheCacheWithAnActiveOne() {
    List<JsonObject> sent = new ArrayList<>();
    CalmLensServerClient client = client(request -> {
      sent.add(JsonParser.parseString(new String(Fixtures.body(request), StandardCharsets.UTF_8)).getAsJsonObject());
      return lensReply(request);
    });
    Lens lens = client.ensureLens(thumb(null));
    assertFalse(sent.get(0).getAsJsonArray("lenses").get(0).getAsJsonObject().has("active"));
    assertEquals(lens, client.ensureLens(thumb(true)));
    assertEquals(1, sent.size());
    client.ensureLens(thumb(false));
    assertEquals(2, sent.size());
  }

  @Test void aLensChangedThroughTheLensesResourceIsEnsuredAgain() {
    List<String> methods = new ArrayList<>();
    CalmLensServerClient client = client(request -> {
      methods.add(request.method());
      if (request.method().equals("PUT")) return lensReply(request);
      return Fixtures.json(200, request.method().equals("DELETE") ? "{}"
          : "{\"id\":\"id-thumb\",\"identifier\":\"thumb\",\"name\":\"Renamed\",\"type\":\"image\",\"active\":true,\"createdAt\":1700000000000}");
    });
    LensCreateParams thumb = thumb(true);
    client.ensureLens(thumb);
    client.ensureLens(thumb);
    assertEquals(List.of("PUT"), methods);
    client.lenses().update("id-thumb", LensUpdateParams.builder().setName("Renamed").build());
    client.ensureLens(thumb);
    assertEquals(List.of("PUT", "PATCH", "PUT"), methods);
    client.lenses().delete("id-thumb");
    client.ensureLens(thumb);
    assertEquals(List.of("PUT", "PATCH", "PUT", "DELETE", "PUT"), methods);
    client.lenses().create(thumb);
    client.ensureLens(thumb);
    assertEquals(List.of("PUT", "PATCH", "PUT", "DELETE", "PUT", "POST", "PUT"), methods);
  }

  @Test void derivedClientsUseTheirOwnRetriesAndShareTheLensCache() {
    List<String> methods = new ArrayList<>();
    CalmLensServerClient client = client(CalmLensServerClient.builder().apiKey("key").projectId("project-1"), request -> {
      methods.add(request.method());
      return request.method().equals("PUT") ? lensReply(request) : Fixtures.json(503, "{}");
    });
    CalmLensServerClient patient = client.withRequestOptions(RequestOptions.builder().setMaxRetries(0).setTimeout(Duration.ofSeconds(5)).build());
    assertEquals(503, assertThrows(ServerException.class, () -> patient.assets().retrieve("a")).getStatus());
    assertEquals(List.of("GET"), methods);
    List<LensCreateParams> definition = List.of(thumb(true));
    Lens lens = client.ensureLenses(definition).get(0);
    assertEquals(lens, patient.ensureLenses(definition).get(0));
    assertEquals(List.of("GET", "PUT"), methods);
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class,
        () -> client.withRequestOptions(RequestOptions.builder().setIdempotencyKey("one-call").build())).getCode());
  }
}
