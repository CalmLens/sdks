package calmmarket;

import com.calmlens.CalmLensServerClient;
import com.calmlens.CalmLensException;
import com.calmlens.CdnResponse;
import com.calmlens.ErrorCodes;
import com.calmlens.Models.*;
import com.calmlens.RequestOptions;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Calmmarket: a local marketplace where sellers often put prices, slogans, phone numbers and
 * claims inside their photos. Every photo is uploaded with OCR enabled, so CalmLens also moderates
 * the text it reads in the photo. A listing goes live only when its title, its description and
 * every photo are approved. Requests arrive through {@link #handle(Request)}, which {@link Main}
 * connects to the JDK's built-in HTTP server.
 *
 * <p>Requests are handled concurrently. No lock is held across a CalmLens call: network calls run
 * first, then the result is applied under the affected listing's lock.
 */
public final class Calmmarket {
  static final int MAX_TITLE = 80;
  static final int MAX_DESCRIPTION = 2000;
  static final int MAX_PHOTOS = 4;
  static final int MAX_PHOTO_BYTES = 4 * 1024 * 1024;
  static final int MAX_FORM_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + 64 * 1024;
  static final int MAX_WEBHOOK_BYTES = 1024 * 1024;
  static final int MAX_LISTINGS = 20;
  static final int MAX_ACTIVITY = 50;
  static final int EVENT_PAGE_SIZE = 50;
  static final int MAX_EVENT_PAGES = 5;
  static final int SIGNED_URL_SECONDS = 60;
  static final int MAX_EXTRACTED_TEXT_SHOWN = 240;
  /** Category evidence below this does not contribute when CalmLens merges reports. */


  /** A named, versioned CDN transformation: listing photos are delivered as 4:3 WebP cards. */
  static final String CARD_LENS = "calmmarket-card";
  static final LensDefinition CARD_LENS_DEFINITION =
      new LensDefinition(CARD_LENS, "Calmmarket listing card", "image", true, 1)
          .transforms(Patch.value(List.of(Transform.image(
              new ImageTransformOptions().fit("cover").width(640).height(480).format("webp")))));

  /** The six parent categories every report contains, in display order. */
  static final List<String> CATEGORIES = List.of("sexual", "violence", "self-harm", "harassment", "hate", "criminal-activity");
  static final Map<String, String> CATEGORY_LABELS = Map.of(
      "sexual", "Sexual content", "violence", "Violence", "self-harm", "Self-harm",
      "harassment", "Harassment", "hate", "Hate", "criminal-activity", "Criminal activity");

  /** Outcomes a seller can pick in demo mode; {@link Demo} answers with them. Nothing is classified. */
  static final Map<String, String> DEMO_TEXT_RESULTS = new LinkedHashMap<>();
  static final Map<String, String> DEMO_PHOTO_RESULTS = new LinkedHashMap<>();
  static {
    DEMO_TEXT_RESULTS.put("approved", "Title and description approved");
    DEMO_TEXT_RESULTS.put("description-rejected", "Description rejected (no photo is uploaded)");
    DEMO_TEXT_RESULTS.put("unavailable", "CalmLens unavailable (nothing is published)");
    DEMO_PHOTO_RESULTS.put("no-text", "Approved, no text found");
    DEMO_PHOTO_RESULTS.put("clean-text", "Approved, text in it clean");
    DEMO_PHOTO_RESULTS.put("text-rejected", "Text in photo rejected");
    DEMO_PHOTO_RESULTS.put("visual-rejected", "Visually rejected, text clean");
    DEMO_PHOTO_RESULTS.put("error", "Processing error");
  }

  /** Text fields, moderated in this order, each as its own text asset. */
  static final Map<String, String> TEXT_FIELDS = new LinkedHashMap<>();
  static {
    TEXT_FIELDS.put("title", "Calmmarket listing title");
    TEXT_FIELDS.put("description", "Calmmarket listing description");
  }

  /** Registered fact keys and labels from packages/shared/src/EventCatalog.ts shown in the activity log. */
  static final Map<String, String> FACT_LABELS = Map.of(
      "asset-name", "Asset", "asset-type", "Asset type", "decided-by", "Decided by",
      "previous-status", "Previous status", "moderation-action", "Moderation action",
      "flagged-categories", "Categories", "reviewer-name", "Reviewer", "note", "Note");
  /**
   * Events that can change a listing's decision. {@code asset.approved} and {@code asset.rejected}
   * report every outcome, from automated moderation or a reviewer; their {@code decided-by} fact
   * says which.
   */
  static final Map<String, String> EVENT_LABELS = Map.of(
      "asset.flagged", "Flagged by automated moderation", "asset.approved", "Approved",
      "asset.rejected", "Rejected", "asset.failed", "Processing failed");

  /**
   * Notices shown after a form posts. Redirects carry only a key, so the page never shows text
   * taken from the URL.
   */
  static final Map<String, String> NOTICES = Map.ofEntries(
      Map.entry("submitted", "Submitted. The listing goes live when every photo, including any text in it, is approved."),
      Map.entry("title-rejected", "Not published: the title did not pass the moderation policy."),
      Map.entry("description-rejected", "Not published: the description did not pass the moderation policy."),
      Map.entry("moderation-incomplete", "Not published: moderation has not completed successfully. Please try again."),
      Map.entry("withdrawn", "Withdrawn. Its photos are no longer stored or served; their moderation records remain for audit."),
      Map.entry("withdrawn-pending", "Withdrawn. Some stored photos could not be removed yet; use Retry removal."),
      Map.entry("watching", "Watching for review decisions from now on. Check again after a reviewer acts."),
      Map.entry("no-decisions", "No new review decisions."),
      Map.entry("decisions-applied", "New review decisions were applied. See Review activity."),
      Map.entry("simulated-review", "A simulated reviewer rejected photo 1. The listing is held."));

  enum State {
    IN_REVIEW("In review"), LIVE("Live"), HELD("Held: a photo was not approved"),
    REMOVED("Removed by a reviewer"), WITHDRAWN("Withdrawn by the seller");
    final String label;
    State(String label) { this.label = label; }
  }

  /** Whether extracted text is available on the retrieved image. */
  enum Ocr { NOT_CHECKED, NO_TEXT, FOUND }

  /** Which part of a rejected photo led to the rejection. */
  enum Driver {
    NONE("Not rejected"),
    AUTOMATED("The combined image and text classification results"),
    REVIEWER("A reviewer's decision");
    final String label;
    Driver(String label) { this.label = label; }
  }

  /** A combined category result; unavailable categories have no score. */
  record CategoryRow(String key, String status, Double score, String reason) {
    String label() { return CATEGORY_LABELS.getOrDefault(key, key); }
  }

  /** A listing photo. Mutable fields are guarded by the owning {@link Listing#lock}. */
  static final class Photo {
    final int number;
    final String name, mime, assetId;
    /** The {@code externalId} sent with the upload: {@code <listing-id>:photo-<number>}. */
    final String externalId;
    AssetClassificationStatus processing;
    /** The decision in force, a reviewer's when there is one. */
    AssetModerationStatus moderation;
    /** What the policy did with flagged content ({@code alert}, {@code hide} or {@code purge}); null when it matched nothing. */
    String moderationAction;
    AssetModeration report;
    /** The reviewer's note, or else automated moderation's reason for a rejection. */
    String rejectionNote;
    Ocr ocr = Ocr.NOT_CHECKED;
    ExtractedText extractedText;
    String refreshError;
    /** Photo asset IDs whose stored content was removed, or that are under a safety hold. */
    final Set<String> contentRemoved = new LinkedHashSet<>();
    final Set<String> safetyHeld = new LinkedHashSet<>();
    // Demo mode only: the selected outcome, when the photo was submitted, and its bytes.
    final String demoResult;
    volatile boolean demoReviewerRejected;
    volatile Instant submittedAt = Instant.now();
    volatile byte[] demoBytes;

    Photo(int number, String name, String mime, String assetId, String externalId, String demoResult) {
      this.number = number; this.name = name; this.mime = mime; this.assetId = assetId; this.externalId = externalId; this.demoResult = demoResult;
    }

    boolean decided() { return decided(moderation); }
    static boolean decided(AssetModerationStatus status) { return status == AssetModerationStatus.APPROVED || status == AssetModerationStatus.REJECTED; }
    boolean processingFailed() { return processing == AssetClassificationStatus.FAILED; }
    /** Only an explicit approval with a current decision counts; an unknown status never does. */
    boolean approved() { return moderation == AssetModerationStatus.APPROVED && !processingFailed() && refreshError == null; }
    boolean failed() { return moderation == AssetModerationStatus.REJECTED || processingFailed(); }
    /** The decision shown to the seller: {@code failed} when processing failed, else the moderation status. */
    String decision() { return processingFailed() ? "failed" : moderation == null ? "unknown" : moderation.value(); }
    Driver driver() { return Calmmarket.driver(moderation, moderationAction != null); }
    List<CategoryRow> categories() { return explain(report); }
    List<String> contentIds() { return List.of(assetId); }
    boolean owns(String id) { return id.equals(assetId); }
  }

  static final class Listing {
    final String id;
    final String title, description, price;
    /** Field name to text asset ID; the asset's externalId is {@code <listing-id>:<field>}. */
    final Map<String, String> textAssetIds;
    final List<Photo> photos;
    /** Guards the mutable state of this listing and its photos. Never held across a CalmLens call. */
    final ReentrantLock lock = new ReentrantLock();
    boolean flagged, removed, withdrawn, removing;
    String removalError;

    Listing(String id, String title, String description, String price, Map<String, String> textAssetIds, List<Photo> photos, boolean flagged) {
      this.id = id; this.title = title; this.description = description; this.price = price;
      this.textAssetIds = Map.copyOf(textAssetIds);
      this.photos = List.copyOf(photos);
      this.flagged = flagged;
    }

    <T> T locked(Supplier<T> action) {
      lock.lock();
      try { return action.get(); } finally { lock.unlock(); }
    }

    /** Live only when the text and every photo are approved; anything else holds the listing. */
    State state() {
      if (withdrawn) return State.WITHDRAWN;
      if (removed) return State.REMOVED;
      if (!photos.isEmpty() && photos.stream().allMatch(Photo::approved)) return State.LIVE;
      if (photos.stream().anyMatch(Photo::failed)) return State.HELD;
      return State.IN_REVIEW;
    }
    boolean visible() { return state() == State.LIVE; }
    Photo photo(int number) { return number >= 1 && number <= photos.size() ? photos.get(number - 1) : null; }
    Photo photoOwning(String assetId) { return photos.stream().filter(photo -> photo.owns(assetId)).findFirst().orElse(null); }
    String textField(String assetId) {
      return textAssetIds.entrySet().stream().filter(entry -> entry.getValue().equals(assetId)).map(Map.Entry::getKey).findFirst().orElse(null);
    }
    boolean owns(String assetId) { return textField(assetId) != null || photoOwning(assetId) != null; }
    /** Withdrawn, but some stored photo content could not be removed yet. */
    boolean removalPending() {
      return withdrawn && photos.stream().anyMatch(photo -> photo.contentIds().stream()
          .anyMatch(id -> !photo.contentRemoved.contains(id) && !photo.safetyHeld.contains(id)));
    }
  }

  record Upload(String fileName, byte[] data, String demoResult) {}
  record FactRow(String label, String value, String url) {}
  record Activity(String kind, String text, List<FactRow> facts, Instant at) {}
  record Request(String method, String path, String query, Map<String, String> headers, byte[] body) {
    String header(String name) { return headers.get(name.toLowerCase(Locale.ROOT)); }
  }
  record Response(int status, Map<String, String> headers, byte[] body) {}

  /** A request that cannot be accepted, shown to the user as a notice. Messages are written by this app. */
  static final class Rejected extends Exception {
    final int status;
    Rejected(int status, String message) { super(message); this.status = status; }
  }

  /** A retrieved asset whose externalId does not point back to the listing that holds it. */
  static final class NotOurs extends RuntimeException {
    NotOurs() { super("The asset's externalId does not belong to this listing", null, false, false); }
  }

  /**
   * Where CalmLens calls go. In live mode every role is the one real client; {@link Demo} answers
   * each role from the SDK's offline mock instead.
   */
  interface Backend {
    boolean demo();
    /** Moderates the title and description. {@code demoChoice} is ignored in live mode. */
    CalmLensServerClient textModeration(String demoChoice);
    CalmLensServerClient photoUploads(int photos);
    /** Retrieves a photo with its extracted text. */
    CalmLensServerClient photo(Photo photo);
    /** Retrieves a title or description asset. */
    CalmLensServerClient textAsset(String assetId, String externalId, boolean flagged);
    CalmLensServerClient contentRemoval(String assetId);
    /** Serves (demo) or signs (live) an approved photo. */
    CalmLensServerClient preview(Photo photo);
    /** The events feed; null when there is none. */
    CalmLensServerClient events();
    /** Demo only: a feed holding one synthetic reviewer rejection of {@code photo}. */
    CalmLensServerClient simulatedReview(Photo photo);
  }

  /** @return a backend that sends everything to {@code client} */
  static Backend live(CalmLensServerClient client) {
    Objects.requireNonNull(client, "client");
    return new Backend() {
      public boolean demo() { return false; }
      public CalmLensServerClient textModeration(String demoChoice) { return client; }
      public CalmLensServerClient photoUploads(int photos) { return client; }
      public CalmLensServerClient photo(Photo photo) { return client; }
      public CalmLensServerClient textAsset(String assetId, String externalId, boolean flagged) { return client; }
      public CalmLensServerClient contentRemoval(String assetId) { return client; }
      public CalmLensServerClient preview(Photo photo) { return client; }
      public CalmLensServerClient events() { return client; }
      public CalmLensServerClient simulatedReview(Photo photo) { throw new IllegalStateException("Live mode has no simulated reviews"); }
    };
  }

  private final Backend backend;
  private final String webhookSecret;
  final String csrf;
  /** Guards listings, activity and seenEvents. Never held across a CalmLens call. */
  private final ReentrantLock stateLock = new ReentrantLock();
  private final List<Listing> listings = new ArrayList<>();
  private final Deque<Activity> activity = new ArrayDeque<>();
  private final Set<String> seenEvents = new LinkedHashSet<>();
  /** One events-feed sync at a time; it owns {@link #cursor}. */
  private final ReentrantLock syncLock = new ReentrantLock();
  private String cursor;
  private final AtomicBoolean lensReady = new AtomicBoolean();

  public Calmmarket(Backend backend, String webhookSecret) {
    this.backend = Objects.requireNonNull(backend, "backend");
    this.webhookSecret = webhookSecret == null ? "" : webhookSecret;
    byte[] token = new byte[32];
    new SecureRandom().nextBytes(token);
    this.csrf = Base64.getUrlEncoder().withoutPadding().encodeToString(token);
    // Demo mode has no events feed; its simulated reviews start from a fixed cursor.
    if (backend.demo()) cursor = "demo-start";
  }

  /**
   * Builds the app from environment variables. It fails closed: without both credentials it
   * refuses to start unless demo mode is requested explicitly ({@code CALMLENS_DEMO=1} or {@code
   * --demo}), and partial credentials never fall back to demo mode.
   */
  static Calmmarket fromEnvironment(Map<String, String> env, boolean demoFlag) {
    String key = env.getOrDefault("CALMLENS_API_KEY", ""), project = env.getOrDefault("CALMLENS_PROJECT_ID", "");
    boolean demo = demoFlag || "1".equals(env.get("CALMLENS_DEMO"));
    String secret = env.getOrDefault("CALMLENS_WEBHOOK_SECRET", "");
    if (demo) {
      if (!key.isEmpty() || !project.isEmpty())
        throw new IllegalArgumentException("Demo mode does not use credentials: unset CALMLENS_API_KEY and CALMLENS_PROJECT_ID, or turn demo mode off");
      return new Calmmarket(new Demo(), secret);
    }
    if (key.isEmpty() || project.isEmpty())
      throw new IllegalArgumentException("Set CALMLENS_API_KEY and CALMLENS_PROJECT_ID, or set CALMLENS_DEMO=1 to run the offline demo");
    CalmLensServerClient.Builder builder = CalmLensServerClient.builder(key, project).timeout(Duration.ofSeconds(30));
    if (!env.getOrDefault("CALMLENS_API_URL", "").isEmpty()) builder.baseUrl(env.get("CALMLENS_API_URL"));
    if (!env.getOrDefault("CALMLENS_CDN_URL", "").isEmpty()) builder.cdnBaseUrl(env.get("CALMLENS_CDN_URL"));
    try {
      return new Calmmarket(live(builder.build()), secret);
    } catch (CalmLensException error) {
      throw new IllegalArgumentException("Invalid CalmLens configuration (" + error.getCode() + ")", error);
    }
  }

  boolean demo() { return backend.demo(); }

  /** Upload options for every listing photo: OCR on, content kept for the CDN preview. */
  static ProcessingOptions photoProcessing() {
    return new ProcessingOptions().keepContentAfterProcessing(true)
        .features(new ProcessingFeatures().ocr(new FeatureOptions(true)));
  }

  // ---------------------------------------------------------------- HTTP

  public Response handle(Request request) {
    String path = request.path();
    String method = request.method();
    try {
      if (path.equals("/")) {
        if (method.equals("GET") || method.equals("HEAD")) return home(request);
        return text(405, "Method not allowed");
      }
      if (path.equals("/listings")) return method.equals("POST") ? submit(request) : text(405, "Method not allowed");
      if (path.equals("/reviews/sync")) return method.equals("POST") ? form(request, fields -> sync()) : text(405, "Method not allowed");
      if (path.equals("/demo/review") && demo())
        return method.equals("POST") ? form(request, fields -> simulateReview(fields.get("listing"))) : text(405, "Method not allowed");
      if (path.equals("/webhooks/calmlens")) return method.equals("POST") ? webhook(request) : text(405, "Method not allowed");
      String[] segments = path.split("/");
      if (segments.length == 4 && segments[1].equals("listings") && segments[3].equals("withdraw"))
        return method.equals("POST") ? form(request, fields -> withdraw(segments[2])) : text(405, "Method not allowed");
      if (segments.length == 5 && segments[1].equals("listings") && segments[3].equals("photos") && method.equals("GET"))
        return photo(segments[2], segments[4]);
      return text(404, "Not found");
    } catch (Rejected rejected) {
      return page(rejected.getMessage(), rejected.status);
    }
  }

  private Response home(Request request) {
    String notice = "";
    for (String pair : Optional.ofNullable(request.query()).orElse("").split("&")) {
      String[] parts = pair.split("=", 2);
      if (parts.length == 2 && parts[0].equals("notice")) {
        // Only known keys are shown; anything else in the URL is ignored.
        try { notice = NOTICES.getOrDefault(URLDecoder.decode(parts[1], StandardCharsets.UTF_8), ""); } catch (IllegalArgumentException ignored) { }
      }
    }
    // Poll undecided photos (and failed lookups) so the page shows the latest decision.
    for (Listing listing : listings()) {
      List<Photo> stale = listing.locked(() -> listing.withdrawn || listing.removed ? List.<Photo>of() : listing.photos.stream()
          .filter(photo -> !photo.decided() && !photo.processingFailed() || photo.refreshError != null)
          .toList());
      for (Photo photo : stale) refreshPhoto(listing, photo);
    }
    Response response = page(notice, 200);
    if (listings().stream().anyMatch(listing -> listing.locked(() -> listing.state() == State.IN_REVIEW))) response.headers().put("refresh", "3");
    return response;
  }

  Response page(String notice, int status) {
    String html = Page.render(this, notice, listings(), activity(), !webhookSecret.isEmpty());
    Map<String, String> headers = securityHeaders();
    headers.put("content-type", "text/html; charset=utf-8");
    return new Response(status, headers, html.getBytes(StandardCharsets.UTF_8));
  }

  @FunctionalInterface
  private interface FormAction { String run(Map<String, String> fields) throws Rejected; }

  /** Token-checked, URL-encoded form posts that end in redirect-after-submit. */
  private Response form(Request request, FormAction action) throws Rejected {
    String type = Optional.ofNullable(request.header("content-type")).orElse("").split(";")[0].strip();
    if (!type.equalsIgnoreCase("application/x-www-form-urlencoded")) return text(415, "Use a form submission");
    if (request.body().length > 16 * 1024) return text(413, "Request body is too large");
    Map<String, String> fields = new HashMap<>();
    try {
      for (String pair : new String(request.body(), StandardCharsets.UTF_8).split("&")) {
        if (pair.isEmpty()) continue;
        String[] parts = pair.split("=", 2);
        fields.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8), parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "");
      }
    } catch (IllegalArgumentException invalid) {
      return text(400, "Invalid form encoding");
    }
    if (!tokenMatches(fields.get("csrf"))) return text(403, "Invalid form token. Reload the page.");
    try {
      return redirect(action.run(fields));
    } catch (CalmLensException error) {
      log("CalmLens request failed", error);
      throw new Rejected(502, "CalmLens could not complete the request. Please try again.");
    }
  }

  private boolean tokenMatches(String token) {
    return token != null && MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), csrf.getBytes(StandardCharsets.UTF_8));
  }

  /** Logs the stable code and request ID only, never the message text of a failure. */
  private static void log(String what, CalmLensException error) {
    System.err.println(what + ": " + error.getCode() + (error.getRequestId() == null ? "" : " (request " + error.getRequestId() + ")"));
  }

  // ---------------------------------------------------------------- Submitting listings

  private Response submit(Request request) throws Rejected {
    String boundary = Multipart.boundary(request.header("content-type"));
    if (boundary == null) return text(415, "Use a multipart form submission");
    if (request.body().length > MAX_FORM_BYTES) return text(413, "The listing is too large");
    Map<String, Multipart.Part> parts = new HashMap<>();
    try {
      for (Multipart.Part part : Multipart.parse(request.body(), boundary, 16)) parts.putIfAbsent(part.name(), part);
    } catch (Multipart.Invalid invalid) {
      return text(400, invalid.getMessage());
    }
    if (!tokenMatches(parts.containsKey("csrf") ? parts.get("csrf").text() : null)) return text(403, "Invalid form token. Reload the page.");
    List<Upload> uploads = new ArrayList<>();
    for (int number = 1; number <= MAX_PHOTOS; number++) {
      Multipart.Part photo = parts.get("photo" + number);
      // Browsers send an empty part for a file input left blank.
      if (photo == null || photo.data().length == 0 && (photo.fileName() == null || photo.fileName().isEmpty())) continue;
      String choice = demo() && parts.containsKey("demo_photo" + number) ? parts.get("demo_photo" + number).text() : "no-text";
      uploads.add(new Upload(photo.fileName(), photo.data(), choice));
    }
    String textChoice = demo() && parts.containsKey("demo_text") ? parts.get("demo_text").text() : "approved";
    try {
      return redirect(submit(field(parts, "title"), field(parts, "description"), field(parts, "price"), uploads, textChoice));
    } catch (CalmLensException error) {
      // A failure is never treated as approval: nothing is stored or published.
      log("CalmLens request failed", error);
      throw new Rejected(502, "Not published: CalmLens could not complete the request. Please try again.");
    }
  }

  private static String field(Map<String, Multipart.Part> parts, String name) {
    return parts.containsKey(name) ? parts.get(name).text().strip() : "";
  }

  /** Moderates title, then description, then uploads every photo with OCR. Returns the notice key. */
  String submit(String title, String description, String price, List<Upload> uploads, String textChoice) throws Rejected {
    if (title.isEmpty() || title.length() > MAX_TITLE || title.chars().anyMatch(Character::isISOControl))
      throw new Rejected(400, "Write a title of 1 to " + MAX_TITLE + " characters on one line.");
    if (description.isEmpty() || description.length() > MAX_DESCRIPTION)
      throw new Rejected(400, "Write a description of 1 to " + MAX_DESCRIPTION + " characters.");
    String amount = price(price);
    if (uploads.isEmpty()) throw new Rejected(400, "Add at least one photo of the item.");
    if (uploads.size() > MAX_PHOTOS) throw new Rejected(400, "Add at most " + MAX_PHOTOS + " photos.");
    List<String> mimes = new ArrayList<>();
    for (Upload upload : uploads) {
      if (upload.data().length == 0) throw new Rejected(400, "A selected photo is empty.");
      if (upload.data().length > MAX_PHOTO_BYTES) throw new Rejected(400, "Each photo must be at most 4MiB.");
      String mime = imageType(upload.data());
      if (mime == null) throw new Rejected(400, "Use JPEG, PNG, GIF, or WebP photos.");
      if (!DEMO_PHOTO_RESULTS.containsKey(upload.demoResult())) throw new Rejected(400, "Unknown demo result.");
      mimes.add(mime);
    }
    if (!DEMO_TEXT_RESULTS.containsKey(textChoice)) throw new Rejected(400, "Unknown demo result.");
    if (listings().size() >= MAX_LISTINGS) throw full();

    String id = UUID.randomUUID().toString();
    CalmLensServerClient textClient = backend.textModeration(textChoice);
    Map<String, String> values = Map.of("title", title, "description", description);
    Map<String, String> textAssetIds = new LinkedHashMap<>();
    boolean flagged = false;
    for (Map.Entry<String, String> field : TEXT_FIELDS.entrySet()) {
      String externalId = id + ":" + field.getKey();
      Asset asset = textClient.text.classify(new ClassifyText(values.get(field.getKey()))
          .name(field.getValue())
          .externalId(externalId)
          // Kept so a reviewer can read a flagged listing in the CalmLens portal.
          .processingOptions(new ProcessingOptions().keepContentAfterProcessing(true)),
          // The listing's own key, so a retried submission never moderates the text twice.
          new RequestOptions().idempotencyKey(externalId));
      if (moderationStatus(asset) != AssetModerationStatus.APPROVED) {
        // No photo is uploaded for a listing whose text was not approved.
        boolean rejected = moderationStatus(asset) == AssetModerationStatus.REJECTED;
        record("held", "A listing was held: its " + field.getKey() + (rejected ? " was rejected" : " did not finish moderation") + ". Nothing was stored.", List.of());
        return rejected ? field.getKey() + "-rejected" : "moderation-incomplete";
      }
      flagged |= flagged(asset);
      textAssetIds.put(field.getKey(), asset.id());
    }

    // Photos are classified in the background: create() returns while each asset is pending.
    CalmLensServerClient uploadClient = backend.photoUploads(uploads.size());
    List<Photo> photos = new ArrayList<>();
    try {
      for (int i = 0; i < uploads.size(); i++) {
        Upload upload = uploads.get(i);
        int number = i + 1;
        String name = photoName(upload.fileName(), number), externalId = id + ":photo-" + number;
        Asset asset = uploadClient.assets.create(new SubmitAsset(name, Content.bytes(upload.data(), mimes.get(i)))
            .visibility(Visibility.PRIVATE)
            .externalId(externalId)
            .processingOptions(photoProcessing()), new RequestOptions().idempotencyKey(externalId));
        Photo photo = new Photo(number, name, mimes.get(i), asset.id(), externalId, upload.demoResult());
        applyPhoto(photo, asset);
        if (demo()) photo.demoBytes = upload.data().clone();
        photos.add(photo);
      }
    } catch (CalmLensException error) {
      // The listing is not stored, so photos already uploaded for it are deleted again.
      for (Photo photo : photos) {
        try {
          uploadClient.assets.delete(new AssetId(photo.assetId));
        } catch (CalmLensException cleanup) {
          log("Could not delete an orphaned photo", cleanup);
        }
      }
      throw error;
    }
    Listing listing = new Listing(id, title, description, amount, textAssetIds, photos, flagged);
    stateLock.lock();
    try {
      if (listings.size() >= MAX_LISTINGS) throw full();
      listings.add(0, listing);
    } finally {
      stateLock.unlock();
    }
    record(flagged ? "flagged" : "submitted", "“" + title + "” was submitted with " + uploads.size()
        + (uploads.size() == 1 ? " photo" : " photos") + (flagged ? " · its text is flagged for review" : "") + ". Photos are in review.", List.of());
    return "submitted";
  }

  private static Rejected full() {
    return new Rejected(409, "This local session holds at most " + MAX_LISTINGS + " listings. Restart to begin a new session.");
  }

  static String price(String value) throws Rejected {
    try {
      BigDecimal amount = new BigDecimal(value);
      if (amount.signum() > 0 && amount.scale() <= 2 && amount.compareTo(new BigDecimal("100000")) <= 0)
        return amount.setScale(2).toPlainString();
    } catch (NumberFormatException ignored) { }
    throw new Rejected(400, "Enter a price between 0.01 and 100000.");
  }

  /** Sniffs the image type from its first bytes; the browser's declared type is not trusted. */
  static String imageType(byte[] data) {
    if (data.length >= 3 && (data[0] & 0xff) == 0xff && (data[1] & 0xff) == 0xd8 && (data[2] & 0xff) == 0xff) return "image/jpeg";
    if (data.length >= 8 && Arrays.equals(Arrays.copyOf(data, 8), new byte[] {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})) return "image/png";
    String head = new String(Arrays.copyOf(data, Math.min(12, data.length)), StandardCharsets.ISO_8859_1);
    if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "image/gif";
    if (head.length() == 12 && head.startsWith("RIFF") && head.endsWith("WEBP")) return "image/webp";
    return null;
  }

  private static String photoName(String fileName, int number) {
    String name = fileName == null ? "" : fileName.replaceAll(".*[/\\\\]", "").replaceAll("\\p{Cntrl}", "").strip();
    return name.isEmpty() || name.length() > 100 ? "listing-photo-" + number : name;
  }

  /** Flagged means the policy took an action (alert, hide or purge) on the asset. */
  static boolean flagged(Asset asset) { return asset.classification().moderation() != null && asset.classification().moderation().action() != null; }

  static AssetModerationStatus moderationStatus(Asset asset) { return asset.classification().moderation() == null ? null : asset.classification().moderation().decision(); }

  static AssetClassificationStatus classificationStatus(Asset asset) { return asset.classification() == null ? null : asset.classification().status(); }

  static AssetModeration report(Asset asset) { return asset.classification().moderation() == null ? null : asset.classification().moderation(); }

  // ---------------------------------------------------------------- Explaining photo decisions

  /** The combined report does not identify which moderation pass caused a rejection. */
  static Driver driver(AssetModerationStatus status, boolean policyActed) {
    if (status != AssetModerationStatus.REJECTED) return Driver.NONE;
    return policyActed ? Driver.AUTOMATED : Driver.REVIEWER;
  }

  static List<CategoryRow> explain(AssetModeration merged) {
    if (merged == null || merged.categories() == null) return List.of();
    LinkedHashSet<String> keys = new LinkedHashSet<>(CATEGORIES);
    keys.addAll(new TreeSet<>(merged.categories().keySet()));
    List<CategoryRow> rows = new ArrayList<>();
    for (String key : keys) {
      CategoryResult result = merged.categories().get(key);
      rows.add(new CategoryRow(key, result == null || result.status() == null ? "missing" : result.status(),
          scoreOf(result), result == null ? null : result.reason()));
    }
    return rows;
  }

  static Double scoreOf(CategoryResult result) {
    if (result == null || result.score() == null) return null;
    return "evaluated".equals(result.status()) || "partial".equals(result.status()) ? result.score() : null;
  }

  // ---------------------------------------------------------------- Photo decisions

  private static void applyPhoto(Photo photo, Asset asset) {
    AssetModeration moderation = asset.classification().moderation();
    photo.processing = classificationStatus(asset);
    photo.moderation = moderationStatus(asset);
    photo.moderationAction = moderation == null ? null : moderation.action();
    photo.report = report(asset);
    photo.rejectionNote = moderation == null ? null : moderation.reviewerNote();
    photo.extractedText = asset.content() == null ? null : asset.content().extractedText();
    photo.ocr = !photo.decided() ? Ocr.NOT_CHECKED : photo.extractedText == null ? Ocr.NO_TEXT : Ocr.FOUND;
  }

  /** Retrieves the authoritative image decision and extracted text in one request. */
  private record Lookup(Asset asset) {}

  private Lookup lookUp(Photo photo) {
    CalmLensServerClient client = backend.photo(photo);
    Asset asset = client.assets.retrieve(new AssetId(photo.assetId));
    if (!photo.externalId.equals(asset.externalId())) throw new NotOurs();
    return new Lookup(asset);
  }

  private static void apply(Listing listing, Photo photo, Lookup lookup) {
    listing.locked(() -> {
      applyPhoto(photo, lookup.asset());
      photo.refreshError = null;
      return null;
    });
  }

  /** Failures hide the photo until a refresh succeeds. */
  private boolean refreshPhoto(Listing listing, Photo photo) {
    try {
      apply(listing, photo, lookUp(photo));
      return true;
    } catch (CalmLensException | NotOurs error) {
      if (error instanceof CalmLensException failure) log("Could not refresh photo", failure);
      else System.err.println("Photo " + photo.assetId + " does not belong to listing " + listing.id);
      listing.locked(() -> photo.refreshError = "Could not refresh the decision. The photo is hidden until it can be checked.");
      return false;
    }
  }

  private Response photo(String listingId, String number) {
    Listing listing = find(listingId);
    Photo photo;
    try {
      photo = listing == null ? null : listing.photo(Integer.parseInt(number));
    } catch (NumberFormatException invalid) {
      photo = null;
    }
    if (photo == null) return text(404, "Not found");
    // A withdrawn listing's photos are no longer stored: nothing is requested from CalmLens.
    if (listing.locked(() -> listing.withdrawn)) return text(410, "This listing was withdrawn");
    if (listing.locked(() -> listing.removed)) return text(403, "This listing was removed");
    if (!refreshPhoto(listing, photo)) return text(502, "Preview unavailable");
    // Never serve or sign a photo that is pending, rejected, failed, or unknown.
    Photo current = photo;
    if (!listing.locked(current::approved)) return text(403, "This photo is not approved");
    try {
      CalmLensServerClient client = backend.preview(photo);
      if (demo()) {
        // The demo CDN answers with the bytes kept for this photo.
        try (CdnResponse served = client.cdn.serve(new CdnRequest(photo.assetId).lens(CARD_LENS))) {
          if (served.status() != 200) return text(502, "Preview unavailable");
          Map<String, String> headers = securityHeaders();
          headers.put("content-type", photo.mime);
          return new Response(200, headers, served.readAllBytes(MAX_PHOTO_BYTES));
        }
      }
      if (!lensReady.get()) {
        client.ensureLens(CARD_LENS_DEFINITION); // idempotent; cached by the client
        lensReady.set(true);
      }
      SignedUrl signed = client.assets.createSignedUrl(new SignedUrlOptions(photo.assetId)
          .resource("content").lens(CARD_LENS).expiresInSeconds((long) SIGNED_URL_SECONDS));
      if (!safePreviewUrl(signed.url())) return text(502, "Invalid preview URL");
      Map<String, String> headers = securityHeaders();
      headers.put("location", signed.url());
      return new Response(303, headers, new byte[0]);
    } catch (CalmLensException error) {
      log("Preview failed", error);
      return text(502, "Preview unavailable");
    }
  }

  /** Signed URLs must be HTTPS; plain HTTP is allowed only for a local CalmLens on loopback. */
  static boolean safePreviewUrl(String url) {
    try {
      URI uri = new URI(url);
      if (uri.getHost() == null) return false;
      if ("https".equals(uri.getScheme())) return true;
      return "http".equals(uri.getScheme()) && (uri.getHost().equals("127.0.0.1") || uri.getHost().equals("localhost"));
    } catch (Exception invalid) {
      return false;
    }
  }

  // ---------------------------------------------------------------- Withdrawing listings

  /**
   * Takes the listing down at once, then removes the stored content of every photo and its OCR
   * text with {@code assets.deleteContent}. The asset records and their reports stay for audit,
   * and the CDN stops serving the photos. Removal that fails can be retried; content under a
   * safety hold cannot be removed and is not retried.
   */
  String withdraw(String listingId) throws Rejected {
    Listing listing = find(listingId);
    if (listing == null) throw new Rejected(404, "That listing does not exist.");
    listing.lock.lock();
    try {
      if (listing.removing) throw new Rejected(409, "That listing is being withdrawn. Reload the page in a moment.");
      if (listing.withdrawn && !listing.removalPending()) throw new Rejected(409, "That listing is already withdrawn.");
      listing.withdrawn = true;
      listing.removing = true;
    } finally {
      listing.lock.unlock();
    }
    int removed = 0, failed = 0, held = 0;
    try {
      for (Photo photo : listing.photos) {
        List<String> pending = listing.locked(() -> photo.contentIds().stream()
            .filter(id -> !photo.contentRemoved.contains(id) && !photo.safetyHeld.contains(id)).toList());
        for (String assetId : pending) {
          String outcome;
          try {
            Asset asset = backend.contentRemoval(assetId).assets.deleteContent(new AssetId(assetId));
            outcome = asset.content() != null && asset.content().status() == AssetContentStatus.REMOVED ? "removed" : "unconfirmed";
          } catch (CalmLensException error) {
            outcome = error.isNotFound() ? "removed" : ErrorCodes.ASSET_SAFETY_HELD.equals(error.getCode()) ? "held" : "failed";
            if (outcome.equals("failed")) log("Could not remove photo content", error);
          }
          switch (outcome) {
            case "removed" -> { listing.locked(() -> photo.contentRemoved.add(assetId)); removed++; }
            case "held" -> { listing.locked(() -> photo.safetyHeld.add(assetId)); held++; }
            default -> failed++;
          }
        }
        if (listing.locked(() -> photo.contentRemoved.contains(photo.assetId))) photo.demoBytes = null;
      }
    } finally {
      int failures = failed;
      listing.locked(() -> {
        listing.removing = false;
        listing.removalError = failures > 0 ? failures + " stored " + (failures == 1 ? "item" : "items") + " could not be removed yet." : null;
        return null;
      });
    }
    record("withdrawn", "“" + listing.title + "” was withdrawn. Stored content removed: " + removed
        + (held > 0 ? ", kept under a safety hold: " + held : "") + (failed > 0 ? ", still to remove: " + failed : "") + ".", List.of());
    return failed > 0 ? "withdrawn-pending" : "withdrawn";
  }

  // ---------------------------------------------------------------- Review decisions

  /** Pulls review decisions from the events feed. Returns a notice key. */
  String sync() throws Rejected {
    CalmLensServerClient feed = backend.events();
    if (feed == null) throw new Rejected(400, "Demo mode has no events feed. Use a simulated review decision.");
    if (!syncLock.tryLock()) throw new Rejected(409, "Review decisions are already being checked. Reload the page in a moment.");
    try {
      if (cursor == null) {
        // Without a cursor the API returns no events and a cursor for "now".
        cursor = cursor(feed.events.list(new ListEvents()));
        return "watching";
      }
      return sync(feed) == 0 ? "no-decisions" : "decisions-applied";
    } finally {
      syncLock.unlock();
    }
  }

  /** The cursor advances only after a whole page is applied, so a failed retrieval retries the page. */
  private int sync(CalmLensServerClient feed) {
    int applied = 0;
    for (int page = 0; page < MAX_EVENT_PAGES; page++) {
      EventsPage events = feed.events.list(new ListEvents().after(cursor).limit(EVENT_PAGE_SIZE));
      for (Event event : events.events())
        if (apply(event.id(), event.type(), event.assetId(), event.facts())) applied++;
      cursor = cursor(events);
      if (!events.hasMore()) break;
    }
    return applied;
  }

  private static String cursor(EventsPage page) {
    if (page.cursor() == null || page.cursor().isEmpty())
      throw new IllegalStateException("The events feed returned a page without a cursor");
    return page.cursor();
  }

  /**
   * Applies one event from the feed or a webhook. It retrieves the current decision instead of
   * trusting the event's snapshot: an event about a photo refreshes its combined decision and text. A retrieved asset whose externalId
   * does not point back to the listing changes nothing.
   */
  private boolean apply(String eventId, String type, String assetId, List<EventFact> facts) {
    if (eventId == null || type == null || seen(eventId)) return false;
    if (facts.stream().anyMatch(fact -> "test".equals(fact.key()) && Boolean.TRUE.equals(fact.value()))) {
      record("test", "Test event received. Nothing changed.", List.of());
      return markSeen(eventId, true);
    }
    Listing listing = assetId == null || !EVENT_LABELS.containsKey(type) ? null : findByAsset(assetId);
    if (listing == null || listing.locked(() -> listing.withdrawn)) return markSeen(eventId, false);
    String outcome;
    Photo photo = listing.locked(() -> listing.photoOwning(assetId));
    try {
      if (photo != null) {
        apply(listing, photo, lookUp(photo)); // throws, leaving the event unseen for a retry
        outcome = listing.locked(() -> "photo " + photo.number + " is now " + (photo.decision().equals("unknown") ? "in an unknown state" : photo.decision())
            + (photo.driver() == Driver.NONE ? "" : " · cause: " + photo.driver().label.toLowerCase(Locale.ROOT)));
      } else {
        String field = listing.textField(assetId);
        String externalId = listing.id + ":" + field;
        CalmLensServerClient client = backend.textAsset(assetId, externalId, listing.locked(() -> listing.flagged));
        Asset asset = client.assets.retrieve(new AssetId(assetId));
        if (!externalId.equals(asset.externalId())) throw new NotOurs();
        outcome = listing.locked(() -> {
          if (moderationStatus(asset) == AssetModerationStatus.APPROVED) {
            // An approval never clears a flag another field may still carry.
            listing.flagged |= flagged(asset);
            return listing.flagged ? "keeps its review badge" : "is unchanged";
          }
          listing.removed = true;
          return "was taken down";
        });
      }
    } catch (NotOurs mismatch) {
      System.err.println("Ignored an event about asset " + assetId + ": its externalId does not belong to listing " + listing.id);
      return markSeen(eventId, false);
    }
    record("review", EVENT_LABELS.get(type) + ": “" + listing.title + "” " + outcome + ".", displayFacts(facts));
    return markSeen(eventId, true);
  }

  private boolean seen(String eventId) {
    stateLock.lock();
    try { return seenEvents.contains(eventId); } finally { stateLock.unlock(); }
  }

  private boolean markSeen(String eventId, boolean applied) {
    stateLock.lock();
    try {
      seenEvents.add(eventId);
      if (seenEvents.size() > 1000) seenEvents.remove(seenEvents.iterator().next());
    } finally {
      stateLock.unlock();
    }
    return applied;
  }

  /** Runs a synthetic portal rejection of the first photo through the same events-feed code as live mode. */
  private String simulateReview(String listingId) throws Rejected {
    Listing listing = find(listingId == null ? "" : listingId);
    if (listing == null || !listing.locked(listing::visible)) throw new Rejected(409, "That listing is no longer on the market.");
    Photo photo = listing.photos.get(0);
    photo.demoReviewerRejected = true;
    CalmLensServerClient feed = backend.simulatedReview(photo);
    if (!syncLock.tryLock()) throw new Rejected(409, "Review decisions are already being checked. Reload the page in a moment.");
    try {
      sync(feed);
    } finally {
      syncLock.unlock();
    }
    return "simulated-review";
  }

  private Response webhook(Request request) {
    if (webhookSecret.isEmpty()) return text(503, "Set CALMLENS_WEBHOOK_SECRET to enable webhooks.");
    if (request.body().length > MAX_WEBHOOK_BYTES) return text(413, "Request body is too large");
    WebhookEventPayload payload;
    try {
      // Verifies the exact raw bytes before parsing anything.
      payload = CalmLensServerClient.parseWebhookEvent(request.body(), request.header(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER),
          request.header(CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER), webhookSecret);
    } catch (CalmLensException invalid) {
      return ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE.equals(invalid.getCode()) ? text(401, "Invalid signature") : text(400, "Invalid event");
    }
    try {
      apply(payload.id(), payload.type(), payload.data().assetId(), payload.data().facts());
      return new Response(204, securityHeaders(), new byte[0]);
    } catch (CalmLensException error) {
      // A failed refresh returns an error so CalmLens retries the delivery.
      log("Webhook refresh failed", error);
      return text(502, "Could not refresh asset");
    }
  }

  /** Registered facts become display rows. Only absolute HTTP(S) URLs become links. */
  static List<FactRow> displayFacts(List<EventFact> facts) {
    List<FactRow> rows = new ArrayList<>();
    for (EventFact fact : facts) {
      String label = fact.key() == null ? null : FACT_LABELS.get(fact.key());
      if (label == null || fact.value() == null) continue;
      String value = fact.value() instanceof List<?> list ? String.join(", ", list.stream().map(String::valueOf).toList()) : String.valueOf(fact.value());
      if (value.isEmpty()) continue;
      String url = fact.url() != null && fact.url().matches("(?i)https?://[^\\s\\\\]+") ? fact.url() : null;
      rows.add(new FactRow(label, value.length() > 200 ? value.substring(0, 200) : value, url));
    }
    return rows;
  }

  // ---------------------------------------------------------------- Helpers

  List<Listing> listings() {
    stateLock.lock();
    try { return List.copyOf(listings); } finally { stateLock.unlock(); }
  }

  List<Activity> activity() {
    stateLock.lock();
    try { return List.copyOf(activity); } finally { stateLock.unlock(); }
  }

  Listing find(String id) {
    return listings().stream().filter(listing -> listing.id.equals(id)).findFirst().orElse(null);
  }

  private Listing findByAsset(String assetId) {
    return listings().stream().filter(listing -> listing.locked(() -> listing.owns(assetId))).findFirst().orElse(null);
  }

  private void record(String kind, String text, List<FactRow> facts) {
    stateLock.lock();
    try {
      activity.addFirst(new Activity(kind, text, facts, Instant.now()));
      while (activity.size() > MAX_ACTIVITY) activity.removeLast();
    } finally {
      stateLock.unlock();
    }
  }

  static Map<String, String> securityHeaders() {
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("cache-control", "no-store");
    headers.put("x-content-type-options", "nosniff");
    headers.put("referrer-policy", "no-referrer");
    headers.put("content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: http://127.0.0.1:* http://localhost:*; form-action 'self'; frame-ancestors 'none'");
    return headers;
  }

  private static Response redirect(String notice) {
    if (!NOTICES.containsKey(notice)) throw new IllegalArgumentException("Unknown notice " + notice);
    Map<String, String> headers = securityHeaders();
    headers.put("location", "/?notice=" + notice);
    return new Response(303, headers, new byte[0]);
  }

  static Response text(int status, String message) {
    Map<String, String> headers = securityHeaders();
    headers.put("content-type", "text/plain; charset=utf-8");
    return new Response(status, headers, (message + "\n").getBytes(StandardCharsets.UTF_8));
  }
}
