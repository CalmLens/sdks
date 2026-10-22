package calmmarket;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.CalmLensServerClient;
import com.calmlens.ErrorCodes;
import com.calmlens.MockCalmLensServerClient;
import com.calmlens.Models.*;
import com.calmlens.Transport;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.ByteArrayOutputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class CalmmarketTest {
  static final byte[] PNG = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
  static final byte[] GIF = "GIF89a-not-really-a-gif".getBytes(StandardCharsets.ISO_8859_1);
  static final String SECRET = "a-local-development-secret";

  // ------------------------------------------------------------ helpers

  /** A mock standing in for the live API. Retries are off so each queued answer is used once. */
  static MockCalmLensServerClient mock() {
    return new MockCalmLensServerClient(CalmLensServerClient.builder("key", "project-1")
        .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1").maxRetries(0));
  }

  static Calmmarket live(MockCalmLensServerClient mock, String secret) { return new Calmmarket(Calmmarket.live(mock.client), secret); }

  static Calmmarket demoApp(String secret) { return new Calmmarket(new Demo(), secret); }

  static Calmmarket.Response submit(Calmmarket app, String token, String title, String description, String price,
      List<byte[]> photos, String textChoice, List<String> photoChoices) {
    String boundary = "----calmmarket-test";
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    Map<String, String> fields = new LinkedHashMap<>();
    fields.put("csrf", token);
    fields.put("title", title);
    fields.put("description", description);
    fields.put("price", price);
    if (textChoice != null) fields.put("demo_text", textChoice);
    for (int i = 0; photoChoices != null && i < photoChoices.size(); i++) fields.put("demo_photo" + (i + 1), photoChoices.get(i));
    fields.forEach((name, value) -> body.writeBytes(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n").getBytes(StandardCharsets.UTF_8)));
    for (int i = 0; i < photos.size(); i++) {
      body.writeBytes(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"photo" + (i + 1) + "\"; filename=\"item-" + (i + 1) + ".png\"\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.UTF_8));
      body.writeBytes(photos.get(i));
      body.writeBytes("\r\n".getBytes(StandardCharsets.UTF_8));
    }
    // An unused file input arrives as an empty part and must be ignored.
    body.writeBytes(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"photo4\"; filename=\"\"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n").getBytes(StandardCharsets.UTF_8));
    body.writeBytes(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    return app.handle(new Calmmarket.Request("POST", "/listings", null,
        Map.of("content-type", "multipart/form-data; boundary=" + boundary), body.toByteArray()));
  }

  static Calmmarket.Response submit(Calmmarket app, String title, String description, String price, byte[] photo) {
    return submit(app, app.csrf, title, description, price, List.of(photo), null, null);
  }

  /** Demo submission with one photo per selected photo result. */
  static Calmmarket.Response demo(Calmmarket app, String textChoice, String... photoChoices) {
    List<byte[]> photos = new ArrayList<>();
    for (int i = 0; i < Math.max(1, photoChoices.length); i++) photos.add(PNG);
    return submit(app, app.csrf, "Oak reading lamp", "Warm light, works perfectly.", "25", photos, textChoice, List.of(photoChoices));
  }

  /** Live submission (a mock stands in for the API) with {@code count} photos. */
  static Calmmarket.Response live(Calmmarket app, int count) {
    List<byte[]> photos = new ArrayList<>();
    for (int i = 0; i < count; i++) photos.add(PNG);
    return submit(app, app.csrf, "Oak reading lamp", "Warm light, works perfectly.", "25", photos, null, null);
  }

  static Calmmarket.Response get(Calmmarket app, String path) {
    return app.handle(new Calmmarket.Request("GET", path, null, Map.of(), new byte[0]));
  }

  static Calmmarket.Response post(Calmmarket app, String path, String form) {
    return app.handle(new Calmmarket.Request("POST", path, null,
        Map.of("content-type", "application/x-www-form-urlencoded"), form.getBytes(StandardCharsets.UTF_8)));
  }

  static Calmmarket.Response webhook(Calmmarket app, byte[] body, String signature, String timestamp) {
    Map<String, String> headers = new HashMap<>();
    if (signature != null) headers.put(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER, signature);
    headers.put(CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER, timestamp);
    headers.put("content-type", "application/json");
    return app.handle(new Calmmarket.Request("POST", "/webhooks/calmlens", null, headers, body));
  }

  static Calmmarket.Response signedWebhook(Calmmarket app, String body) {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    String now = Long.toString(System.currentTimeMillis() / 1000);
    return webhook(app, bytes, CalmLensServerClient.createWebhookSignatureHeader(SECRET, now, bytes), now);
  }

  static String event(String id, String type, String assetId, String facts) {
    return "{\"id\":\"" + id + "\",\"type\":\"" + type + "\",\"createdAt\":1760000000000,\"projectId\":\"project-1\",\"data\":{\"severity\":\"high\",\"title\":\"t\","
        + "\"description\":null,\"assetId\":\"" + assetId + "\",\"asset\":{\"id\":\"" + assetId + "\",\"upload\":{\"status\":\"completed\"},\"classification\":{\"status\":\"completed\",\"moderation\":{\"decision\":\"approved\",\"action\":null}},\"content\":{\"status\":\"stored\"}},\"facts\":" + facts + "}}";
  }

  static String html(Calmmarket.Response response) { return new String(response.body(), StandardCharsets.UTF_8); }

  static void expire(Calmmarket.Listing listing) {
    for (Calmmarket.Photo photo : listing.photos) photo.submittedAt = Instant.now().minusSeconds(3);
  }

  static Map<String, Object> evaluated(double score) { return Map.of("status", "evaluated", "score", score); }

  static Map<String, Object> partial(double score) { return Map.of("status", "partial", "score", score); }

  static Map<String, Object> notEvaluated(String reason) { return Map.of("status", "not-evaluated", "reason", reason); }

  /** A test report. {@code flagged} is not part of the report: {@link #asset} turns it into the policy's action. */
  static Map<String, Object> report(boolean flagged, Map<String, Map<String, Object>> categories) {
    return Map.of(FLAGGED, flagged, "categories", categories);
  }

  private static final String FLAGGED = "test-flagged";

  /**
   * An asset as the API returns it, with its content stored. {@code decision} is {@code pending}
   * (still processing), {@code error} (processing failed), or the moderation status after
   * processing: {@code approved}, {@code rejected} or a value this app does not know. A flagged
   * report sets the policy action: {@code hide} on a rejection, {@code alert} otherwise.
   */
  static Map<String, Object> asset(String id, String decision, String externalId, Map<String, Object> report) {
    Map<String, Object> asset = new LinkedHashMap<>();
    asset.put("id", id);
    if (externalId != null) asset.put("externalId", externalId);
    Map<String, Object> classification = new LinkedHashMap<>();
    classification.put("status", switch (decision) {
      case "pending" -> "processing";
      case "error" -> "failed";
      default -> "completed";
    });
    asset.put("upload", Map.of("status", "completed"));
    asset.put("classification", classification);
    Map<String, Object> moderation = new LinkedHashMap<>();
    moderation.put("decision", decision.equals("pending") || decision.equals("error") ? "pending" : decision);
    boolean flagged = report != null && Boolean.TRUE.equals(report.get(FLAGGED));
    moderation.put("action", flagged ? (decision.equals("rejected") ? "hide" : "flag") : null);
    if (report != null) {
      Map<String, Object> body = new LinkedHashMap<>(report);
      body.remove(FLAGGED);
      moderation.putAll(body);
    }
    classification.put("moderation", moderation);
    asset.put("content", Map.of("status", "stored"));
    return asset;
  }

  /** Photo {@code number} of {@code listing} as the API returns it, carrying the externalId sent with the upload. */
  static Map<String, Object> photo(Calmmarket.Listing listing, int number, String status, Map<String, Object> report) {
    return asset("photo-" + number, status, listing.id + ":photo-" + number, report);
  }

  static Map<String, Object> text(String id, String status, boolean flagged) { return asset(id, status, null, report(flagged, Map.of())); }

  static Map<String, Object> removed(String id) {
    Map<String, Object> asset = asset(id, "approved", null, null);
    asset.put("content", Map.of("status", "removed", "removalReason", "requested"));
    return asset;
  }

  /** Builds a response model the way the SDK reads it from the API. */
  static <T> T model(Object json, Class<T> type) {
    Gson gson = new Gson();
    return gson.fromJson(gson.toJsonTree(json), type);
  }

  static final Map<String, Object> CLEAN = report(false, Map.of("violence", evaluated(0.02), "criminal-activity", evaluated(0.03)));

  /** A mock the app treats as the live API: text approved, every photo queued as pending. */
  static MockCalmLensServerClient liveSubmission(int photos) {
    MockCalmLensServerClient mock = mock()
        .enqueue(200, text("title-1", "approved", false))
        .enqueue(200, text("description-1", "approved", false));
    for (int i = 1; i <= photos; i++) mock.enqueue(200, asset("photo-" + i, "pending", null, null));
    return mock;
  }

  static List<String> paths(MockCalmLensServerClient mock, int from) {
    List<MockCalmLensServerClient.Request> sent = mock.requests();
    return sent.subList(from, sent.size()).stream().map(request -> request.method() + " " + request.path()).toList();
  }

  // ------------------------------------------------------------ OCR on upload

  @Test
  void everyPhotoIsUploadedPrivatelyWithOcrEnabled() {
    MockCalmLensServerClient mock = liveSubmission(3);
    Calmmarket app = live(mock, "");
    // A submitted demo override must never affect live moderation.
    Calmmarket.Response response = submit(app, app.csrf, "Oak reading lamp", "Warm light.", "25", List.of(PNG, GIF, PNG),
        "description-rejected", List.of("text-rejected", "error", "visual-rejected"));
    assertEquals(303, response.status());
    assertEquals("/?notice=submitted", response.headers().get("location"));
    Calmmarket.Listing listing = app.listings().get(0);
    List<MockCalmLensServerClient.Request> sent = mock.requests();
    assertEquals(5, sent.size());
    assertEquals(listing.id + ":title", sent.get(0).query().get("externalId"));
    assertEquals("false", sent.get(0).query().get("queue"));
    assertEquals(listing.id + ":title", sent.get(0).header("Idempotency-Key"), "the listing's own key makes a retried submission safe");
    assertEquals(listing.id + ":description", sent.get(1).query().get("externalId"));
    for (int i = 0; i < 3; i++) {
      MockCalmLensServerClient.Request upload = sent.get(2 + i);
      JsonObject options = JsonParser.parseString(upload.query().get("processingOptions")).getAsJsonObject();
      assertTrue(options.getAsJsonObject("features").getAsJsonObject("ocr").get("enabled").getAsBoolean(), "photo " + (i + 1));
      assertTrue(options.get("keepContentAfterProcessing").getAsBoolean());
      assertEquals("true", upload.query().get("queue"));
      assertEquals("private", upload.query().get("visibility"));
      assertEquals(listing.id + ":photo-" + (i + 1), upload.query().get("externalId"));
      assertEquals(listing.id + ":photo-" + (i + 1), upload.header("Idempotency-Key"));
      assertEquals(i == 1 ? "image/gif" : "image/png", upload.query().get("contentType"));
      assertArrayEquals(i == 1 ? GIF : PNG, upload.body());
    }
    assertEquals(List.of("photo-1", "photo-2", "photo-3"), listing.photos.stream().map(photo -> photo.assetId).toList());
    assertEquals(Calmmarket.State.IN_REVIEW, listing.state());
  }

  // ------------------------------------------------------------ explaining decisions

  @Test
  void retrievesExtractedTextWithTheImageWithoutListingChildren() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, "");
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    Map<String, Object> image = photo(listing, 1, "rejected", report(true, Map.of("criminal-activity", evaluated(0.88))));
    image.put("content", Map.of("status", "stored", "extractedText", Map.of("type", "string", "content", "Call 555-0100 <now>")));
    mock.enqueue(200, image);
    get(app, "/");
    assertEquals(List.of("GET /v1/assets/photo-1"), paths(mock, 3));
    Calmmarket.Photo photo = listing.photos.get(0);
    assertEquals("Call 555-0100 <now>", photo.extractedText.content());
    assertEquals(Calmmarket.Ocr.FOUND, photo.ocr);
    assertEquals(Calmmarket.Driver.AUTOMATED, photo.driver());
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertEquals(List.of("photo-1"), photo.contentIds());
    assertEquals(0, mock.remainingResponses());
  }

  @Test
  void combinedCategoriesPreserveUnavailableResults() {
    AssetModeration report = model(report(true, Map.of("violence", evaluated(0.91),
        "hate", partial(0.4), "self-harm", notEvaluated("not-supported"))), AssetModeration.class);
    Map<String, Calmmarket.CategoryRow> rows = new LinkedHashMap<>();
    for (Calmmarket.CategoryRow row : Calmmarket.explain(report)) rows.put(row.key(), row);
    assertEquals(0.91, rows.get("violence").score());
    assertEquals(0.4, rows.get("hate").score());
    assertEquals("partial", rows.get("hate").status());
    assertNull(rows.get("self-harm").score());
    assertEquals("not-supported", rows.get("self-harm").reason());
    assertEquals(List.of(), Calmmarket.explain(null));
  }

  // ------------------------------------------------------------ listing decision

  @Test
  void aListingWithAnyPhotoNotApprovedStaysHeld() {
    MockCalmLensServerClient mock = liveSubmission(2);
    Calmmarket app = live(mock, "");
    live(app, 2);
    Calmmarket.Listing listing = app.listings().get(0);
    String photoLink = "/listings/" + listing.id + "/photos/1";
    mock.enqueue(200, photo(listing, 1, "approved", CLEAN))
        .enqueue(200, photo(listing, 2, "pending", null));
    assertFalse(html(get(app, "/")).contains("<article class=\"card\">"));
    assertEquals(Calmmarket.State.IN_REVIEW, listing.state());
    // A status this app does not know is never treated as approval.
    mock.enqueue(200, photo(listing, 2, "quarantined", null));
    get(app, "/");
    assertEquals("quarantined", listing.photos.get(1).moderation.value());
    assertFalse(listing.photos.get(1).moderation.isKnown());
    assertFalse(listing.visible());
    mock.enqueue(200, photo(listing, 2, "error", null));
    get(app, "/");
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertFalse(html(get(app, "/")).contains("<article class=\"card\">"));
    // An errored photo is not polled again; a later decision arrives by event. Approve it:
    listing.photos.get(1).processing = AssetClassificationStatus.COMPLETED;
    listing.photos.get(1).moderation = AssetModerationStatus.APPROVED;
    assertTrue(listing.visible());
    listing.photos.get(1).moderation = AssetModerationStatus.REJECTED;
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertEquals(List.of("GET /v1/assets/photo-1", "GET /v1/assets/photo-2",
        "GET /v1/assets/photo-2", "GET /v1/assets/photo-2"), paths(mock, 4));
    assertTrue(html(get(app, "/")).contains(photoLink + "\""), "the approved photo itself can still be previewed by the seller");
  }

  // ------------------------------------------------------------ withdrawing

  @Test
  void withdrawingRemovesStoredContentOfEveryPhotoAndItsTextAndStopsPreviews() {
    MockCalmLensServerClient mock = liveSubmission(2);
    Calmmarket app = live(mock, "");
    live(app, 2);
    Calmmarket.Listing listing = app.listings().get(0);
    mock.enqueue(200, photo(listing, 1, "approved", CLEAN))

        .enqueue(200, photo(listing, 2, "approved", CLEAN));
    get(app, "/");
    assertTrue(listing.visible());
    int before = mock.requests().size();
    mock.enqueue(200, removed("photo-1")).enqueue(200, removed("photo-2"));
    Calmmarket.Response withdrawn = post(app, "/listings/" + listing.id + "/withdraw", "csrf=" + app.csrf);
    assertEquals(303, withdrawn.status());
    assertEquals("/?notice=withdrawn", withdrawn.headers().get("location"));
    assertEquals(List.of("DELETE /v1/assets/photo-1/content", "DELETE /v1/assets/photo-2/content"), paths(mock, before));
    assertEquals(Calmmarket.State.WITHDRAWN, listing.state());
    assertFalse(listing.removalPending());
    assertEquals(410, get(app, "/listings/" + listing.id + "/photos/1").status());
    assertEquals(410, get(app, "/listings/" + listing.id + "/photos/2").status());
    // The page no longer links the photos, and nothing about them is requested again.
    assertFalse(html(get(app, "/")).contains("/listings/" + listing.id + "/photos/"));
    assertEquals(before + 2, mock.requests().size());
    assertEquals(409, post(app, "/listings/" + listing.id + "/withdraw", "csrf=" + app.csrf).status());
  }

  @Test
  void withdrawingRetriesOnlyFailedRemovalsAndLeavesSafetyHoldsAlone() {
    MockCalmLensServerClient mock = liveSubmission(3);
    Calmmarket app = live(mock, "");
    live(app, 3);
    Calmmarket.Listing listing = app.listings().get(0);
    for (int i = 1; i <= 3; i++) mock.enqueue(200, photo(listing, i, "approved", CLEAN));
    get(app, "/");
    int before = mock.requests().size();
    mock.enqueue(200, removed("photo-1")).enqueueTimeout().enqueueError(ErrorCodes.ASSET_SAFETY_HELD);
    Calmmarket.Response response = post(app, "/listings/" + listing.id + "/withdraw", "csrf=" + app.csrf);
    assertEquals("/?notice=withdrawn-pending", response.headers().get("location"));
    assertTrue(listing.removalPending());
    assertEquals(Calmmarket.State.WITHDRAWN, listing.state(), "the listing is down even while removal is pending");
    assertEquals(410, get(app, "/listings/" + listing.id + "/photos/1").status());
    mock.enqueue(200, removed("photo-2"));
    assertEquals(303, post(app, "/listings/" + listing.id + "/withdraw", "csrf=" + app.csrf).status());
    assertEquals(List.of("DELETE /v1/assets/photo-1/content", "DELETE /v1/assets/photo-2/content", "DELETE /v1/assets/photo-3/content",
        "DELETE /v1/assets/photo-2/content"), paths(mock, before));
    assertFalse(listing.removalPending());
    assertEquals(Set.of("photo-3"), listing.photos.get(2).safetyHeld);
    // A removal response whose content status is not removed is not trusted as removal.
    MockCalmLensServerClient unconfirmed = liveSubmission(1);
    Calmmarket other = live(unconfirmed, "");
    live(other, 1);
    unconfirmed.enqueue(200, asset("photo-1", "approved", null, null));
    post(other, "/listings/" + other.listings().get(0).id + "/withdraw", "csrf=" + other.csrf);
    assertTrue(other.listings().get(0).removalPending());
    assertEquals(List.of("DELETE /v1/assets/photo-1/content"), paths(unconfirmed, 3));
  }

  @Test
  void demoWithdrawalStopsServingThePhoto() {
    Calmmarket app = demoApp("");
    demo(app, "approved", "clean-text");
    Calmmarket.Listing listing = app.listings().get(0);
    expire(listing);
    Calmmarket.Response served = get(app, "/listings/" + listing.id + "/photos/1");
    assertEquals(200, served.status());
    assertArrayEquals(PNG, served.body());
    assertEquals(303, post(app, "/listings/" + listing.id + "/withdraw", "csrf=" + app.csrf).status());
    Calmmarket.Photo photo = listing.photos.get(0);
    assertEquals(Set.of(photo.assetId), photo.contentRemoved);
    assertNull(photo.demoBytes);
    assertEquals(410, get(app, "/listings/" + listing.id + "/photos/1").status());
  }

  // ------------------------------------------------------------ demo mode

  @ParameterizedTest
  @CsvSource({
      "no-text,approved,NO_TEXT,NONE,LIVE",
      "clean-text,approved,FOUND,NONE,LIVE",
      "text-rejected,rejected,FOUND,AUTOMATED,HELD",
      "visual-rejected,rejected,FOUND,AUTOMATED,HELD",
      "error,failed,NOT_CHECKED,NONE,HELD"})
  void demoOutcomesAreExplained(String choice, String status, Calmmarket.Ocr ocr, Calmmarket.Driver driver, Calmmarket.State state) {
    Calmmarket app = demoApp("");
    Calmmarket.Response response = demo(app, "approved", choice);
    assertEquals(303, response.status());
    Calmmarket.Listing listing = app.listings().get(0);
    assertEquals(Calmmarket.State.IN_REVIEW, listing.state());
    assertEquals(403, get(app, "/listings/" + listing.id + "/photos/1").status());
    assertEquals("3", get(app, "/").headers().get("refresh"));

    expire(listing);
    get(app, "/");
    Calmmarket.Photo photo = listing.photos.get(0);
    assertEquals(status, photo.decision());
    assertEquals(ocr, photo.ocr);
    assertEquals(driver, photo.driver());
    assertEquals(state, listing.state());
    Calmmarket.Response preview = get(app, "/listings/" + listing.id + "/photos/1");
    assertEquals(status.equals("approved") ? 200 : 403, preview.status());
    if (ocr == Calmmarket.Ocr.FOUND) assertEquals("string", photo.extractedText.type());
  }

  @Test
  void demoListingWithOneRejectedPhotoStaysOffTheMarket() {
    Calmmarket app = demoApp("");
    demo(app, "approved", "no-text", "text-rejected", "clean-text");
    Calmmarket.Listing listing = app.listings().get(0);
    expire(listing);
    String page = html(get(app, "/"));
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertFalse(page.contains("<article class=\"card\">"));
    assertEquals(List.of(AssetModerationStatus.APPROVED, AssetModerationStatus.REJECTED, AssetModerationStatus.APPROVED), listing.photos.stream().map(photo -> photo.moderation).toList());
  }

  @Test
  void rejectedDescriptionUploadsNoPhoto() {
    Calmmarket app = demoApp("");
    Calmmarket.Response response = demo(app, "description-rejected", "no-text");
    assertEquals("/?notice=description-rejected", response.headers().get("location"));
    assertTrue(app.listings().isEmpty());
    assertEquals("held", app.activity().get(0).kind());
  }

  @Test
  void unavailableCalmLensFailsClosed() {
    Calmmarket app = demoApp("");
    assertEquals(502, demo(app, "unavailable", "no-text").status());
    assertTrue(app.listings().isEmpty());
  }

  @Test
  void simulatedReviewerRejectionHoldsTheListing() {
    Calmmarket app = demoApp("");
    demo(app, "approved", "no-text");
    Calmmarket.Listing listing = app.listings().get(0);
    expire(listing);
    get(app, "/");
    assertTrue(listing.visible());
    assertEquals(303, post(app, "/demo/review", "csrf=" + app.csrf + "&listing=" + listing.id).status());
    Calmmarket.Photo photo = listing.photos.get(0);
    assertEquals(AssetModerationStatus.REJECTED, photo.moderation);
    assertEquals(Calmmarket.Driver.REVIEWER, photo.driver());
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertEquals(403, get(app, "/listings/" + listing.id + "/photos/1").status());
    Calmmarket.Activity review = app.activity().get(0);
    assertEquals("review", review.kind());
    List<String> values = review.facts().stream().map(Calmmarket.FactRow::value).toList();
    assertTrue(values.contains("Demo reviewer"));
    assertFalse(values.contains("demo-reviewer"), "the hidden reviewer ID is not shown");
    assertEquals(409, post(app, "/demo/review", "csrf=" + app.csrf + "&listing=" + listing.id).status());
  }

  @Test
  void demoModeHasNoEventsFeed() {
    Calmmarket app = demoApp("");
    assertEquals(400, post(app, "/reviews/sync", "csrf=" + app.csrf).status());
  }

  // ------------------------------------------------------------ validation, notices and form tokens

  @Test
  void rejectsInvalidSubmissionsBeforeAnyRequest() {
    MockCalmLensServerClient mock = mock();
    Calmmarket app = live(mock, "");
    assertEquals(400, submit(app, "Lamp", "Nice", "25", "not an image".getBytes(StandardCharsets.UTF_8)).status());
    assertEquals(400, submit(app, "Lamp", "Nice", "free", PNG).status());
    assertEquals(400, submit(app, "Lamp", "Nice", "0", PNG).status());
    assertEquals(400, submit(app, "Lamp", "Nice", "1.001", PNG).status());
    assertEquals(400, submit(app, "", "Nice", "25", PNG).status());
    assertEquals(400, submit(app, "x".repeat(Calmmarket.MAX_TITLE + 1), "Nice", "25", PNG).status());
    assertEquals(400, submit(app, "Lamp", "", "25", PNG).status());
    assertEquals(400, submit(app, app.csrf, "Lamp", "Nice", "25", List.of(), null, null).status());
    byte[] large = Arrays.copyOf(PNG, Calmmarket.MAX_PHOTO_BYTES + 1);
    assertEquals(400, submit(app, "Lamp", "Nice", "25", large).status());
    assertEquals(0, mock.requests().size());
    assertTrue(app.listings().isEmpty());
    assertEquals(404, get(app, "/listings/unknown/photos/1").status());
    assertEquals(415, app.handle(new Calmmarket.Request("POST", "/listings", null, Map.of("content-type", "text/plain"), new byte[1])).status());
  }

  @Test
  void noticesComeFromKnownKeysAndNeverFromUrlText() {
    Calmmarket app = demoApp("");
    String injected = html(app.handle(new Calmmarket.Request("GET", "/", "notice=%3Cb%3EYour+account+is+locked%3C%2Fb%3E", Map.of(), new byte[0])));
    assertFalse(injected.contains("Your account is locked"));
    assertFalse(injected.contains("class=\"notice\""));
    String known = html(app.handle(new Calmmarket.Request("GET", "/", "notice=submitted", Map.of(), new byte[0])));
    assertTrue(known.contains("class=\"notice\""));
  }

  @Test
  void everyFormNeedsTheFormToken() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, "");
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    int before = mock.requests().size();
    assertEquals(403, submit(app, "wrong-token", "Lamp", "Nice", "25", List.of(PNG), null, null).status());
    assertEquals(403, post(app, "/listings/" + listing.id + "/withdraw", "csrf=wrong").status());
    assertEquals(403, post(app, "/listings/" + listing.id + "/withdraw", "").status());
    assertEquals(403, post(app, "/reviews/sync", "csrf=wrong").status());
    assertFalse(listing.withdrawn);
    assertEquals(1, app.listings().size());
    assertEquals(before, mock.requests().size());
    Calmmarket demoApp = demoApp("");
    demo(demoApp, "approved", "no-text");
    Calmmarket.Listing demoListing = demoApp.listings().get(0);
    expire(demoListing);
    get(demoApp, "/");
    assertEquals(403, post(demoApp, "/demo/review", "csrf=wrong&listing=" + demoListing.id).status());
    assertTrue(demoListing.visible());
  }

  @Test
  void configurationFailsClosedWithoutCredentials() {
    assertThrows(IllegalArgumentException.class, () -> Calmmarket.fromEnvironment(Map.of(), false), "no credentials and no demo flag");
    assertThrows(IllegalArgumentException.class, () -> Calmmarket.fromEnvironment(Map.of("CALMLENS_API_KEY", "key"), false));
    assertThrows(IllegalArgumentException.class, () -> Calmmarket.fromEnvironment(Map.of("CALMLENS_PROJECT_ID", "project"), false));
    assertThrows(IllegalArgumentException.class, () -> Calmmarket.fromEnvironment(Map.of("CALMLENS_API_KEY", "key", "CALMLENS_PROJECT_ID", "project", "CALMLENS_API_URL", "ftp://example"), false));
    assertThrows(IllegalArgumentException.class, () -> Calmmarket.fromEnvironment(Map.of("CALMLENS_DEMO", "1", "CALMLENS_API_KEY", "key"), false), "demo never mixes with credentials");
    assertThrows(IllegalArgumentException.class, () -> Calmmarket.fromEnvironment(Map.of("CALMLENS_DEMO", "true"), false), "only CALMLENS_DEMO=1 enables demo mode");
    assertTrue(Calmmarket.fromEnvironment(Map.of("CALMLENS_DEMO", "1"), false).demo());
    assertTrue(Calmmarket.fromEnvironment(Map.of(), true).demo());
    assertFalse(Calmmarket.fromEnvironment(Map.of("CALMLENS_API_KEY", "key", "CALMLENS_PROJECT_ID", "project"), false).demo());
  }

  @Test
  void escapesListingText() {
    Calmmarket app = demoApp("");
    submit(app, "<script>alert(1)</script>", "Fine & \"dandy\"", "25", PNG);
    String page = html(get(app, "/"));
    assertFalse(page.contains("<script>alert(1)</script>"));
    assertTrue(page.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
  }

  // ------------------------------------------------------------ fail closed (a mock stands in for the API)

  @ParameterizedTest
  @ValueSource(strings = {"rejected", "pending", "error", "quarantined"})
  void titleThatIsNotApprovedStopsTheSubmission(String status) {
    MockCalmLensServerClient mock = mock().enqueue(200, asset("title-1", status, null, null));
    Calmmarket app = live(mock, "");
    assertEquals(303, live(app, 2).status());
    assertEquals(1, mock.requests().size(), "description and photos must not be sent");
    assertTrue(app.listings().isEmpty());
  }

  @Test
  void apiFailuresNeverPublish() {
    MockCalmLensServerClient http = mock().enqueue(500, Map.of("code", "internal/unknown", "message", "boom"));
    Calmmarket.Response failed = live(live(http, ""), 1);
    assertEquals(502, failed.status());
    assertFalse(html(failed).contains("boom"), "API error text is never shown");
    assertEquals(502, live(live(mock().enqueueTimeout(), ""), 1).status());
  }

  @Test
  void aFailedPhotoUploadDeletesThePhotosAlreadyUploaded() {
    MockCalmLensServerClient mock = mock()
        .enqueue(200, text("title-1", "approved", false))
        .enqueue(200, text("description-1", "approved", false))
        .enqueue(200, asset("photo-1", "pending", null, null))
        .enqueueFailure(new java.net.ConnectException("refused"))
        .enqueue(200, Map.of());
    Calmmarket app = live(mock, "");
    assertEquals(502, live(app, 2).status());
    assertTrue(app.listings().isEmpty());
    assertEquals(List.of("POST /v1/projects/project-1/assets", "POST /v1/projects/project-1/assets", "DELETE /v1/assets/photo-1"), paths(mock, 2));
  }

  @Test
  void livePreviewUsesTheCardLensAndAShortLivedSignedUrl() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, "");
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    mock.enqueue(200, photo(listing, 1, "approved", CLEAN))
        .enqueue(200, Map.of("lenses", List.of(Map.of(
            "identifier", Calmmarket.CARD_LENS, "name", "Calmmarket listing card", "type", "image", "active", true, "version", 1))))
        .enqueue(200, Map.of("url", "https://cdn.calmlens.com/signed/photo-1", "expiresAt", 1760000060000L));
    Calmmarket.Response first = get(app, "/listings/" + listing.id + "/photos/1");
    assertEquals(303, first.status());
    assertEquals("https://cdn.calmlens.com/signed/photo-1", first.headers().get("location"));
    List<MockCalmLensServerClient.Request> sent = mock.requests();
    MockCalmLensServerClient.Request lens = sent.get(4);
    assertEquals("PUT", lens.method());
    JsonObject definition = JsonParser.parseString(lens.bodyText()).getAsJsonObject().getAsJsonArray("lenses").get(0).getAsJsonObject();
    assertEquals(Calmmarket.CARD_LENS, definition.get("identifier").getAsString());
    MockCalmLensServerClient.Request signing = sent.get(5);
    assertEquals("/v1/assets/photo-1/signed-url", signing.path());
    JsonObject body = JsonParser.parseString(signing.bodyText()).getAsJsonObject();
    assertEquals(Calmmarket.CARD_LENS, body.get("lens").getAsString());
    assertEquals(60, body.get("expiresInSeconds").getAsInt());
    assertEquals("content", body.get("resource").getAsString());

    // The lens is ensured once; an unsafe signed URL is refused.
    mock.enqueue(200, photo(listing, 1, "approved", CLEAN))
        .enqueue(200, Map.of("url", "http://cdn.example.com/photo-1", "expiresAt", 1760000060000L));
    assertEquals(502, get(app, "/listings/" + listing.id + "/photos/1").status());
    assertEquals(List.of("GET /v1/assets/photo-1", "POST /v1/assets/photo-1/signed-url"), paths(mock, 6));
  }

  @Test
  void failedRefreshBlocksAPreviouslyApprovedPhoto() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, "");
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    mock.enqueue(200, photo(listing, 1, "approved", CLEAN));
    get(app, "/");
    assertTrue(listing.visible());
    mock.enqueueTimeout();
    assertEquals(502, get(app, "/listings/" + listing.id + "/photos/1").status());
    assertFalse(listing.visible());
    mock.enqueueFailure(new java.io.IOException("reset"));
    assertFalse(html(get(app, "/")).contains("/listings/" + listing.id + "/photos/1\""));
    assertEquals(0, mock.remainingResponses());
  }

  // ------------------------------------------------------------ concurrency

  @Test
  void aSlowCalmLensCallDoesNotBlockOtherRequests() throws Exception {
    MockCalmLensServerClient mock = liveSubmission(1);
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    Calmmarket.Listing[] created = {null};
    // Photo retrievals stall until released; everything else goes to the mock.
    CalmLensServerClient slow = CalmLensServerClient.builder("key", "project-1").maxRetries(0).transport(request -> {
      entered.countDown();
      if (!release.await(10, TimeUnit.SECONDS)) throw new java.io.IOException("not released");
      return new Transport.Response(200, Map.of(), new Gson().toJson(photo(created[0], 1, "approved", CLEAN)).getBytes(StandardCharsets.UTF_8));
    }).build();
    Calmmarket.Backend delegate = Calmmarket.live(mock.client);
    Calmmarket app = new Calmmarket(new Calmmarket.Backend() {
      public boolean demo() { return false; }
      public CalmLensServerClient textModeration(String choice) { return delegate.textModeration(choice); }
      public CalmLensServerClient photoUploads(int photos) { return delegate.photoUploads(photos); }
      public CalmLensServerClient photo(Calmmarket.Photo photo) { return slow; }
      public CalmLensServerClient textAsset(String assetId, String externalId, boolean flagged) { return delegate.textAsset(assetId, externalId, flagged); }
      public CalmLensServerClient contentRemoval(String assetId) { return delegate.contentRemoval(assetId); }
      public CalmLensServerClient preview(Calmmarket.Photo photo) { return delegate.preview(photo); }
      public CalmLensServerClient events() { return delegate.events(); }
      public CalmLensServerClient simulatedReview(Calmmarket.Photo photo) { return delegate.simulatedReview(photo); }
    }, "");
    live(app, 1);
    created[0] = app.listings().get(0);
    CompletableFuture<Calmmarket.Response> preview = CompletableFuture.supplyAsync(() -> get(app, "/listings/" + created[0].id + "/photos/1"));
    try {
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      // While that photo's retrieval is in flight, the same listing can still be rendered and withdrawn-checked.
      long started = System.nanoTime();
      Calmmarket.Response notFound = get(app, "/listings/unknown/photos/1");
      String page = created[0].locked(() -> "rendered");
      assertEquals(404, notFound.status());
      assertEquals("rendered", page);
      assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(2)) < 0);
      assertFalse(preview.isDone());
    } finally {
      release.countDown();
    }
    preview.get(10, TimeUnit.SECONDS);
  }

  // ------------------------------------------------------------ review decisions

  @Test
  void eventsFeedAppliesReviewDecisionsAndRetriesFailedPages() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, "");
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    mock.enqueueEvents("cursor-0", false);
    assertEquals("/?notice=watching", post(app, "/reviews/sync", "csrf=" + app.csrf).headers().get("location"));
    assertNull(mock.requests().get(3).query().get("after"));

    Map<String, Object> rejection = Map.of("id", "event-1", "type", "asset.rejected", "assetId", "description-1",
        "facts", List.of(Map.of("key", "reviewer-user-id", "value", "user-9"), Map.of("key", "reviewer-name", "value", "Sam"),
            Map.of("key", "note", "value", "Counterfeit", "url", "javascript:alert(1)")));
    Map<String, Object> other = Map.of("id", "event-0", "type", "asset.rejected", "assetId", "someone-else", "facts", List.of());
    // First attempt: retrieval fails, so the cursor must not advance.
    mock.enqueueEvents("cursor-1", false, other, rejection).enqueueTimeout();
    assertEquals(502, post(app, "/reviews/sync", "csrf=" + app.csrf).status());
    assertFalse(listing.removed);
    // Retry: the same page is requested again from the old cursor and applied.
    mock.enqueueEvents("cursor-1", true, other, rejection)
        .enqueue(200, asset("description-1", "rejected", listing.id + ":description", report(true, Map.of())))
        .enqueueEvents("cursor-2", false, rejection);
    assertEquals("/?notice=decisions-applied", post(app, "/reviews/sync", "csrf=" + app.csrf).headers().get("location"));
    List<MockCalmLensServerClient.Request> sent = mock.requests();
    assertEquals("cursor-0", sent.get(4).query().get("after"));
    assertEquals("cursor-0", sent.get(6).query().get("after"));
    assertEquals("/v1/assets/description-1", sent.get(7).path());
    assertEquals("cursor-1", sent.get(8).query().get("after"));
    assertEquals(9, sent.size(), "a repeated event is not retrieved again");
    assertEquals(Calmmarket.State.REMOVED, listing.state());
    Calmmarket.Activity review = app.activity().get(0);
    assertEquals(List.of("Sam", "Counterfeit"), review.facts().stream().map(Calmmarket.FactRow::value).toList());
    assertNull(review.facts().get(1).url(), "only HTTP(S) fact URLs become links");
  }

  @Test
  void anEventWhoseAssetPointsAtAnotherListingChangesNothing() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, SECRET);
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    mock.enqueue(200, asset("description-1", "rejected", "someone-else:description", report(true, Map.of())));
    assertEquals(204, signedWebhook(app, event("event-1", "asset.rejected", "description-1", "[]")).status());
    assertFalse(listing.removed);
    assertEquals(Calmmarket.State.IN_REVIEW, listing.state());
  }

  @Test
  void anEventAboutTheImageRefreshesItsCombinedDecision() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, SECRET);
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    mock.enqueue(200, photo(listing, 1, "approved", CLEAN));
    get(app, "/");
    assertTrue(listing.visible());
    // A new image decision includes the extra text moderation pass.
    Map<String, Object> merged = report(true, Map.of("criminal-activity", evaluated(0.7)));
    mock.enqueue(200, photo(listing, 1, "rejected", merged));
    assertEquals(204, signedWebhook(app, event("event-1", "asset.rejected", "photo-1", "[]")).status());
    assertEquals(List.of("GET /v1/assets/photo-1"), paths(mock, 4));
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertEquals(Calmmarket.Driver.AUTOMATED, listing.photos.get(0).driver());
  }

  @Test
  void webhooksNeedASecret() {
    Calmmarket app = demoApp("");
    assertEquals(503, signedWebhook(app, event("event-1", "asset.rejected", "photo-1", "[]")).status());
  }

  @Test
  void webhookRejectsForgedAndTamperedDeliveries() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, SECRET);
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    byte[] body = event("event-1", "asset.rejected", "photo-1", "[]").getBytes(StandardCharsets.UTF_8);
    String now = Long.toString(System.currentTimeMillis() / 1000);
    String signature = CalmLensServerClient.createWebhookSignatureHeader(SECRET, now, body);
    assertEquals(401, webhook(app, body, null, now).status());
    assertEquals(401, webhook(app, body, "v1=" + "0".repeat(64), now).status());
    assertEquals(401, webhook(app, body, CalmLensServerClient.createWebhookSignatureHeader("other-secret", now, body), now).status());
    byte[] tampered = new String(body, StandardCharsets.UTF_8).replace("photo-1", "photo-2").getBytes(StandardCharsets.UTF_8);
    assertEquals(401, webhook(app, tampered, signature, now).status());
    String stale = Long.toString(System.currentTimeMillis() / 1000 - 600);
    assertEquals(401, webhook(app, body, CalmLensServerClient.createWebhookSignatureHeader(SECRET, stale, body), stale).status());
    assertEquals(3, mock.requests().size(), "rejected deliveries make no API calls");
    assertEquals(Calmmarket.State.IN_REVIEW, listing.state());
    assertEquals(400, signedWebhook(app, "not json").status());
    assertEquals(400, signedWebhook(app, "{\"id\":\"event-1\"}").status());
  }

  @Test
  void verifiedWebhookRefreshesFromTheApiAndIgnoresReplaysAndTestSends() {
    MockCalmLensServerClient mock = liveSubmission(1);
    Calmmarket app = live(mock, SECRET);
    live(app, 1);
    Calmmarket.Listing listing = app.listings().get(0);
    // The event snapshot says approved, but the API says rejected: the API wins.
    String body = event("event-1", "asset.rejected", "photo-1", "[{\"key\":\"decided-by\",\"value\":\"automated\"}]");
    mock.enqueueTimeout();
    assertEquals(502, signedWebhook(app, body).status(), "a failed refresh asks CalmLens to retry");
    mock.enqueue(200, photo(listing, 1, "rejected", report(true, Map.of("violence", evaluated(0.9)))));
    assertEquals(204, signedWebhook(app, body).status());
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertEquals(204, signedWebhook(app, body).status());
    assertEquals(5, mock.requests().size(), "a replayed event is not applied again");
    assertEquals(204, signedWebhook(app, event("event-2", "asset.approved", "unknown-asset", "[]")).status());
    assertEquals(204, signedWebhook(app, event("event-3", "asset.approved", "photo-1", "[{\"key\":\"test\",\"value\":true}]")).status());
    assertEquals(5, mock.requests().size());
    assertEquals(Calmmarket.State.HELD, listing.state());
    assertEquals("test", app.activity().get(0).kind());
  }

  @Test
  void demoWebhookAppliesThePhotoDecision() {
    Calmmarket app = demoApp(SECRET);
    demo(app, "approved", "visual-rejected");
    Calmmarket.Listing listing = app.listings().get(0);
    expire(listing);
    assertEquals(204, signedWebhook(app, event("event-1", "asset.rejected", listing.photos.get(0).assetId, "[{\"key\":\"decided-by\",\"value\":\"automated\"}]")).status());
    assertEquals(Calmmarket.Driver.AUTOMATED, listing.photos.get(0).driver());
  }

  // ------------------------------------------------------------ server

  @Test
  void servesOnLoopback() throws Exception {
    var server = Main.serve(demoApp(""), 0);
    try {
      assertTrue(server.getAddress().getAddress().isLoopbackAddress());
      assertEquals(InetAddress.getLoopbackAddress(), server.getAddress().getAddress());
      HttpClient client = HttpClient.newHttpClient();
      URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
      HttpResponse<String> home = client.send(HttpRequest.newBuilder(base.resolve("/")).build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(200, home.statusCode());
      assertEquals("nosniff", home.headers().firstValue("x-content-type-options").orElse(null));
      assertTrue(home.headers().firstValue("content-security-policy").orElse("").contains("default-src 'none'"));
      assertEquals(404, client.send(HttpRequest.newBuilder(base.resolve("/missing")).build(), HttpResponse.BodyHandlers.ofString()).statusCode());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void oversizedBodiesAreRefusedFromTheirDeclaredLength() throws Exception {
    var server = Main.serve(demoApp(SECRET), 0);
    try (var socket = new java.net.Socket(InetAddress.getLoopbackAddress(), server.getAddress().getPort())) {
      // Send only the headers: the server answers from the declared length without reading a body.
      socket.setSoTimeout(10_000);
      socket.getOutputStream().write(("POST /webhooks/calmlens HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: "
          + (Calmmarket.MAX_WEBHOOK_BYTES + 1) + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
      socket.getOutputStream().flush();
      String statusLine = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII)).readLine();
      assertNotNull(statusLine);
      assertTrue(statusLine.startsWith("HTTP/1.1 413"), statusLine);
    } finally {
      server.stop(0);
    }
  }
}
