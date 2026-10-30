package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MockClientTest {
  @Test void nativeBinaryContentArrivesUnchanged() {
    byte[] data = new byte[256];
    for (int i = 0; i < data.length; i++) data[i] = (byte) i;
    MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueue(200, Fixtures.asset("asset-1", "processing", "pending"));
    mock.client.assets.create(new Models.SubmitAsset("all-bytes.png", Models.Content.bytes(data, "image/png")));
    var sent = mock.requests().get(0);
    assertArrayEquals(data, sent.body());
    assertEquals("256", sent.query().get("sizeInBytes"));
    assertEquals("image/png", sent.query().get("contentType"));
    assertEquals("true", sent.query().get("queue"));
  }

  @Test void queuedErrorsUseTheApiStatusAndBodyShape() {
    for (String code : List.of(ErrorCodes.ASSET_NOT_FOUND, ErrorCodes.ASSET_SAFETY_HELD, ErrorCodes.INVALID_API_KEY, ErrorCodes.DUPLICATE_EXTERNAL_ID)) {
      MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueueError(code);
      ApiException error = assertThrows(ApiException.class, () -> mock.client.assets.retrieve(new Models.AssetId("a")));
      assertEquals(code, error.getCode());
      assertEquals(ErrorCodes.httpStatus(code).orElseThrow(), error.getStatus());
      assertEquals(Map.of("traceId", "trace_mock"), error.getDetails());
      assertEquals("trace_mock", error.getTraceId());
      assertTrue(error.getRequestId().startsWith("req_mock_"), error.getRequestId());
    }
    assertThrows(IllegalArgumentException.class, () -> new MockCalmLensServerClient().enqueueError("made/up"));
  }

  @Test void waitForDecisionReadsQueuedAssetsAndTimesOutWithoutWaiting() {
    MockCalmLensServerClient decided = new MockCalmLensServerClient().enqueue("GET", "/assets/asset-1", 200, Fixtures.asset("asset-1", "processing", "pending"))
        .enqueue("GET", "/assets/asset-1", 200, Fixtures.asset("asset-1", "failed", "pending"));
    Models.Asset asset = decided.client.assets.waitForDecision(new Models.WaitForDecision("asset-1"));
    assertEquals("asset-1", asset.id());
    assertSame(Models.AssetClassificationStatus.FAILED, asset.classification().status());
    assertSame(Models.AssetModerationStatus.PENDING, asset.classification().moderation().status());
    assertEquals(2, decided.requests().size());
    assertEquals(0, decided.remainingResponses());

    // Checks at 0, 0.5, 1.25, 2.375, 4.0625 and 6.59375s, then a wait for the rest of the 10s and a last check.
    MockCalmLensServerClient pending = new MockCalmLensServerClient();
    for (int i = 0; i < 8; i++) pending.enqueue(200, Fixtures.asset("asset-1", "processing", "pending"));
    long started = System.nanoTime();
    CalmLensException error = assertThrows(CalmLensException.class,
        () -> pending.client.assets.waitForDecision(new Models.WaitForDecision("asset-1").timeout(Duration.ofSeconds(10))));
    assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(5)) < 0);
    assertEquals(ErrorCodes.SDK_TIMEOUT, error.getCode());
    assertEquals(Map.of("assetId", "asset-1", "classificationStatus", "processing", "moderationStatus", "pending"), error.getDetails());
    assertEquals(7, pending.requests().size());
    assertEquals(1, pending.remainingResponses());
  }

  @Test void mocksRetryLikeTheRealClientWithoutWaiting() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueueError(ErrorCodes.IDEMPOTENT_REQUEST_IN_PROGRESS)
        .enqueue(200, Fixtures.asset("asset-1", "completed", "allowed"));
    long started = System.nanoTime();
    assertEquals("asset-1", mock.client.text.classify("hello").id());
    assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofMillis(900)) < 0);
    assertEquals(2, mock.requests().size());
    assertEquals(mock.requests().get(0).header("Idempotency-Key"), mock.requests().get(1).header("Idempotency-Key"));

    MockCalmLensServerClient throttled = new MockCalmLensServerClient(CalmLensServerClient.builder("key", "project").maxRetries(0)).enqueueRateLimited(30);
    ApiException error = assertThrows(ApiException.class, () -> throttled.client.assets.retrieve(new Models.AssetId("a")));
    assertEquals(429, error.getStatus());
    assertEquals(Duration.ofSeconds(30), error.getRetryAfter().orElseThrow());
  }

  @Test void routedResponsesOnlyAnswerTheirRoute() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(CalmLensServerClient.builder("key", "project-1").maxRetries(0))
        .enqueue("GET", "/assets/search", 200, Map.of("query", "cats", "items",
            List.of(Map.of("asset", Fixtures.asset("queued-1", "completed", "allowed"), "score", 1, "matchedFields", List.of("name")))));
    mock.client.assets.create("stored.png", new byte[] {1}, "image/png");
    // Other routes go to the in-memory API while the routed response waits for its route.
    assertEquals(List.of("stored.png"), mock.client.assets.list(new Models.ListAssets()).items().stream().map(Models.Asset::name).toList());
    assertEquals(1, mock.remainingResponses());
    assertEquals("queued-1", mock.client.assets.search(new Models.SearchAssets().query("stored")).items().get(0).asset().id());
    assertEquals(0, mock.remainingResponses());
    assertEquals("stored.png", mock.client.assets.search(new Models.SearchAssets().query("stored")).items().get(0).asset().name());
  }

  @Test void eventsAndCdnResponsesLookReal() {
    Map<String, Object> event = Map.of("id", "event-1", "type", "asset.blocked", "assetId", "asset-1",
        "facts", List.of(Map.of("key", "reviewer-name", "value", "Ada")));
    MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueueEvents("cursor-2", false, event)
        .enqueueCdn(200, "image/webp", new byte[] {1, 2, 3});
    Models.EventsPage page = mock.client.events.list(new Models.ListEvents().cursor("cursor-1"));
    assertEquals("cursor-2", page.nextCursor());
    assertEquals("asset.blocked", page.items().get(0).type());
    assertEquals("Ada", page.items().get(0).facts().get(0).value());
    try (CdnResponse response = mock.client.cdn.serve(new Models.CdnRequest("asset-1").lens("card"))) {
      assertEquals(200, response.status());
      assertEquals("image/webp", response.header("Content-Type"));
      assertEquals("3", response.header("content-length"));
      assertArrayEquals(new byte[] {1, 2, 3}, response.readAllBytes(10));
    }
    assertEquals("/v1/assets/project-1/asset-1/rendered/@card", mock.requests().get(1).path());
  }

  @Test void processingFeaturesAreSentAndFeatureResultsAreTyped() {
    Map<String, Object> box = Map.of("left", 0.1, "top", 0.2, "width", 0.3, "height", 0.4);
    Map<String, Object> report = Map.of("features", Map.of(
        "personDetection", Map.of("status", "evaluated", "stage", "beta", "people", List.of(Map.of("box", box, "confidence", 0.9))),
        "faceDetection", Map.of("status", "not-evaluated", "stage", "beta", "reason", "unavailable")));
    MockCalmLensServerClient mock = new MockCalmLensServerClient()
        .enqueue(200, withReport(Fixtures.asset("asset-1", "completed", "allowed"), report))
        .enqueue(200, withReport(Fixtures.asset("asset-2", "completed", "allowed"), Map.of("features", Map.of(
            "faceDetection", Map.of("status", "evaluated", "stage", "beta", "faces",
                List.of(Map.of("box", box, "confidence", 0.99, "ageRange", Map.of("low", 21, "high", 30))))))));
    Models.ProcessingOptions options = new Models.ProcessingOptions().keepContentAfterProcessing(false)
        .features(new Models.ProcessingFeatures()
            .ocr(new Models.FeatureOptions().enabled(true))
            .personDetection(new Models.FeatureOptions(true))
            .faceDetection(new Models.FaceDetectionOptions().enabled(true).ageEstimation(true)));
    Models.Asset asset = mock.client.assets.classify(new Models.SubmitAsset("photo.png", Models.Content.bytes(new byte[] {1}, "image/png"))
        .processingOptions(options));
    assertEquals(
        com.google.gson.JsonParser.parseString("{\"keepContentAfterProcessing\":false,\"features\":{\"ocr\":{\"enabled\":true},"
            + "\"personDetection\":{\"enabled\":true},\"faceDetection\":{\"enabled\":true,\"ageEstimation\":true}}}"),
        com.google.gson.JsonParser.parseString(mock.requests().get(0).query().get("processingOptions")));

    Models.PersonDetectionResult people = asset.classification().personDetection();
    assertEquals("evaluated", people.status());
    assertEquals("beta", people.stage());
    assertEquals(new Models.DetectedPerson(new Models.BoundingBox(0.1, 0.2, 0.3, 0.4), 0.9), people.people().get(0));
    assertEquals(1, people.people().size());
    Models.FaceDetectionResult skipped = asset.classification().faceDetection();
    assertEquals("not-evaluated", skipped.status());
    assertEquals("unavailable", skipped.reason());
    assertNull(skipped.faces());

    Models.Asset faces = mock.client.assets.retrieve(new Models.AssetId("asset-2"));
    assertNull(faces.classification().personDetection());
    assertEquals(List.of(new Models.DetectedFace(new Models.BoundingBox(0.1, 0.2, 0.3, 0.4), 0.99, new Models.AgeRange(21, 30))),
        faces.classification().faceDetection().faces());
  }

  @Test void deleteContentThenDeleteAsset() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient()
        .enqueue(200, removedContent(Fixtures.asset("asset 1", "completed", "allowed")))
        .enqueue(200, Map.of());
    Models.Asset removed = mock.client.assets.deleteContent(new Models.AssetId("asset 1"));
    assertSame(Models.AssetContentStatus.REMOVED, removed.content().status());
    assertEquals("requested", removed.content().removalReason());
    assertEquals(java.time.Instant.ofEpochMilli(1700000000000L), removed.content().updatedAt());
    mock.client.assets.delete(new Models.AssetId("asset 1"));
    var sent = mock.requests();
    assertEquals("DELETE", sent.get(0).method());
    assertEquals("/v1/assets/asset%201/content", sent.get(0).path());
    assertNull(sent.get(0).body());
    assertEquals("DELETE", sent.get(1).method());
    assertEquals("/v1/assets/asset%201", sent.get(1).path());
  }

  @Test void configurationFailuresAndRequestInspection() {
    var mock = new MockCalmLensServerClient(CalmLensServerClient.builder("ignored-key", "project-9")
        .baseUrl("http://localhost:6110/v1").cdnBaseUrl("http://localhost:6130/v1").timeout(Duration.ofSeconds(5)).maxRetries(0));
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class,
        () -> new MockCalmLensServerClient(CalmLensServerClient.builder("key", "project").timeout(Duration.ZERO))).getCode());
    assertEquals("http://localhost:6130/v1/assets/project-9/one/rendered", mock.client.cdn.getAssetUrl(new Models.CdnRequest("one")));

    var refused = new java.net.ConnectException("Connection refused");
    mock.enqueueFailure(refused).enqueueTimeout();
    assertSame(refused, assertThrows(TransportException.class, () -> mock.client.text.classify("hello")).getCause());
    assertInstanceOf(RequestTimeoutException.class, assertThrows(CalmLensException.class, () -> mock.client.text.classify("hello")));

    mock.enqueueEvents("c1", false);
    assertEquals("c1", mock.client.events.list(new Models.ListEvents().cursor("c0").pageSize(10)).nextCursor());
    var classify = mock.requests().get(0);
    assertEquals("POST", classify.method());
    assertEquals("/v1/projects/project-9/assets", classify.path());
    assertEquals("content", classify.header("x-calmlens-upload"));
    assertEquals("false", classify.query().get("queue"));
    assertEquals("hello", classify.bodyText());
    assertEquals("ignored-key", classify.header("x-api-key"));
    assertFalse(classify.toString().contains("ignored-key"));
    var events = mock.requests().get(2);
    assertEquals("/v1/projects/project-9/events", events.path());
    assertEquals(Map.of("cursor", "c0", "pageSize", "10"), events.query());
    assertNull(events.bodyText());
    byte[] captured = classify.body();
    captured[0] = 0;
    assertEquals("hello", new String(mock.requests().get(0).body(), StandardCharsets.UTF_8));
  }

  private static Map<String, Object> withReport(Map<String, Object> asset, Map<String, Object> report) {
    Map<String, Object> classification = new java.util.LinkedHashMap<>((Map<String, Object>) asset.get("classification"));
    classification.put("moderation", Map.of("status", "allowed"));
    if (report.containsKey("features")) classification.putAll((Map<String, Object>) report.get("features"));
    asset.put("classification", classification);
    return asset;
  }

  private static Map<String, Object> removedContent(Map<String, Object> asset) {
    asset.put("content", Map.of("status", "removed", "removalReason", "requested", "updatedAt", 1700000000000L));
    return asset;
  }
}
