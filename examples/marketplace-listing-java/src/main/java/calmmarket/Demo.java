package calmmarket;

import com.calmlens.CalmLensServerClient;
import com.calmlens.MockCalmLensServerClient;
import java.net.ConnectException;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Demo mode, used only when requested explicitly ({@code CALMLENS_DEMO=1} or {@code --demo}).
 * Each CalmLens call is answered by the SDK's offline mock with the outcome the seller selected,
 * after the real client's validation and encoding. Reports, OCR children and their text are
 * synthetic and labelled as such; nothing is classified. Live mode never loads this class's mocks.
 */
final class Demo implements Calmmarket.Backend {
  /** A demo photo stays pending this long, then takes the selected outcome. */
  static final Duration REVIEW_DELAY = Duration.ofSeconds(2);

  /** A fresh mock per call. Retries are off so each queued answer is used exactly once. */
  private static MockCalmLensServerClient mock() {
    return new MockCalmLensServerClient(CalmLensServerClient.builder("demo-key", "demo-project")
        .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1").maxRetries(0));
  }

  @Override public boolean demo() { return true; }

  @Override public CalmLensServerClient textModeration(String choice) {
    MockCalmLensServerClient mock = mock();
    if (choice.equals("unavailable")) return mock.enqueueFailure(new ConnectException("Connection refused")).client;
    boolean rejected = choice.equals("description-rejected");
    return mock.enqueue(200, asset("demo-" + UUID.randomUUID(), "approved", null, null, null))
        .enqueue(200, asset("demo-" + UUID.randomUUID(), rejected ? "rejected" : "approved", null, rejected ? "hide" : null, null)).client;
  }

  @Override public CalmLensServerClient photoUploads(int photos) {
    MockCalmLensServerClient mock = mock();
    for (int i = 0; i < photos; i++) mock.enqueue(200, asset("demo-" + UUID.randomUUID(), "pending", null, null, null));
    return mock.client;
  }

  @Override public CalmLensServerClient photo(Calmmarket.Photo photo) {
    MockCalmLensServerClient mock = mock();
    if (Duration.between(photo.submittedAt, Instant.now()).compareTo(REVIEW_DELAY) < 0)
      return mock.enqueue(200, asset(photo.assetId, "pending", photo.externalId, null, null)).client;
    // Rejected demo photos are hidden by the simulated policy; clean ones matched nothing.
    String decision = "approved", action = null;
    Map<String, Object> report = null, child = null;
    switch (photo.demoResult) {
      case "clean-text" -> {
        report = report(Map.of());
        child = child(photo.assetId, "approved", null, "Hand-made oak · 25.00 · collection only", report(Map.of("self-harm", notEvaluated("unavailable"))));
      }
      case "text-rejected" -> {
        decision = "rejected";
        action = "hide";
        report = report(Map.of("criminal-activity", evaluated(0.88)));
        child = child(photo.assetId, "rejected", "hide", "Message me for prescription pills, no questions asked", report(Map.of("criminal-activity", evaluated(0.88))));
      }
      case "visual-rejected" -> {
        decision = "rejected";
        action = "hide";
        report = report(Map.of("violence", evaluated(0.91)));
        child = child(photo.assetId, "approved", null, "Collector's edition · 25.00", report(Map.of("self-harm", notEvaluated("unavailable"))));
      }
      case "error" -> decision = "error";
      default -> report = report(Map.of());
    }
    Map<String, Object> asset = asset(photo.assetId, decision, photo.externalId, action, report);
    asset.put("type", "image");
    if (photo.demoReviewerRejected) {
      // A reviewer's decision replaces the automated one; the policy action stays as it was.
      Map<String, Object> moderation = moderation(asset);
      moderation.put("status", "rejected");
      moderation.put("reviewerAction", "rejected");
      moderation.put("reviewerNote", "Simulated portal decision");
    }
    mock.enqueue(200, asset);
    if (!decision.equals("error"))
      mock.enqueue(200, Map.of("items", child == null ? List.of() : List.of(child), "pageSize", 10, "hasMore", false));
    return mock.client;
  }

  @Override public CalmLensServerClient textAsset(String assetId, String externalId, boolean flagged) {
    return mock().enqueue(200, asset(assetId, "approved", externalId, flagged ? "alert" : null, null)).client;
  }

  @Override public CalmLensServerClient contentRemoval(String assetId) {
    Map<String, Object> removed = asset(assetId, "approved", null, null, null);
    removed.put("content", Map.of("status", "removed", "removalReason", "requested", "updatedAt", System.currentTimeMillis()));
    return mock().enqueue(200, removed).client;
  }

  /** The demo CDN answers with the bytes kept for the photo, or 404 once they are removed. */
  @Override public CalmLensServerClient preview(Calmmarket.Photo photo) {
    byte[] bytes = photo.demoBytes;
    return (bytes == null ? mock().enqueueCdn(404, "text/plain", new byte[0]) : mock().enqueueCdn(200, photo.mime, bytes)).client;
  }

  @Override public CalmLensServerClient events() { return null; }

  /** One synthetic {@code asset.rejected} event, with the facts a portal decision carries. */
  @Override public CalmLensServerClient simulatedReview(Calmmarket.Photo photo) {
    String id = UUID.randomUUID().toString();
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("id", id);
    event.put("type", "asset.rejected");
    event.put("projectId", "demo-project");
    event.put("createdAt", System.currentTimeMillis());
    event.put("severity", "high");
    event.put("title", "Asset rejected");
    event.put("assetId", photo.assetId);
    event.put("asset", Map.of("id", photo.assetId, "externalId", photo.externalId,
        "processing", Map.of("status", "done"),
        "moderation", moderationSnapshot("rejected", photo.moderationAction),
        "content", Map.of("status", "stored")));
    event.put("facts", List.of(
        Map.of("key", "asset-name", "value", photo.name),
        Map.of("key", "asset-type", "value", "image"),
        Map.of("key", "decided-by", "value", "reviewer"),
        Map.of("key", "reviewer-user-id", "value", "demo-reviewer"),
        Map.of("key", "reviewer-name", "value", "Demo reviewer"),
        Map.of("key", "note", "value", "Simulated portal decision")));
    return mock().enqueueEvents("demo-" + id, false, event).client;
  }

  // ---------------------------------------------------------------- Synthetic responses

  /**
   * A synthetic asset with its content stored. {@code decision} is {@code pending} (still
   * processing), {@code approved}, {@code rejected} or {@code error} (processing failed);
   * {@code action} is the policy's action, or null when it matched nothing.
   */
  private static Map<String, Object> asset(String id, String decision, String externalId, String action, Map<String, Object> report) {
    Map<String, Object> asset = new LinkedHashMap<>();
    asset.put("id", Objects.requireNonNull(id));
    if (externalId != null) asset.put("externalId", externalId);
    String processing = switch (decision) {
      case "pending" -> "processing";
      case "error" -> "failed";
      default -> "done";
    };
    asset.put("processing", Map.of("status", processing));
    Map<String, Object> moderation = new LinkedHashMap<>();
    moderation.put("status", decision.equals("approved") || decision.equals("rejected") ? decision : "pending");
    moderation.put("action", action);
    moderation.put("report", report);
    asset.put("moderation", moderation);
    asset.put("content", Map.of("status", "stored"));
    return asset;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> moderation(Map<String, Object> asset) { return (Map<String, Object>) asset.get("moderation"); }

  private static Map<String, Object> moderationSnapshot(String status, String action) {
    Map<String, Object> moderation = new LinkedHashMap<>();
    moderation.put("status", status);
    moderation.put("action", action);
    return moderation;
  }

  private static Map<String, Object> child(String parentId, String decision, String action, String text, Map<String, Object> report) {
    Map<String, Object> child = asset(parentId + "-text", decision, null, action, report);
    child.put("type", Calmmarket.OCR_CHILD_TYPE);
    child.put("parentId", parentId);
    child.put("content", Map.of("status", "stored", "extractedText", Map.of("type", "string", "content", text)));
    return child;
  }

  /** A synthetic report: every category evaluated at a low score unless overridden. */
  private static Map<String, Object> report(Map<String, Map<String, Object>> overrides) {
    Map<String, Object> categories = new LinkedHashMap<>();
    double highest = 0;
    for (String key : Calmmarket.CATEGORIES) {
      Map<String, Object> result = overrides.getOrDefault(key, evaluated(0.02));
      categories.put(key, result);
      if (result.get("score") instanceof Double score) highest = Math.max(highest, score);
    }
    return Map.of("categories", categories, "score", highest, "processedAt", System.currentTimeMillis());
  }

  private static Map<String, Object> evaluated(double score) {
    String likelihood = score < 0.2 ? "very-unlikely" : score < 0.4 ? "unlikely" : score < 0.6 ? "possible" : score < 0.8 ? "likely" : "very-likely";
    return Map.of("status", "evaluated", "score", score, "likelihood", likelihood);
  }

  private static Map<String, Object> notEvaluated(String reason) {
    return Map.of("status", "not-evaluated", "reason", reason);
  }
}
