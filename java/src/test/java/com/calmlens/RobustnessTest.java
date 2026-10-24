package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

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
  private static final String ALLOWED = Fixtures.assetJson("asset", "completed", "allowed");

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

    CalmLensServerClient client() { return client(CalmLensServerClient.builder("key", "project")); }

    CalmLensServerClient client(CalmLensServerClient.Builder builder) { return builder.build(this, delays::add); }
  }

  private static Function<Transport.Request, Transport.Response> reply(int status, String body) { return request -> Fixtures.json(status, body); }

  private static Function<Transport.Request, Transport.Response> reply(int status, String body, String retryAfter) {
    return request -> Fixtures.json(status, body, Map.of("Retry-After", List.of(retryAfter)));
  }

  private static Map<String, String> query(Transport.Request request) {
    return java.util.Arrays.stream(request.uri().getRawQuery().split("&")).map(pair -> pair.split("=", 2))
        .collect(Collectors.toMap(pair -> java.net.URLDecoder.decode(pair[0], StandardCharsets.UTF_8), pair -> java.net.URLDecoder.decode(pair[1], StandardCharsets.UTF_8)));
  }

  @Test void filesAndStreamsAreSentWithoutBuffering(@TempDir Path directory) throws Exception {
    Path file = directory.resolve("photo.png");
    byte[] data = new byte[300_000];
    for (int i = 0; i < data.length; i++) data[i] = (byte) (i * 31);
    Files.write(file, data);
    var transport = new Scripted(reply(200, ALLOWED), reply(503, "{}"));
    CalmLensServerClient client = transport.client();
    client.assets.create(new Models.SubmitAsset("photo.png", Models.Content.file(file, "image/png")));
    Transport.Body sent = transport.requests.get(0).body();
    assertEquals(file, sent.file());
    assertNull(sent.bytes());
    assertArrayEquals(data, transport.bodies.get(0));
    assertEquals(Integer.toString(data.length), query(transport.requests.get(0)).get("sizeInBytes"));

    // A stream can be read once, so a request carrying it is not retried.
    InputStream stream = new ByteArrayInputStream(data);
    assertThrows(ApiException.class, () -> client.assets.create(new Models.SubmitAsset("photo.png", Models.Content.stream(stream, data.length, "image/png"))));
    assertEquals(2, transport.requests.size());
    assertArrayEquals(data, transport.bodies.get(1));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class,
        () -> client.assets.create(new Models.SubmitAsset("photo.png", Models.Content.file(directory.resolve("missing.png"), "image/png")))).getCode());
  }

  @Test void unrelatedModerationAndPartsRunConcurrently() throws Exception {
    for (boolean parts : new boolean[] {false, true}) {
      CountDownLatch entered = new CountDownLatch(2);
      CalmLensServerClient client = CalmLensServerClient.builder("key", "project").transport(request -> {
        entered.countDown();
        if (!entered.await(2, TimeUnit.SECONDS)) throw new IOException("Requests were serialized");
        return Fixtures.json(200, ALLOWED);
      }).build();
      ExecutorService executor = Executors.newFixedThreadPool(2);
      try {
        List<Future<Models.Asset>> futures = new ArrayList<>();
        for (String id : List.of("one", "two"))
          futures.add(executor.submit(() -> parts
              ? client.assets.uploadPart(new Models.UploadPart(id, Models.Content.text("final").partNumber(2).isFinal(true)))
              : client.assets.classify(Models.SubmitAsset.text("hello"))));
        for (var future : futures) assertEquals(Models.AssetModerationStatus.ALLOWED, future.get(3, TimeUnit.SECONDS).classification().moderation().status());
      } finally {
        executor.shutdownNow();
      }
    }
  }

  @Test void clearAndOmitHaveDifferentWireRepresentations() throws Exception {
    var transport = new Scripted(reply(200, ALLOWED));
    transport.client().assets.update(new Models.UpdateAsset("asset").description(Models.Patch.clear()).tags(Models.Patch.value(List.of())));
    var patch = JsonParser.parseString(new String(transport.bodies.get(0), StandardCharsets.UTF_8)).getAsJsonObject();
    assertTrue(patch.get("description").isJsonNull());
    assertFalse(patch.has("name"));
    assertEquals(0, patch.getAsJsonArray("tags").size());
  }

  @Test void unknownValuesAndLargeNumbersSurviveDecoding() {
    String body = "{\"id\":\"asset\",\"upload\":{\"status\":\"completed\"},\"classification\":{\"status\":\"paused\",\"moderation\":{\"status\":\"escalated\"}},"
        + "\"content\":{\"status\":\"archived\",\"removalReason\":\"expired\"},\"visibility\":\"unlisted\",\"futureField\":{\"a\":1},"
        + "\"metadata\":[{\"id\":\"big\",\"value\":9007199254740993},{\"id\":\"small\",\"value\":5},{\"id\":\"ratio\",\"value\":0.5}],"
        + "\"createdAt\":1700000000123}";
    Models.Asset asset = new Scripted(reply(200, body)).client().assets.retrieve(new Models.AssetId("asset"));
    assertEquals("paused", asset.classification().status().value());
    assertFalse(asset.classification().status().isKnown());
    assertEquals("escalated", asset.classification().moderation().status().value());
    assertFalse(asset.classification().moderation().status().isKnown());
    assertNotEquals(Models.AssetModerationStatus.ALLOWED, asset.classification().moderation().status());
    assertEquals("archived", asset.content().status().value());
    assertFalse(asset.content().status().isKnown());
    assertEquals("expired", asset.content().removalReason());
    assertEquals("unlisted", asset.visibility().value());
    assertEquals(9007199254740993L, asset.metadata().get(0).value());
    assertEquals(5L, asset.metadata().get(1).value());
    assertEquals(0.5, asset.metadata().get(2).value());
    assertEquals(java.time.Instant.ofEpochMilli(1700000000123L), asset.createdAt());
    assertSame(Models.AssetModerationStatus.AGE_RESTRICTED, Models.AssetModerationStatus.of("age-restricted"));
    assertSame(Models.AssetModerationStatus.LIMITED, Models.AssetModerationStatus.of("limited"));
    assertSame(Models.AssetModerationDecision.LIMITED, Models.AssetModerationDecision.of("limited"));
    assertSame(Models.AssetClassificationStatus.FAILED, Models.AssetClassificationStatus.of("failed"));
    assertSame(Models.AssetContentStatus.REMOVED, Models.AssetContentStatus.of("removed"));
    assertThrows(UnsupportedOperationException.class, () -> asset.metadata().add(new Models.MetadataItem("x", 1)));
  }

  @Test void secretsNeverAppearInStringForms() {
    CalmLensServerClient.Builder builder = CalmLensServerClient.builder("sk_live_secret", "project");
    var transport = new Scripted(reply(200, "{\"url\":\"https://cdn.example/a?signature=sig_secret\",\"expiresAt\":1}"));
    CalmLensServerClient client = transport.client(builder);
    Models.SignedUrl signed = client.assets.createSignedUrl(new Models.SignedUrlOptions("a"));
    assertEquals("https://cdn.example/a?signature=sig_secret", signed.url());
    for (String text : List.of(client.toString(), builder.toString(), transport.requests.get(0).toString(), signed.toString())) {
      assertFalse(text.contains("sk_live_secret"), text);
      assertFalse(text.contains("sig_secret"), text);
    }
    assertEquals("sk_live_secret", transport.requests.get(0).headers().get("X-Api-Key"));
  }

  /** client-cases.json covers the pages and requests; {@code AutoPager.cursor()} is Java's own. */
  @Test void theEventPagerKeepsTheLatestCursor() {
    var events = new Scripted(
        reply(200, "{\"events\":[{\"id\":\"e1\",\"type\":\"asset.classified\",\"facts\":[]}],\"cursor\":\"c1\",\"hasMore\":true}"),
        reply(200, "{\"events\":[{\"id\":\"e2\",\"type\":\"asset.allowed\"}],\"cursor\":\"c2\",\"hasMore\":false}"));
    AutoPager<Models.EventsPage> feed = events.client().events.pages(new Models.ListEvents().after("c0").limit(1));
    List<String> ids = new ArrayList<>();
    List<String> cursors = new ArrayList<>();
    for (Models.EventsPage page : feed) {
      page.events().forEach(event -> ids.add(event.id()));
      cursors.add(page.cursor());
    }
    assertEquals(List.of("e1", "e2"), ids);
    assertEquals(List.of("c1", "c2"), cursors);
    assertEquals("c2", feed.cursor());
    assertEquals(List.of(), events.client().events.list(new Models.ListEvents()).events().get(0).facts());
  }

  @Test void closedClientsRefuseRequests() {
    var transport = new Scripted(reply(200, ALLOWED));
    CalmLensServerClient client = transport.client();
    client.close();
    client.close();
    assertEquals(ErrorCodes.SDK_CLIENT_CLOSED, assertThrows(CalmLensException.class, () -> client.assets.retrieve(new Models.AssetId("a"))).getCode());
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
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project").timeout(Duration.ofMillis(200)).maxRetries(0)
        .transport(request -> new Transport.Response(200, Map.of(), stalled)).build();
    try {
      long started = System.nanoTime();
      assertThrows(RequestTimeoutException.class, () -> client.assets.retrieve(new Models.AssetId("a")));
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
    try (CdnResponse response = client.cdn.serve(new Models.CdnRequest("asset").init(new Models.HttpOptions().method("HEAD")
        .headers(Map.of("Range", "bytes=0-3", "X-Api-Key", "override"))), new RequestOptions().timeout(Duration.ofMillis(200)))) {
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
    var error = assertThrows(TransportException.class, () -> CalmLensServerClient.builder("key", "project").maxRetries(0)
        .transport(request -> { throw cause; }).build().assets.classify(Models.SubmitAsset.text("hello")));
    assertEquals(ErrorCodes.SDK_TRANSPORT_ERROR, error.getCode());
    assertSame(cause, error.getCause());
    var interrupted = CalmLensServerClient.builder("key", "project").transport(request -> { throw new InterruptedException(); }).build();
    try {
      assertEquals(ErrorCodes.SDK_CANCELLED, assertThrows(CalmLensException.class, () -> interrupted.assets.classify(Models.SubmitAsset.text("hello"))).getCode());
      assertTrue(Thread.currentThread().isInterrupted());
    } finally {
      Thread.interrupted();
    }
  }

  @Test void waitForDecisionPollsWithGrowingDelaysUntilTheAssetIsDecided() {
    String pending = Fixtures.assetJson("asset", "processing", "pending");
    var transport = new Scripted(reply(200, pending), reply(200, pending), reply(200, pending), reply(200, pending), reply(200, pending),
        reply(200, pending), reply(200, pending), reply(200, pending), reply(200, Fixtures.assetJson("asset", "completed", "blocked")));
    Models.Asset asset = transport.client().assets.waitForDecision(new Models.WaitForDecision("asset"));
    assertEquals("asset", asset.id());
    assertEquals(Models.AssetModerationStatus.BLOCKED, asset.classification().moderation().status());
    assertEquals(9, transport.requests.size());
    for (Transport.Request request : transport.requests) {
      assertEquals("GET", request.method());
      assertEquals("/v1/assets/asset", request.uri().getPath());
    }
    assertEquals(List.of(Duration.ofMillis(500), Duration.ofMillis(750), Duration.ofMillis(1125), Duration.ofNanos(1_687_500_000),
        Duration.ofNanos(2_531_250_000L), Duration.ofNanos(3_796_875_000L), Duration.ofSeconds(5), Duration.ofSeconds(5)), transport.delays);
  }

  @Test void waitForDecisionStopsWhenTheThreadIsInterrupted() {
    var transport = new Scripted(reply(200, Fixtures.assetJson("asset", "processing", "pending")));
    var client = CalmLensServerClient.builder("key", "project").build(transport, delay -> { throw new InterruptedException(); });
    try {
      assertEquals(ErrorCodes.SDK_CANCELLED, assertThrows(CalmLensException.class,
          () -> client.assets.waitForDecision(new Models.WaitForDecision("asset"))).getCode());
      assertTrue(Thread.currentThread().isInterrupted());
      assertEquals(1, transport.requests.size());
      // Already interrupted: nothing is sent.
      assertEquals(ErrorCodes.SDK_CANCELLED, assertThrows(CalmLensException.class,
          () -> client.assets.waitForDecision(new Models.WaitForDecision("asset"))).getCode());
      assertTrue(Thread.currentThread().isInterrupted());
      assertEquals(1, transport.requests.size());
    } finally {
      Thread.interrupted();
    }
  }

  @Test void nativeResponseModelsRetainDocumentAndHoldFields() {
    Map<String, Object> held = Fixtures.asset("asset", "completed", "allowed");
    held.put("content", Map.of("status", "stored", "extractedText", Map.of("type", "string", "content", "document text"),
        "safetyHold", Map.of("placedAt", 100, "disposedAt", 200, "reason", "suspected-illegal-content")));
    Models.Asset asset = new Scripted(reply(200, Fixtures.JSON.toJson(held))).client().assets.retrieve(new Models.AssetId("asset"));
    assertEquals("document text", asset.content().extractedText().content());
    assertEquals("suspected-illegal-content", asset.content().safetyHold().reason());
    assertEquals(java.time.Instant.ofEpochMilli(100), asset.content().safetyHold().placedAt());
    assertEquals(java.time.Instant.ofEpochMilli(200), asset.content().safetyHold().disposedAt());
  }
}
