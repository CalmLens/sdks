package com.calmlens;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * A moderation decision for {@link MockCalmLensServerClient.Options#moderate} or {@link
 * MockCalmLensServerClient#completeProcessing(String, MockDecision)}. Start from a status, flag the
 * categories it found with their scores and qualifiers, and mark the categories it could not
 * assess:
 *
 * <pre>{@code
 * MockDecision.of("blocked").flag("violence", 0.92, Map.of("violence-threat", 0.9)).notEvaluated("sexual");
 * }</pre>
 *
 * <p>A decided status fills the asset's {@code classification.moderation} report as the API does:
 * every category (unflagged ones evaluated with score 0), the policy's
 * actions and {@code flaggedCategories}. {@link #pendingReview(String, List)} leaves it waiting for
 * human review. Each call checks its names and scores and throws {@link
 * ErrorCodes#SDK_INVALID_ARGUMENT} for one CalmLens does not have.
 */
public final class MockDecision {
  /** The policy action that gives each decided status. */
  private static final Map<MockCalmLensServerClient.Outcome, String> STATUS_ACTION = Map.of(
      MockCalmLensServerClient.Outcome.ALLOWED, "allow",
      MockCalmLensServerClient.Outcome.LIMITED, "limit",
      MockCalmLensServerClient.Outcome.AGE_RESTRICTED, "age-restrict",
      MockCalmLensServerClient.Outcome.BLOCKED, "block",
      MockCalmLensServerClient.Outcome.PURGED, "purge");

  private record Flag(double score, Map<String, Double> qualifiers) {}

  private final MockCalmLensServerClient.Outcome status;
  private final Map<String, Flag> flags = new LinkedHashMap<>();
  private final Set<String> notEvaluated = new LinkedHashSet<>();
  private String pendingReviewReason;
  private List<String> uncertainCategories = List.of();

  private MockDecision(MockCalmLensServerClient.Outcome status) { this.status = status; }

  /**
   * @param status {@code pending}, {@code failed}, {@code allowed}, {@code limited}, {@code
   *     age-restricted}, {@code blocked} or {@code purged}
   * @return a decision with that status and no findings
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for another status
   */
  public static MockDecision of(String status) {
    for (MockCalmLensServerClient.Outcome outcome : MockCalmLensServerClient.Outcome.values())
      if (outcome.value().equals(status)) return new MockDecision(outcome);
    throw invalid("status must be one of " + String.join(", ", Arrays.stream(MockCalmLensServerClient.Outcome.values()).map(MockCalmLensServerClient.Outcome::value).toList()));
  }

  /**
   * @param status the decision's status
   * @return a decision with that status and no findings
   */
  public static MockDecision of(MockCalmLensServerClient.Outcome status) { return new MockDecision(Objects.requireNonNull(status, "status")); }

  /** @return the decision's status */
  public MockCalmLensServerClient.Outcome status() { return status; }

  /**
   * Records findings in {@code category} with its score. The policy acts on a category at 0.5 and
   * above, so {@code flaggedCategories} lists it there unless the status is {@code allowed}.
   *
   * @param category a CalmLens category, such as {@code violence}
   * @param score from 0 to 1
   * @return this decision
   */
  public MockDecision flag(String category, double score) { return flag(category, score, Map.of()); }

  /**
   * Records findings in {@code category} with its score and scores for its qualifiers.
   *
   * @param category a CalmLens category, such as {@code violence}
   * @param score from 0 to 1
   * @param qualifiers scores from 0 to 1 by qualifier of that category, such as {@code
   *     Map.of("violence-threat", 0.9)}
   * @return this decision
   */
  public MockDecision flag(String category, double score, Map<String, Double> qualifiers) {
    checkFinding(category);
    if (!isScore(score)) throw invalid(category + "'s score must be from 0 to 1");
    List<String> known = MockClassification.QUALIFIERS.get(category);
    Map<String, Double> copy = new LinkedHashMap<>();
    for (Map.Entry<String, Double> qualifier : Objects.requireNonNull(qualifiers, "qualifiers").entrySet()) {
      if (!known.contains(qualifier.getKey())) throw invalid(qualifier.getKey() + " is not a qualifier of " + category);
      if (qualifier.getValue() == null || !isScore(qualifier.getValue())) throw invalid(qualifier.getKey() + "'s score must be from 0 to 1");
      copy.put(qualifier.getKey(), qualifier.getValue());
    }
    flags.put(category, new Flag(score, copy));
    return this;
  }

  /**
   * Marks {@code category} as not assessed ({@code not-evaluated} for reason {@code not-supported}).
   *
   * @param category a CalmLens category
   * @return this decision
   */
  public MockDecision notEvaluated(String category) {
    checkFinding(category);
    notEvaluated.add(category);
    return this;
  }

  /**
   * Leaves the decision waiting for human review with no uncertain categories, such as a {@code
   * sampled} one. See {@link #pendingReview(String, List)}.
   *
   * @param reason {@code sampled} or {@code uncertain}
   * @return this decision
   */
  public MockDecision pendingReview(String reason) { return pendingReview(reason, List.of()); }

  /**
   * Leaves the decision waiting for human review, as {@code classification.moderation.pendingReview}
   * reports: {@code sampled}, or {@code uncertain} with the categories that made it so. Its {@code
   * requestedAt} is when the decision is applied. The review queue's decision ({@link
   * MockCalmLensServerClient#decide}) clears it; {@code assets.decide} doesn't, as with the API.
   *
   * @param reason {@code sampled} or {@code uncertain}
   * @param uncertainCategories the CalmLens categories it is uncertain about; none for {@code sampled}
   * @return this decision
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} on a {@code pending} or {@code
   *     failed} decision, for another reason, for a {@code sampled} reason with uncertain
   *     categories, or for an unknown category
   */
  public MockDecision pendingReview(String reason, List<String> uncertainCategories) {
    Objects.requireNonNull(uncertainCategories, "uncertainCategories");
    if (!decided()) throw invalid("a " + status.value() + " decision can't wait for review");
    if (!"sampled".equals(reason) && !"uncertain".equals(reason)) throw invalid("reason must be sampled or uncertain");
    if (reason.equals("sampled") && !uncertainCategories.isEmpty()) throw invalid("a sampled review has no uncertain categories");
    for (String category : uncertainCategories)
      if (category == null || !MockClassification.CATEGORIES.contains(category)) throw invalid(category + " is not a CalmLens category");
    pendingReviewReason = reason;
    this.uncertainCategories = List.copyOf(uncertainCategories);
    return this;
  }

  private void checkFinding(String category) {
    if (!MockClassification.CATEGORIES.contains(category)) throw invalid(category + " is not a CalmLens category");
    if (!decided()) throw invalid("a " + status.value() + " decision has no findings");
    if (flags.containsKey(category) || notEvaluated.contains(category)) throw invalid(category + " is already in this decision");
  }

  private static boolean isScore(double score) { return Double.isFinite(score) && score >= 0 && score <= 1; }

  private static CalmLensException invalid(String message) { return new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, message); }

  boolean decided() { return status != MockCalmLensServerClient.Outcome.PENDING && status != MockCalmLensServerClient.Outcome.FAILED; }

  /** The likelihood the API reports for a score. */
  private static String likelihood(double score) {
    return score >= 0.8 ? "very-likely" : score >= 0.6 ? "likely" : score >= 0.4 ? "possible" : score >= 0.2 ? "unlikely" : "very-unlikely";
  }

  private String action(double score) { return status != MockCalmLensServerClient.Outcome.ALLOWED && score >= 0.5 ? STATUS_ACTION.get(status) : "allow"; }

  /**
   * The report a decided asset gets, as the API sends it: {@code categories}, {@code score} and
   * {@code policy}. Null for {@code pending} and {@code failed}.
   *
   * @param requestedAt when a pending review joined the queue
   */
  JsonObject report(long requestedAt) {
    if (!decided()) return null;
    JsonObject categories = new JsonObject(), policyCategories = new JsonObject();
    JsonArray flagged = new JsonArray();
    for (String category : MockClassification.CATEGORIES) {
      JsonObject result = new JsonObject();
      if (notEvaluated.contains(category)) {
        result.addProperty("status", "not-evaluated");
        result.addProperty("reason", "not-supported");
        categories.add(category, result);
        continue;
      }
      Flag flag = flags.get(category);
      double score = flag == null ? 0 : flag.score();
      result.addProperty("status", "evaluated");
      result.addProperty("likelihood", likelihood(score));
      result.addProperty("score", score);
      if (flag != null && !flag.qualifiers().isEmpty()) {
        JsonObject qualifiers = new JsonObject();
        flag.qualifiers().forEach((qualifier, some) -> {
          JsonObject item = new JsonObject();
          item.addProperty("status", "evaluated");
          item.addProperty("someScore", some);
          item.addProperty("likelihood", likelihood(some));
          qualifiers.add(qualifier, item);
        });
        result.add("qualifiers", qualifiers);
      }
      categories.add(category, result);
      JsonObject policyCategory = new JsonObject();
      policyCategory.addProperty("score", score);
      policyCategory.addProperty("action", action(score));
      JsonObject source = new JsonObject();
      source.addProperty("kind", score >= 0.5 ? "default" : "below-threshold");
      policyCategory.add("source", source);
      // The mock keeps no policies: the category's setting is the decision's own action.
      JsonObject settings = new JsonObject();
      settings.addProperty("action", STATUS_ACTION.get(status));
      settings.add("allowances", new JsonArray());
      settings.add("restrictions", new JsonArray());
      policyCategory.add("settings", settings);
      policyCategories.add(category, policyCategory);
      if (!action(score).equals("allow")) flagged.add(category);
    }
    JsonObject report = new JsonObject();
    report.addProperty("source", "policy");
    report.add("rule", JsonNull.INSTANCE);
    report.addProperty("automatedStatus", status.value());
    report.add("regions", new JsonArray());
    report.add("linkSafety", JsonNull.INSTANCE);
    // The mock analyses no audio or video, so a decision has no findings timeline.
    report.add("timeline", JsonNull.INSTANCE);
    report.add("flaggedCategories", flagged);
    report.add("categories", policyCategories);
    report.addProperty("explanationComplete", true);
    // The mock keeps no policies, so no policy is named.
    report.add("policy", JsonNull.INSTANCE);
    JsonObject pendingReview = null;
    if (pendingReviewReason != null) {
      pendingReview = new JsonObject();
      pendingReview.addProperty("requestedAt", requestedAt);
      pendingReview.addProperty("reason", pendingReviewReason);
      JsonArray uncertain = new JsonArray();
      uncertainCategories.forEach(uncertain::add);
      pendingReview.add("uncertainCategories", uncertain);
    }
    report.add("pendingReview", pendingReview == null ? JsonNull.INSTANCE : pendingReview);
    JsonObject raw = new JsonObject();
    raw.add("categories", categories);
    raw.add("hashMatches", new JsonArray());
    report.add("raw", raw);
    return report;
  }

  /** @return the categories the policy acted on, in the API's order */
  List<String> flaggedCategories() {
    JsonObject report = report(0);
    List<String> flagged = new ArrayList<>();
    if (report != null) report.getAsJsonArray("flaggedCategories").forEach(c -> flagged.add(c.getAsString()));
    return flagged;
  }

  @Override public String toString() { return "MockDecision[status=" + status.value() + ", flags=" + flags.keySet() + ", notEvaluated=" + notEvaluated + ", pendingReview=" + pendingReviewReason + "]"; }
}
