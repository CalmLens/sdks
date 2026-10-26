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
 * after the real client's validation and encoding. Reports and extracted text are
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
    boolean blocked = choice.equals("description-blocked");
    return mock.enqueue(200, asset("demo-" + UUID.randomUUID(), "allowed", null, null))
        .enqueue(200, asset("demo-" + UUID.randomUUID(), blocked ? "blocked" : "allowed", null, null)).client;
  }

  @Override public CalmLensServerClient photoUploads(int photos) {
    MockCalmLensServerClient mock = mock();
    for (int i = 0; i < photos; i++) mock.enqueue(200, asset("demo-" + UUID.randomUUID(), "pending", null, null));
    return mock.client;
  }

  @Override public CalmLensServerClient photo(Calmmarket.Photo photo) {
    MockCalmLensServerClient mock = mock();
    if (Duration.between(photo.submittedAt, Instant.now()).compareTo(REVIEW_DELAY) < 0)
      return mock.enqueue(200, asset(photo.assetId, "pending", photo.externalId, null)).client;
    // The simulated policy blocks photos it acts on; clean ones matched nothing.
    String status = "allowed";
    Map<String, Object> report = null;
    String extractedText = null;
    switch (photo.demoResult) {
      case "clean-text" -> {
        report = report(Map.of());
        extractedText = "Collection only · cash or card";
      }
      case "limited" -> {
        status = "limited";
        report = report(Map.of("profanity", evaluated(0.64)));
      }
      case "age-restricted" -> {
        status = "age-restricted";
        report = report(Map.of("sexual", evaluated(0.72)));
      }
      case "text-blocked" -> {
        status = "blocked";
        report = report(Map.of("criminal-activity", evaluated(0.88)));
        extractedText = "Prescription pills, no prescription needed. Message 555-0142";
      }
      case "visual-blocked" -> {
        status = "blocked";
        report = report(Map.of("violence", evaluated(0.91)));
        extractedText = "Collector's edition · 25.00";
      }
      case "error" -> status = "error";
      default -> report = report(Map.of());
    }
    Map<String, Object> asset = asset(photo.assetId, status, photo.externalId, report);
    asset.put("type", "image");
    if (extractedText != null) asset.put("content", Map.of("status", "stored", "extractedText", Map.of("type", "string", "content", extractedText)));
    if (photo.demoReviewerBlocked) {
      // A reviewer's decision replaces the automated one.
      Map<String, Object> moderation = moderation(asset);
      moderation.put("status", "blocked");
      moderation.put("manualReviews", java.util.List.of(Map.of("id", java.util.UUID.randomUUID().toString(), "decision", "blocked", "note", "Simulated portal decision", "reviewerUserId", "demo-reviewer", "reviewedAt", System.currentTimeMillis(), "appliedToAsset", true)));
    }
    mock.enqueue(200, asset);

    return mock.client;
  }

  @Override public CalmLensServerClient textAsset(String assetId, String externalId) {
    return mock().enqueue(200, asset(assetId, "allowed", externalId, null)).client;
  }

  @Override public CalmLensServerClient contentRemoval(String assetId) {
    Map<String, Object> removed = asset(assetId, "allowed", null, null);
    removed.put("content", Map.of("status", "removed", "removalReason", "requested", "updatedAt", System.currentTimeMillis()));
    return mock().enqueue(200, removed).client;
  }

  /** The demo CDN answers with the bytes kept for the photo, or 404 once they are removed. */
  @Override public CalmLensServerClient preview(Calmmarket.Photo photo) {
    byte[] bytes = photo.demoBytes;
    return (bytes == null ? mock().enqueueCdn(404, "text/plain", new byte[0]) : mock().enqueueCdn(200, photo.mime, bytes)).client;
  }

  @Override public CalmLensServerClient events() { return null; }

  /** One synthetic {@code asset.blocked} event, with the facts a portal decision carries. */
  @Override public CalmLensServerClient simulatedReview(Calmmarket.Photo photo) {
    String id = UUID.randomUUID().toString();
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("id", id);
    event.put("type", "asset.blocked");
    event.put("projectId", "demo-project");
    event.put("createdAt", System.currentTimeMillis());
    event.put("severity", "high");
    event.put("title", "Asset blocked");
    event.put("assetId", photo.assetId);
    event.put("asset", Map.of("id", photo.assetId, "externalId", photo.externalId,
        "upload", Map.of("status", "completed"),
        "classification", Map.of("status", "completed", "moderation", Map.of("status", "blocked")),
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
   * A synthetic asset with its content stored. {@code status} is {@code pending} (still
   * processing), a moderation status such as {@code allowed} or {@code blocked}, or {@code error}
   * (processing failed).
   */
  private static Map<String, Object> asset(String id, String status, String externalId, Map<String, Object> report) {
    Map<String, Object> asset = new LinkedHashMap<>();
    asset.put("id", Objects.requireNonNull(id));
    if (externalId != null) asset.put("externalId", externalId);
    String processing = switch (status) {
      case "pending" -> "processing";
      case "error" -> "failed";
      default -> "completed";
    };
    Map<String, Object> classification = new LinkedHashMap<>();
    classification.put("status", processing);
    asset.put("upload", Map.of("status", "completed"));
    asset.put("classification", classification);
    Map<String, Object> moderation = new LinkedHashMap<>();
    moderation.put("status", status.equals("error") ? "pending" : status);
    moderation.put("manualReviews", java.util.List.of());
    if (report != null) { moderation.putAll(report); moderation.remove("processedAt"); }
    classification.put("moderation", moderation);
    asset.put("content", Map.of("status", "stored"));
    return asset;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> moderation(Map<String, Object> asset) { return (Map<String, Object>) ((Map<String, Object>) asset.get("classification")).get("moderation"); }




  /** A synthetic report: every category evaluated at a low score unless overridden. */
  private static Map<String, Object> report(Map<String, Map<String, Object>> overrides) {
    Map<String, Object> categories = new LinkedHashMap<>();
    double highest = 0;
    for (String key : Calmmarket.CATEGORIES) {
      Map<String, Object> result = overrides.getOrDefault(key, evaluated(0.02));
      categories.put(key, result);
      if (result.get("score") instanceof Double score) highest = Math.max(highest, score);
    }
    // The simulated policy acts on every overridden category, as a real report's policy decision names them.
    List<String> flagged = overrides.keySet().stream().sorted().toList();
    Map<String, Object> decision = Map.of("source", "policy", "action", flagged.isEmpty() ? "allow" : "block", "flaggedCategories", flagged);
    return Map.of("categories", categories, "score", highest, "policy", Map.of("decision", decision), "processedAt", System.currentTimeMillis());
  }

  private static Map<String, Object> evaluated(double score) {
    String likelihood = score < 0.2 ? "very-unlikely" : score < 0.4 ? "unlikely" : score < 0.6 ? "possible" : score < 0.8 ? "likely" : "very-likely";
    return Map.of("status", "evaluated", "score", score, "likelihood", likelihood);
  }

  private static Map<String, Object> notEvaluated(String reason) {
    return Map.of("status", "not-evaluated", "reason", reason);
  }
}
