package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.*;
import com.calmlens.internal.Json;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.*;
import com.calmlens.params.*;
import com.calmlens.testing.MockCalmLensServerClient;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class MockClientTest {
  private static CalmLensServerClient.Builder builder(String key, String project) {
    return CalmLensServerClient.builder().apiKey(key).projectId(project);
  }

  /**
   * A complete asset response, as the in-memory API sends one, with the given ID, processing status
   * and decision ({@code pending} for none yet).
   */
  private static JsonObject asset(String id, String processing, String decision) {
    JsonObject asset = new MockCalmLensServerClient().client().assets().create("photo.png", new byte[] {1}, "image/png").getRawJsonObject();
    asset.addProperty("id", id);
    JsonObject classification = asset.getAsJsonObject("classification");
    classification.addProperty("status", processing);
    classification.getAsJsonObject("moderation").add("decision", "pending".equals(decision) ? JsonNull.INSTANCE : new JsonPrimitive(decision));
    return asset;
  }

  /** A complete event of the mock's project, as the API sends one. */
  private static Map<String, Object> event(String id, String type, String assetId, List<Map<String, Object>> facts) {
    Map<String, Object> event = new java.util.LinkedHashMap<>();
    event.put("id", id);
    event.put("projectId", MockCalmLensServerClient.MOCK_PROJECT_ID);
    event.put("actor", Map.of("type", "api-key"));
    event.put("type", type);
    event.put("severity", "low");
    event.put("title", type);
    event.put("assetId", assetId);
    event.put("facts", facts);
    event.put("createdAt", 1_700_000_000_000L);
    return event;
  }

  @Test void nativeBinaryContentArrivesUnchanged() {
    byte[] data = new byte[256];
    for (int i = 0; i < data.length; i++) data[i] = (byte) i;
    MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueue(200, asset("asset-1", "processing", "pending"));
    mock.client().assets().create(AssetCreateParams.builder().setName("all-bytes.png").setContent(Content.bytes(data, "image/png")).build());
    var sent = mock.requests().get(0);
    UploadForm.Parsed form = Fixtures.form(sent);
    assertArrayEquals(data, form.file());
    assertEquals("image/png", form.fileType());
    assertEquals(JsonParser.parseString("{\"name\":\"all-bytes.png\"}"), JsonParser.parseString(form.options()));
    assertEquals("256", sent.query().get("sizeInBytes"));
    assertEquals("image/png", sent.query().get("contentType"));
    assertEquals("false", sent.query().get("wait"));
  }

  @Test void queuedErrorsUseTheApiStatusAndBodyShape() {
    for (String code : List.of(ErrorCodes.ASSET_NOT_FOUND, ErrorCodes.ASSET_HELD, ErrorCodes.INVALID_API_KEY, ErrorCodes.DUPLICATE_EXTERNAL_ID)) {
      MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueueError(code);
      ApiException error = assertThrows(ApiException.class, () -> mock.client().assets().retrieve("a"));
      assertEquals(code, error.getCode());
      assertEquals(ErrorCodes.httpStatus(code).orElseThrow(), error.getStatus());
      assertEquals(Map.of(), error.getDetails());
      String requestId = error.getRequestId().orElseThrow();
      assertTrue(requestId.startsWith("req_mock_"), requestId);
    }
    assertThrows(IllegalArgumentException.class, () -> new MockCalmLensServerClient().enqueueError("made/up"));
  }

  @Test void waitForDecisionReadsQueuedAssetsAndTimesOutWithoutWaiting() {
    // A reviewer's decision on an asset still processing doesn't settle it; failing does.
    MockCalmLensServerClient decided = new MockCalmLensServerClient().enqueue("GET", "/assets/asset-1", 200, asset("asset-1", "processing", "blocked"))
        .enqueue("GET", "/assets/asset-1", 200, asset("asset-1", "failed", "pending"));
    Asset asset = decided.client().assets().waitForDecision("asset-1");
    assertEquals("asset-1", asset.getId());
    assertSame(AssetClassificationStatus.FAILED, asset.getClassification().getStatus());
    assertEquals(2, decided.requests().size());
    assertEquals(0, decided.remainingResponses());

    // Checks at 0, 0.5, 1.25, 2.375, 4.0625, 6.0625 and 8.0625s (at most 2s apart), then stop at the 10s deadline.
    MockCalmLensServerClient pending = new MockCalmLensServerClient();
    for (int i = 0; i < 9; i++) pending.enqueue(200, asset("asset-1", "processing", "pending"));
    long started = System.nanoTime();
    TimeoutException error = assertThrows(TimeoutException.class,
        () -> pending.client().assets().waitForDecision("asset-1", Duration.ofSeconds(10)));
    assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(5)) < 0);
    assertEquals(ErrorCodes.SDK_TIMEOUT, error.getCode());
    Map<String, Object> details = new java.util.HashMap<>();
    details.put("assetId", "asset-1");
    details.put("classificationStatus", "processing");
    details.put("moderationDecision", null);
    assertEquals(details, error.getDetails());
    assertEquals(7, pending.requests().size());
    assertEquals(2, pending.remainingResponses());
  }

  @Test void mocksWithRetriesRetryLikeTheRealClientWithoutWaiting() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(builder("key", "project-1").maxRetries(2))
        .enqueueError(ErrorCodes.IDEMPOTENT_REQUEST_IN_PROGRESS)
        .enqueue(200, asset("asset-1", "completed", "allowed"));
    long started = System.nanoTime();
    assertEquals("asset-1", mock.client().text().classify("hello").getId());
    assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofMillis(900)) < 0);
    assertEquals(2, mock.requests().size());
    assertEquals(mock.requests().get(0).header("Idempotency-Key"), mock.requests().get(1).header("Idempotency-Key"));
    assertEquals(java.util.Arrays.asList(409, 200), mock.requests().stream().map(MockCalmLensServerClient.Request::status).toList());
  }

  @Test void theOptionsProjectIsUsedWithoutABuilderAndRefusedWithOne() {
    var mock = new MockCalmLensServerClient(new MockCalmLensServerClient.Options().projectId("project-7"));
    mock.client().assets().list();
    assertEquals("/projects/project-7/assets", mock.requests().get(0).path());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> new MockCalmLensServerClient(
        builder("key", "project-2"), new MockCalmLensServerClient.Options().projectId("project-7"))).getCode());
  }

  @Test void failuresMustNameAnOperationThatSendsARequest() {
    var options = new MockCalmLensServerClient.FailureOptions();
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> options.operation("uploadTokens.sign")).getCode());
    MockCalmLensServerClient mock = new MockCalmLensServerClient();
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> mock.failNextRequest("made/up")).getCode());
    // A decision is a request too, so its failure waits for it.
    mock.failNextRequest(ErrorCodes.ASSET_PROCESSING, new MockCalmLensServerClient.FailureOptions().operation("assets.decide"));
    mock.client().folders().list();
    assertEquals(ErrorCodes.ASSET_PROCESSING, assertThrows(ApiException.class, () -> mock.client().assets().decide("asset_00000000000000000000",
        AssetDecideParams.builder().setDecision(AssetModerationDecision.BLOCKED).setNote("spam").build())).getCode());
  }

  @Test void routedResponsesOnlyAnswerTheirRoute() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(builder("key", "project-1").maxRetries(0))
        .enqueue("GET", "/assets/search", 200, Map.of("query", "cats", "semanticStatus", "ready", "items",
            List.of(Map.of("asset", asset("queued-1", "completed", "allowed"), "score", 1, "matchedFields", List.of("name")))));
    mock.client().assets().create("stored.png", new byte[] {1}, "image/png");
    // Other routes go to the in-memory API while the routed response waits for its route.
    assertEquals(List.of("stored.png"), mock.client().assets().list().getItems().stream().map(Asset::getName).toList());
    assertEquals(1, mock.remainingResponses());
    AssetSearchParams stored = AssetSearchParams.builder().setQuery("stored").build();
    assertEquals("queued-1", mock.client().assets().search(stored).getItems().get(0).getAsset().getId());
    assertEquals(0, mock.remainingResponses());
    assertEquals("stored.png", mock.client().assets().search(stored).getItems().get(0).getAsset().getName());
  }

  @Test void eventsAndCdnResponsesLookReal() {
    Map<String, Object> event = event("event-1", "asset.blocked", "asset-1", List.of(Map.of("key", "asset-name", "value", "Ada.png")));
    MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueueEvents("cursor-2", false, event)
        .enqueueCdn(200, "image/webp", new byte[] {1, 2, 3});
    EventsPage page = mock.client().events().list(EventListParams.builder().setCursor("cursor-1").build());
    assertEquals("cursor-2", page.getNextCursor());
    assertSame(EventType.ASSET_BLOCKED, page.getItems().get(0).getType());
    assertEquals("Ada.png", page.getItems().get(0).getFacts().get(0).getValue());
    try (CdnResponse response = mock.client().cdn().serve(CdnRequestParams.builder().setAssetId("asset-1").setLens("card").build())) {
      assertEquals(200, response.status());
      assertEquals("image/webp", response.header("Content-Type"));
      assertEquals("3", response.header("content-length"));
      assertArrayEquals(new byte[] {1, 2, 3}, response.readAllBytes(10));
    }
    assertEquals("/assets/project-1/asset-1/rendered/@card", mock.requests().get(1).path());
  }

  @Test void processingFeaturesAreSentAndFeatureResultsAreTyped() {
    Map<String, Object> box = Map.of("left", 0.1, "top", 0.2, "width", 0.3, "height", 0.4);
    Map<String, Object> report = Map.of("features", Map.of(
        "personDetection", Map.of("status", "evaluated", "people", List.of(Map.of("box", box, "confidence", 0.9))),
        "faceDetection", Map.of("status", "not-evaluated", "reason", "unavailable")));
    MockCalmLensServerClient mock = new MockCalmLensServerClient()
        .enqueue(200, withReport(asset("asset-1", "completed", "allowed"), report))
        .enqueue(200, withReport(asset("asset-2", "completed", "allowed"), Map.of("features", Map.of(
            "faceDetection", Map.of("status", "evaluated", "faces",
                List.of(Map.of("box", box, "confidence", 0.99, "ageRange", Map.of("low", 21, "high", 30))))))));
    ProcessingOptionsParams options = ProcessingOptionsParams.builder().setRetainContent(false)
        .setFeatures(ProcessingFeaturesParams.builder()
            .setOcr(FeatureOptionsParams.builder().setEnabled(true).build())
            .setPersonDetection(FeatureOptionsParams.of(true))
            .setFaceDetection(FaceDetectionOptionsParams.builder().setEnabled(true).setAgeEstimation(true).build())
            .build())
        .build();
    Asset asset = mock.client().assets().classify(AssetCreateParams.builder().setName("photo.png")
        .setContent(Content.bytes(new byte[] {1}, "image/png")).setProcessingOptions(options).build());
    assertEquals(
        JsonParser.parseString("{\"retainContent\":false,\"features\":{\"ocr\":{\"enabled\":true},"
            + "\"personDetection\":{\"enabled\":true},\"faceDetection\":{\"enabled\":true,\"ageEstimation\":true}}}"),
        Fixtures.formOptions(mock.requests().get(0)).get("processingOptions"));

    PersonDetectionResult people = asset.getClassification().getPersonDetection().orElseThrow();
    assertSame(EvaluationStatus.EVALUATED, people.getStatus());
    assertEquals(List.of(Json.GSON.fromJson("{\"box\":{\"left\":0.1,\"top\":0.2,\"width\":0.3,\"height\":0.4},\"confidence\":0.9}", DetectedPerson.class)),
        people.getPeople().orElseThrow());
    FaceDetectionResult skipped = asset.getClassification().getFaceDetection().orElseThrow();
    assertSame(EvaluationStatus.NOT_EVALUATED, skipped.getStatus());
    assertEquals(Optional.of(FeatureNotEvaluatedReason.UNAVAILABLE), skipped.getReason());
    assertEquals(Optional.empty(), skipped.getFaces());

    Asset faces = mock.client().assets().retrieve("asset-2");
    assertEquals(Optional.empty(), faces.getClassification().getPersonDetection());
    assertEquals(List.of(Json.GSON.fromJson("{\"box\":{\"left\":0.1,\"top\":0.2,\"width\":0.3,\"height\":0.4},\"confidence\":0.99,"
            + "\"ageRange\":{\"low\":21,\"high\":30}}", DetectedFace.class)),
        faces.getClassification().getFaceDetection().orElseThrow().getFaces().orElseThrow());
  }

  @Test void removeContentThenDeleteAsset() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient()
        .enqueue(200, removedContent(asset("asset 1", "completed", "allowed")))
        .enqueue(200, Map.of());
    Asset removed = mock.client().assets().removeContent("asset 1");
    assertSame(AssetContentStatus.REMOVED, removed.getContent().getStatus());
    assertEquals(Optional.of(ContentRemovalReason.REQUESTED), removed.getContent().getRemovalReason());
    assertEquals(Optional.of(java.time.Instant.ofEpochMilli(1700000000000L)), removed.getContent().getUpdatedAt());
    mock.client().assets().delete("asset 1");
    var sent = mock.requests();
    assertEquals("DELETE", sent.get(0).method());
    assertEquals("/assets/asset 1/content", sent.get(0).path());
    assertNull(sent.get(0).body());
    assertEquals("DELETE", sent.get(1).method());
    assertEquals("/assets/asset 1", sent.get(1).path());
  }

  @Test void configurationFailuresAndRequestInspection() {
    var mock = new MockCalmLensServerClient(builder("ignored-key", "project-9")
        .baseUrl("http://localhost:6110/v1").cdnBaseUrl("http://localhost:6130/v1").timeout(Duration.ofSeconds(5)).maxRetries(0));
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class,
        () -> new MockCalmLensServerClient(builder("key", "project").timeout(Duration.ZERO))).getCode());
    assertEquals("http://localhost:6130/v1/assets/project-9/one", mock.client().cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("one").build()));

    var refused = new java.net.ConnectException("Connection refused");
    mock.enqueueFailure(refused).enqueueTimeout();
    assertSame(refused, assertThrows(ConnectionException.class, () -> mock.client().text().classify("hello")).getCause());
    assertInstanceOf(TimeoutException.class, assertThrows(CalmLensException.class, () -> mock.client().text().classify("hello")));

    mock.enqueueEvents("c1", false);
    assertEquals("c1", mock.client().events().list(EventListParams.builder().setCursor("c0").setPageSize(10).build()).getNextCursor());
    var classify = mock.requests().get(0);
    assertEquals("POST", classify.method());
    assertEquals("/projects/project-9/assets", classify.path());
    // Text goes as a JSON body, its fields never in the query.
    assertNull(classify.header("x-calmlens-upload"));
    assertEquals("application/json", classify.header("content-type"));
    assertEquals(Map.of("wait", "true"), classify.query());
    String sent = classify.bodyText();
    assertEquals(JsonParser.parseString("{\"name\":\"text\",\"content\":{\"plainText\":\"hello\",\"type\":\"text/plain\"}}"), JsonParser.parseString(sent));
    assertEquals("ignored-key", classify.header("x-api-key"));
    assertFalse(classify.toString().contains("ignored-key"));
    var events = mock.requests().get(2);
    assertEquals("/projects/project-9/events", events.path());
    assertEquals(Map.of("cursor", "c0", "pageSize", "10"), events.query());
    assertNull(events.bodyText());
    byte[] captured = classify.body();
    captured[0] = 0;
    assertEquals(sent, new String(mock.requests().get(0).body(), StandardCharsets.UTF_8));
  }

  private static JsonObject withReport(JsonObject asset, Map<String, Object> report) {
    JsonObject classification = asset.getAsJsonObject("classification");
    classification.getAsJsonObject("moderation").addProperty("decision", "allowed");
    @SuppressWarnings("unchecked") Map<String, Object> features = (Map<String, Object>) report.get("features");
    if (features != null) features.forEach((name, result) -> classification.add(name, Json.GSON.toJsonTree(result)));
    return asset;
  }

  private static JsonObject removedContent(JsonObject asset) {
    JsonObject content = asset.getAsJsonObject("content");
    content.addProperty("status", "removed");
    content.addProperty("removalReason", "requested");
    content.addProperty("updatedAt", 1700000000000L);
    return asset;
  }
}
