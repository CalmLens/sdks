package calmmarket;

import com.calmlens.CalmLensServerClient;
import com.calmlens.testing.MockCalmLensServerClient;
import java.net.ConnectException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Demo mode, used only when requested explicitly ({@code CALMLENS_DEMO=1} or {@code --demo}).
 * Each CalmLens call is answered by the SDK's offline mock with the outcome the seller selected,
 * after the real client's validation and encoding. Reports and extracted text are
 * synthetic and labelled as such; nothing is classified. Live mode never loads this class's mocks.
 */
final class Demo implements Calmmarket.Backend {
  /** A demo photo stays pending this long, then takes the selected outcome. */
  static final Duration REVIEW_DELAY = Duration.ofSeconds(2);

  private static final String PROJECT = "demo-project";

  /** A fresh mock per call. The mock makes no retries, so each queued answer is used exactly once. */
  private static MockCalmLensServerClient mock() {
    return new MockCalmLensServerClient(CalmLensServerClient.builder().apiKey("demo-key").projectId(PROJECT)
        .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1"));
  }

  @Override public boolean demo() { return true; }

  @Override public CalmLensServerClient textModeration(String choice) {
    MockCalmLensServerClient mock = mock();
    if (choice.equals("unavailable")) return mock.enqueueFailure(new ConnectException("Connection refused")).client();
    boolean blocked = choice.equals("description-blocked");
    return mock.enqueue(200, text(id("asset"), "allowed", null))
        .enqueue(200, text(id("asset"), blocked ? "blocked" : "allowed", null)).client();
  }

  @Override public CalmLensServerClient photoUploads(int photos) {
    MockCalmLensServerClient mock = mock();
    for (int i = 0; i < photos; i++) mock.enqueue(200, asset(id("asset"), "pending", null, null));
    return mock.client();
  }

  @Override public CalmLensServerClient photo(Calmmarket.Photo photo) {
    MockCalmLensServerClient mock = mock();
    if (Duration.between(photo.submittedAt, Instant.now()).compareTo(REVIEW_DELAY) < 0)
      return mock.enqueue(200, asset(photo.assetId, "pending", photo.externalId, null)).client();
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
    asset.put("name", photo.name);
    if (extractedText != null) asset.put("content", Map.of("status", "stored", "extractedText", Map.of("type", "string", "content", extractedText)));
    if (photo.demoReviewerBlocked) {
      // A reviewer's decision replaces the automated one.
      Map<String, Object> moderation = moderation(asset);
      moderation.put("decision", "blocked");
      moderation.put("manualReviews", List.of(Map.of("id", id("rev"), "decision", "blocked", "note", "Simulated portal decision", "decidedBy", Map.of("type", "user", "id", "demo-reviewer"), "reviewedAt", System.currentTimeMillis(), "applied", true)));
    }
    return mock.enqueue(200, asset).client();
  }

  @Override public CalmLensServerClient textAsset(String assetId, String externalId) {
    return mock().enqueue(200, text(assetId, "allowed", externalId)).client();
  }

  @Override public CalmLensServerClient contentRemoval(String assetId) {
    Map<String, Object> removed = asset(assetId, "allowed", null, null);
    removed.put("content", Map.of("status", "removed", "removalReason", "requested", "updatedAt", System.currentTimeMillis()));
    return mock().enqueue(200, removed).client();
  }

  /** The demo CDN answers with the bytes kept for the photo, or 404 once they are removed. */
  @Override public CalmLensServerClient preview(Calmmarket.Photo photo) {
    byte[] bytes = photo.demoBytes;
    return (bytes == null ? mock().enqueueCdn(404, "text/plain", new byte[0]) : mock().enqueueCdn(200, photo.mime, bytes)).client();
  }

  @Override public CalmLensServerClient events() { return null; }

  /** One synthetic {@code asset.blocked} event, with the facts a portal decision carries. */
  @Override public CalmLensServerClient simulatedReview(Calmmarket.Photo photo) {
    String id = id("evt");
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("id", id);
    event.put("type", "asset.blocked");
    event.put("projectId", PROJECT);
    event.put("createdAt", System.currentTimeMillis());
    event.put("actor", Map.of("type", "user", "id", "demo-reviewer"));
    event.put("severity", "high");
    event.put("title", "Asset blocked");
    event.put("assetId", photo.assetId);
    event.put("asset", Map.of("id", photo.assetId, "externalId", photo.externalId,
        "upload", Map.of("status", "completed"),
        "classification", Map.of("status", "completed", "testInput", false, "moderation", Map.of("decision", "blocked")),
        "content", Map.of("status", "stored")));
    event.put("facts", List.of(
        Map.of("key", "asset-name", "value", photo.name),
        Map.of("key", "asset-type", "value", "image"),
        Map.of("key", "note", "value", "Simulated portal decision")));
    return mock().enqueueEvents("demo-" + id, false, event).client();
  }

  // ---------------------------------------------------------------- Synthetic responses

  /**
   * A synthetic asset with its content stored. {@code status} is {@code pending} (still
   * processing), a moderation status such as {@code allowed} or {@code blocked}, or {@code error}
   * (processing failed).
   */
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final String BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  /** A CalmLens-style ID for a simulated object: the prefix, `_` and 20 random base62 characters. */
  private static String id(String prefix) {
    StringBuilder id = new StringBuilder(prefix).append('_');
    for (int i = 0; i < 20; i++) id.append(BASE62.charAt(RANDOM.nextInt(BASE62.length())));
    return id.toString();
  }

  private static Map<String, Object> asset(String id, String status, String externalId, Map<String, Object> report) {
    Map<String, Object> asset = new LinkedHashMap<>();
    asset.put("id", Objects.requireNonNull(id));
    asset.put("name", "listing-photo");
    asset.put("projectId", PROJECT);
    asset.put("type", "image");
    asset.put("metadata", List.of());
    asset.put("parentPages", List.of());
    asset.put("createdAt", System.currentTimeMillis());
    asset.put("tags", List.of());
    asset.put("visibility", "private");
    if (externalId != null) asset.put("externalId", externalId);
    String processing = switch (status) {
      case "pending" -> "processing";
      case "error" -> "failed";
      default -> "completed";
    };
    Map<String, Object> classification = new LinkedHashMap<>();
    classification.put("status", processing);
    classification.put("testInput", false);
    asset.put("upload", Map.of("status", "completed"));
    asset.put("classification", classification);
    Map<String, Object> moderation = new LinkedHashMap<>();
    // The decision is null until there is one: moderation is pending.
    moderation.put("decision", status.equals("pending") || status.equals("error") ? null : status);
    moderation.put("manualReviews", List.of());
    moderation.put("flaggedCategories", List.of());
    moderation.put("regions", List.of());
    if (report != null) moderation.putAll(report);
    classification.put("moderation", moderation);
    asset.put("content", Map.of("status", "stored"));
    return asset;
  }

  /** A synthetic text asset for a title or description. */
  private static Map<String, Object> text(String id, String status, String externalId) {
    Map<String, Object> asset = asset(id, status, externalId, null);
    asset.put("name", "listing-text");
    asset.put("type", "plaintext-document");
    return asset;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> moderation(Map<String, Object> asset) { return (Map<String, Object>) ((Map<String, Object>) asset.get("classification")).get("moderation"); }

  /** A synthetic report: every category evaluated at a low score unless overridden. */
  private static Map<String, Object> report(Map<String, Map<String, Object>> overrides) {
    Map<String, Object> categories = new LinkedHashMap<>();
    for (String key : Calmmarket.CATEGORIES) {
      Map<String, Object> result = overrides.getOrDefault(key, evaluated(0.02));
      categories.put(key, result);
    }
    // The simulated policy acts on every overridden category, as a real report's policy decision names them.
    List<String> flagged = overrides.keySet().stream().sorted().toList();
    return Map.of("raw", Map.of("categories", categories, "hashMatches", List.of()), "categories", Map.of(),
        "source", "policy", "automatedStatus", flagged.isEmpty() ? "allowed" : "blocked",
        "flaggedCategories", flagged, "explanationComplete", true);
  }

  private static Map<String, Object> evaluated(double score) {
    String likelihood = score < 0.2 ? "very-unlikely" : score < 0.4 ? "unlikely" : score < 0.6 ? "possible" : score < 0.8 ? "likely" : "very-likely";
    return Map.of("status", "evaluated", "score", score, "likelihood", likelihood);
  }

  private static Map<String, Object> notEvaluated(String reason) {
    return Map.of("status", "not-evaluated", "reason", reason);
  }
}
