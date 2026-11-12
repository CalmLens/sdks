package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.ApiException;
import com.calmlens.exception.CalmLensException;
import com.calmlens.exception.CancelledException;
import com.calmlens.exception.ConnectionException;
import com.calmlens.exception.InvalidArgumentException;
import com.calmlens.exception.ServerException;
import com.calmlens.exception.TimeoutException;
import com.calmlens.internal.ClientAccess;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.Asset;
import com.calmlens.models.AssetClassificationStatus;
import com.calmlens.models.AssetContentStatus;
import com.calmlens.models.AssetModerationDecision;
import com.calmlens.models.ContentRemovalReason;
import com.calmlens.models.EventsPage;
import com.calmlens.models.ExtractedTextType;
import com.calmlens.models.SafetyHoldReason;
import com.calmlens.models.SignedAssetUrl;
import com.calmlens.models.Visibility;
import com.calmlens.params.AssetCreateParams;
import com.calmlens.params.AssetUpdateParams;
import com.calmlens.params.AssetUploadPartParams;
import com.calmlens.params.CdnRequestParams;
import com.calmlens.params.CdnSignAssetUrlParams;
import com.calmlens.params.Content;
import com.calmlens.params.EventListParams;
import com.calmlens.params.HttpOptions;
import com.calmlens.params.ViewerClaims;
import com.google.gson.JsonParser;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RobustnessTest {
  private static final String ALLOWED = ClientTest.assetJson("asset", "completed", "allowed");

  /** Records requests and answers from {@code replies} in order; retries do not sleep but record delays. */
  private static final class Scripted implements Transport {
    final List<Transport.Request> requests = Collections.synchronizedList(new ArrayList<>());
    final List<byte[]> bodies = Collections.synchronizedList(new ArrayList<>());
    final List<Duration> delays = Collections.synchronizedList(new ArrayList<>());
    private final List<Function<Transport.Request, Transport.Response>> replies;

    @SafeVarargs Scripted(Function<Transport.Request, Transport.Response>... replies) { this.replies = List.of(replies); }

    @Override public Response send(Request request) throws IOException {
      requests.add(request);
      bodies.add(Fixtures.body(request));
      Transport.Response reply = replies.get(Math.min(requests.size(), replies.size()) - 1).apply(request);
      if (reply == null) throw new ConnectException("Connection refused");
      return reply;
    }

    CalmLensServerClient client() { return client(CalmLensServerClient.builder().apiKey("key").projectId("project")); }

    CalmLensServerClient client(CalmLensServerClient.Builder builder) {
      return ClientAccess.Holder.get().build(builder, this, delays::add, System::nanoTime, CalmLensServerClient.DEFAULT_MAX_RETRIES, false);
    }
  }

  private static Function<Transport.Request, Transport.Response> reply(int status, String body) { return request -> Fixtures.json(status, body); }

  private static Map<String, String> query(Transport.Request request) {
    return java.util.Arrays.stream(request.uri().getRawQuery().split("&")).map(pair -> pair.split("=", 2))
        .collect(Collectors.toMap(pair -> java.net.URLDecoder.decode(pair[0], StandardCharsets.UTF_8), pair -> java.net.URLDecoder.decode(pair[1], StandardCharsets.UTF_8)));
  }

  private static AssetCreateParams text(String text) {
    return AssetCreateParams.builder().setName("post.txt").setContent(Content.text(text)).build();
  }

  @Test void filesAndStreamsAreSentWithoutBuffering(@TempDir Path directory) throws Exception {
    Path file = directory.resolve("photo.png");
    byte[] data = new byte[300_000];
    for (int i = 0; i < data.length; i++) data[i] = (byte) (i * 31);
    Files.write(file, data);
    var transport = new Scripted(reply(200, ALLOWED), reply(503, "{}"));
    CalmLensServerClient client = transport.client();
    client.assets().create(AssetCreateParams.builder().setName("photo.png").setContent(Content.file(file, "image/png")).build());
    // The upload form streams the file from disk with a known length, and can be sent again.
    Transport.Request request = transport.requests.get(0);
    Transport.Body sent = request.body();
    assertNull(sent.bytes());
    assertTrue(sent.replayable());
    assertEquals(transport.bodies.get(0).length, sent.length());
    assertArrayEquals(data, UploadForm.read(transport.bodies.get(0), request.headers().get("Content-Type")).file());
    assertEquals(Integer.toString(data.length), query(transport.requests.get(0)).get("sizeInBytes"));

    // A stream can be read once, so a request carrying it is not retried.
    InputStream stream = new ByteArrayInputStream(data);
    assertThrows(ServerException.class, () -> client.assets().create(
        AssetCreateParams.builder().setName("photo.png").setContent(Content.stream(stream, data.length, "image/png")).build()));
    assertEquals(2, transport.requests.size());
    assertFalse(transport.requests.get(1).body().replayable());
    assertArrayEquals(data, UploadForm.read(transport.bodies.get(1), transport.requests.get(1).headers().get("Content-Type")).file());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(InvalidArgumentException.class, () -> client.assets().create(
        AssetCreateParams.builder().setName("photo.png").setContent(Content.file(directory.resolve("missing.png"), "image/png")).build())).getCode());
  }

  @Test void unrelatedModerationAndPartsRunConcurrently() throws Exception {
    for (boolean parts : new boolean[] {false, true}) {
      CountDownLatch entered = new CountDownLatch(2);
      CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project").transport(request -> {
        entered.countDown();
        if (!entered.await(2, TimeUnit.SECONDS)) throw new IOException("Requests were serialized");
        return Fixtures.json(200, ALLOWED);
      }).build();
      ExecutorService executor = Executors.newFixedThreadPool(2);
      try {
        List<Future<Asset>> futures = new ArrayList<>();
        for (String id : List.of("one", "two"))
          futures.add(executor.submit(() -> parts
              ? client.assets().uploadPart(id, AssetUploadPartParams.builder().setPart(Content.text("final").withPartNumber(2).withIsFinal(true)).build())
              : client.assets().classify(text("hello"))));
        for (var future : futures)
          assertSame(AssetModerationDecision.ALLOWED, future.get(3, TimeUnit.SECONDS).getClassification().getModeration().getDecision().orElseThrow());
      } finally {
        executor.shutdownNow();
      }
    }
  }

  @Test void clearAndOmitHaveDifferentWireRepresentations() throws Exception {
    var transport = new Scripted(reply(200, ALLOWED));
    transport.client().assets().update("asset", AssetUpdateParams.builder().clearDescription().setTags(List.of()).build());
    var patch = JsonParser.parseString(new String(transport.bodies.get(0), StandardCharsets.UTF_8)).getAsJsonObject();
    assertTrue(patch.get("description").isJsonNull());
    assertFalse(patch.has("name"));
    assertEquals(0, patch.getAsJsonArray("tags").size());
  }

  @Test void unknownValuesAndLargeNumbersSurviveDecoding() {
    Map<String, Object> fields = ClientTest.asset("asset", "paused", "escalated");
    fields.put("content", Map.of("status", "archived", "removalReason", "expired"));
    fields.put("visibility", "unlisted");
    fields.put("futureField", Map.of("a", 1));
    fields.put("metadata", List.of(Map.of("id", "big", "value", 9007199254740993L), Map.of("id", "small", "value", 5), Map.of("id", "ratio", "value", 0.5)));
    fields.put("createdAt", 1700000000123L);
    Asset asset = new Scripted(reply(200, Fixtures.WITH_NULLS.toJson(fields))).client().assets().retrieve("asset");
    assertSame(AssetClassificationStatus.UNKNOWN, asset.getClassification().getStatus());
    assertEquals("paused", asset.getClassification().getRawJsonObject().get("status").getAsString());
    assertSame(AssetModerationDecision.UNKNOWN, asset.getClassification().getModeration().getDecision().orElseThrow());
    assertEquals("escalated", asset.getClassification().getModeration().getRawJsonObject().get("decision").getAsString());
    assertSame(AssetContentStatus.UNKNOWN, asset.getContent().getStatus());
    assertEquals("archived", asset.getContent().getRawJsonObject().get("status").getAsString());
    assertSame(ContentRemovalReason.UNKNOWN, asset.getContent().getRemovalReason().orElseThrow());
    assertEquals("expired", asset.getContent().getRawJsonObject().get("removalReason").getAsString());
    assertSame(Visibility.UNKNOWN, asset.getVisibility());
    assertEquals("unlisted", asset.getRawJsonObject().get("visibility").getAsString());
    assertEquals(JsonParser.parseString("{\"a\":1}"), asset.getAdditionalProperties().get("futureField"));
    assertEquals(9007199254740993L, asset.getMetadata().get(0).getValue());
    assertEquals(5L, asset.getMetadata().get(1).getValue());
    assertEquals(0.5, asset.getMetadata().get(2).getValue());
    assertEquals(java.time.Instant.ofEpochMilli(1700000000123L), asset.getCreatedAt());
    assertSame(AssetModerationDecision.AGE_RESTRICTED, AssetModerationDecision.fromValue("age-restricted"));
    assertSame(AssetModerationDecision.LIMITED, AssetModerationDecision.fromValue("limited"));
    assertSame(AssetClassificationStatus.FAILED, AssetClassificationStatus.fromValue("failed"));
    assertSame(AssetContentStatus.REMOVED, AssetContentStatus.fromValue("removed"));
    assertThrows(UnsupportedOperationException.class, () -> asset.getMetadata().clear());
  }

  @Test void secretsNeverAppearInStringForms() {
    CalmLensServerClient.Builder builder = CalmLensServerClient.builder().apiKey("sk_live_secret").projectId("project");
    var transport = new Scripted(reply(200, "{\"url\":\"https://cdn.example/v1/assets/project/sig_secret\",\"expiresAt\":1}"));
    CalmLensServerClient client = transport.client(builder);
    SignedAssetUrl signed = client.cdn().signAssetUrl(CdnSignAssetUrlParams.builder().setAssetId("a").setResource("rendered")
        .setViewerClaims(ViewerClaims.builder().setAgeConfirmed(true).build()).build());
    assertEquals("https://cdn.example/v1/assets/project/sig_secret/rendered?viewerClaims=%7B%22ageConfirmed%22%3Atrue%7D", signed.getUrl());
    for (String text : List.of(client.toString(), builder.toString(), transport.requests.get(0).toString(), signed.toString())) {
      assertFalse(text.contains("sk_live_secret"), text);
      assertFalse(text.contains("sig_secret"), text);
    }
    assertEquals("sk_live_secret", transport.requests.get(0).headers().get("X-Api-Key"));
  }

  private static String event(String id, String facts) {
    return "{\"id\":\"" + id + "\",\"projectId\":\"project\",\"actor\":{\"type\":\"system\"},\"type\":\"asset.classified\",\"severity\":\"low\","
        + "\"title\":\"Classified\",\"facts\":" + facts + ",\"createdAt\":1700000000000}";
  }

  /** client-cases.json covers the pages and requests; {@code AutoPager.cursor()} is Java's own. */
  @Test void theEventPagerKeepsTheLatestCursor() {
    var events = new Scripted(
        reply(200, "{\"items\":[" + event("e1", "[]") + "],\"nextCursor\":\"c1\",\"hasMore\":true,\"excludedTypes\":[]}"),
        reply(200, "{\"items\":[" + event("e2", "[{\"key\":\"test\",\"value\":true}]") + "],\"nextCursor\":\"c2\",\"hasMore\":false,\"excludedTypes\":[]}"));
    AutoPager<EventsPage> feed = events.client().events().pages(EventListParams.builder().setCursor("c0").setPageSize(1).build());
    List<String> ids = new ArrayList<>();
    List<String> cursors = new ArrayList<>();
    for (EventsPage page : feed) {
      page.getItems().forEach(event -> ids.add(event.getId()));
      cursors.add(page.getNextCursor());
    }
    assertEquals(List.of("e1", "e2"), ids);
    assertEquals(List.of("c1", "c2"), cursors);
    assertEquals("c2", feed.cursor());
    assertEquals("c0", query(events.requests.get(0)).get("cursor"));
    assertEquals("c1", query(events.requests.get(1)).get("cursor"));
    var fact = events.client().events().list(EventListParams.builder().build()).getItems().get(0).getFacts().get(0);
    assertEquals("test", fact.getKey());
    assertEquals(true, fact.getValue());
  }

  @Test void closedClientsRefuseRequests() {
    var transport = new Scripted(reply(200, ALLOWED));
    CalmLensServerClient client = transport.client();
    client.close();
    client.close();
    assertEquals(ErrorCodes.SDK_CLIENT_CLOSED, assertThrows(CalmLensException.class, () -> client.assets().retrieve("a")).getCode());
    assertEquals(0, transport.requests.size());
  }

  @Test void stalledResponseBodiesTimeOut() {
    CountDownLatch release = new CountDownLatch(1);
    InputStream stalled = new InputStream() {
      private volatile boolean closed;
      @Override public int read() throws IOException {
        try { while (!closed && !release.await(10, TimeUnit.MILLISECONDS)) { } } catch (InterruptedException e) { throw new IOException(e); }
        if (closed) throw new IOException("closed");
        return -1;
      }
      @Override public void close() { closed = true; }
    };
    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project").timeout(Duration.ofMillis(200)).maxRetries(0)
        .transport(request -> new Transport.Response(200, Map.of(), stalled)).build();
    try {
      long started = System.nanoTime();
      TimeoutException timeout = assertThrows(TimeoutException.class, () -> client.assets().retrieve("a"));
      assertEquals(ErrorCodes.SDK_TIMEOUT, timeout.getCode());
      assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(5)) < 0);
    } finally {
      release.countDown();
    }
  }

  @Test void cdnStreamsAreNotBufferedAndFailWhenIdle() throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    boolean[] closed = {false};
    InputStream body = new InputStream() {
      private int sent;
      @Override public int read() throws IOException {
        if (sent++ == 0) return 'x';
        try { while (!closed[0] && !release.await(10, TimeUnit.MILLISECONDS)) { } } catch (InterruptedException e) { throw new IOException(e); }
        throw new IOException("closed");
      }
      @Override public void close() { closed[0] = true; }
    };
    var transport = new Scripted(request -> new Transport.Response(206, Map.of("Content-Type", List.of("video/mp4")), body));
    CalmLensServerClient client = transport.client();
    try (CdnResponse response = client.cdn().serve(CdnRequestParams.builder().setAssetId("asset").setInit(HttpOptions.builder().setMethod("HEAD")
        .setHeaders(Map.of("Range", "bytes=0-3", "X-Api-Key", "override")).build()).build(), RequestOptions.builder().setTimeout(Duration.ofMillis(200)).build())) {
      assertEquals("HEAD", transport.requests.get(0).method());
      assertEquals("bytes=0-3", transport.requests.get(0).headers().get("Range"));
      assertEquals("key", transport.requests.get(0).headers().get("X-Api-Key"));
      assertEquals(206, response.status());
      assertEquals("video/mp4", response.header("content-type"));
      assertEquals('x', response.body().read());
      assertThrows(HttpTimeoutException.class, () -> response.body().read());
    } finally {
      release.countDown();
    }
    assertTrue(closed[0]);
  }

  @Test void transportErrorsPreserveCauseAndInterrupt() {
    IOException cause = new IOException("offline");
    var error = assertThrows(ConnectionException.class, () -> CalmLensServerClient.builder().apiKey("key").projectId("project").maxRetries(0)
        .transport(request -> { throw cause; }).build().assets().classify(text("hello")));
    assertEquals(ErrorCodes.SDK_TRANSPORT_ERROR, error.getCode());
    assertSame(cause, error.getCause());
    var interrupted = CalmLensServerClient.builder().apiKey("key").projectId("project").transport(request -> { throw new InterruptedException(); }).build();
    try {
      assertEquals(ErrorCodes.SDK_CANCELLED, assertThrows(CancelledException.class, () -> interrupted.assets().classify(text("hello"))).getCode());
      assertTrue(Thread.currentThread().isInterrupted());
    } finally {
      Thread.interrupted();
    }
  }

  @Test void waitForDecisionPollsWithGrowingDelaysUntilTheAssetIsDecided() {
    String pending = ClientTest.assetJson("asset", "processing", "pending");
    var transport = new Scripted(reply(200, pending), reply(200, pending), reply(200, pending), reply(200, pending), reply(200, pending),
        reply(200, pending), reply(200, pending), reply(200, pending), reply(200, ClientTest.assetJson("asset", "completed", "blocked")));
    Asset asset = transport.client().assets().waitForDecision("asset");
    assertEquals("asset", asset.getId());
    assertSame(AssetModerationDecision.BLOCKED, asset.getClassification().getModeration().getDecision().orElseThrow());
    assertEquals(9, transport.requests.size());
    for (Transport.Request request : transport.requests) {
      assertEquals("GET", request.method());
      assertEquals("/v1/assets/asset", request.uri().getPath());
    }
    assertEquals(List.of(Duration.ofMillis(500), Duration.ofMillis(750), Duration.ofMillis(1125), Duration.ofNanos(1_687_500_000),
        Duration.ofSeconds(2), Duration.ofSeconds(2), Duration.ofSeconds(2), Duration.ofSeconds(2)), transport.delays);
  }

  @Test void waitForDecisionStopsWhenTheThreadIsInterrupted() {
    var transport = new Scripted(reply(200, ClientTest.assetJson("asset", "processing", "pending")));
    var client = ClientAccess.Holder.get().build(CalmLensServerClient.builder().apiKey("key").projectId("project"), transport,
        delay -> { throw new InterruptedException(); }, System::nanoTime, CalmLensServerClient.DEFAULT_MAX_RETRIES, false);
    try {
      assertEquals(ErrorCodes.SDK_CANCELLED, assertThrows(CancelledException.class, () -> client.assets().waitForDecision("asset")).getCode());
      assertTrue(Thread.currentThread().isInterrupted());
      assertEquals(1, transport.requests.size());
      // Already interrupted: nothing is sent.
      assertEquals(ErrorCodes.SDK_CANCELLED, assertThrows(CancelledException.class, () -> client.assets().waitForDecision("asset")).getCode());
      assertTrue(Thread.currentThread().isInterrupted());
      assertEquals(1, transport.requests.size());
    } finally {
      Thread.interrupted();
    }
  }

  @Test void nativeResponseModelsRetainDocumentAndHoldFields() {
    Map<String, Object> held = ClientTest.asset("asset", "completed", "allowed");
    held.put("content", Map.of("status", "stored", "extractedText", Map.of("type", "string", "content", "document text"),
        "safetyHold", Map.of("placedAt", 100, "disposedAt", 200, "reason", "suspected-illegal-content")));
    Asset asset = new Scripted(reply(200, Fixtures.WITH_NULLS.toJson(held))).client().assets().retrieve("asset");
    var text = asset.getContent().getExtractedText().orElseThrow();
    assertSame(ExtractedTextType.STRING, text.getType());
    assertEquals("document text", text.getContent().orElseThrow());
    var hold = asset.getContent().getSafetyHold().orElseThrow();
    assertSame(SafetyHoldReason.SUSPECTED_ILLEGAL_CONTENT, hold.getReason());
    assertEquals(java.time.Instant.ofEpochMilli(100), hold.getPlacedAt());
    assertEquals(java.time.Instant.ofEpochMilli(200), hold.getDisposedAt().orElseThrow());
  }
}
