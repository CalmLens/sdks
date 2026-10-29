package com.calmlens;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.SortedMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.LongSupplier;

/**
 * An offline client for tests. {@link #client} is a real {@link CalmLensServerClient} (validation,
 * encoding, retries, error mapping) whose transport answers from an in-memory API, and records
 * every request it receives.
 *
 * <p>The in-memory API keeps assets, folders, hash lists, events and content: uploads create assets you can
 * retrieve, list (RSQL filters such as {@code classification.moderation.status==blocked},
 * ordering, folder and cursor paging), search, update, move and delete, and the CDN serves their
 * stored bytes. It does not classify content: {@code assets.create} (and queued multipart uploads)
 * end at {@link Options#queuedOutcome} ({@code pending} by default), {@code assets.classify} and
 * {@code text.classify} at {@link Options#analyzedOutcome} ({@code allowed} by default). Finished
 * processing removes the content unless the upload sets {@code keepContentAfterProcessing}, and
 * {@code purged} always removes it. {@link #decide} changes an asset's status as a reviewer would.
 * Errors use the API's codes, statuses and body, every response has an {@code X-Request-Id}, and
 * idempotency keys replay the first response.
 *
 * <pre>{@code
 * var mock = new MockCalmLensServerClient(new MockCalmLensServerClient.Options().queuedOutcome(MockCalmLensServerClient.Outcome.PENDING));
 * Models.Asset asset = mock.client.assets.create("photo.png", bytes, "image/png");
 * mock.decide(asset.id(), MockCalmLensServerClient.Outcome.BLOCKED);      // adds an asset.blocked event
 * mock.client.assets.waitForDecision(new Models.WaitForDecision(asset.id()));
 * }</pre>
 *
 * <p>The CDN refuses {@code blocked} and {@code purged} assets, serves {@code limited} ones like
 * {@code allowed} ones, serves age-restricted ones only with {@code viewerClaims(new
 * ViewerClaims().ageConfirmed(true))} whatever the key, and serves private ones only to an API key
 * with the {@code assets:download} grant (see {@link #createMockApiKey}).
 *
 * <p>Queued responses take precedence, in order: {@link #enqueue(int, Object)}, {@link
 * #enqueueError}, {@link #enqueueEvents}, {@link #enqueueCdn} and the other {@code enqueue}
 * methods answer the next request instead of the in-memory API. A response queued for a route
 * ({@link #enqueue(String, String, int, Object)}) waits until a request for that route arrives;
 * other requests meanwhile go to the in-memory API. Like the real client, reads and uploads are
 * retried on HTTP 429, 502, 503 and 504 and on network failures (without waiting), so queue one
 * response per attempt, or build the mock from a builder with {@code maxRetries(0)}.
 *
 * <p>{@code assets.waitForDecision} retrieves the asset until its {@code
 * classification.moderation.status} is no longer {@code pending} or its classification failed.
 * Its waits are skipped but still count towards its timeout, so a pending asset times out at once.
 */
public final class MockCalmLensServerClient implements AutoCloseable {
  /**
   * A captured request. {@code path} is the raw URL path, including the base URL's path (for
   * example {@code /v1/projects/project-1/assets}); {@code query} holds the decoded query
   * parameters in request order. {@link #toString()} hides the API key.
   *
   * @param method HTTP method
   * @param url full URL
   * @param path raw path
   * @param query decoded query parameters
   * @param headers request headers
   * @param body request body, or null
   */
  public record Request(String method, String url, String path, Map<String, String> query, Map<String, String> headers, byte[] body) {
    /** Copies every value. */
    public Request {
      query = Collections.unmodifiableMap(new LinkedHashMap<>(query));
      headers = Collections.unmodifiableMap(new LinkedHashMap<>(headers));
      body = body == null ? null : body.clone();
    }

    @Override public byte[] body() { return body == null ? null : body.clone(); }

    /** @return the body decoded as UTF-8, or null when the request had no body */
    public String bodyText() { return body == null ? null : new String(body, StandardCharsets.UTF_8); }

    /**
     * @param name header name, matched case-insensitively
     * @return the header value, or null
     */
    public String header(String name) {
      return headers.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name)).map(Map.Entry::getValue).findFirst().orElse(null);
    }

    @Override public String toString() {
      Map<String, String> safe = new LinkedHashMap<>();
      headers.forEach((name, value) -> safe.put(name, name.equalsIgnoreCase("X-Api-Key") ? "[redacted]" : value));
      return "Request[method=" + method + ", url=" + url + ", headers=" + safe + ", body=" + (body == null ? "none" : body.length + " bytes") + "]";
    }
  }

  private record Queued(String method, String path, Transport.Response response, Exception failure) {
    boolean matches(String requestMethod, String requestPath) {
      return (method == null || method.equalsIgnoreCase(requestMethod)) && (path == null || requestPath.endsWith(path));
    }
  }

  /** Where a mock upload ends up. */
  public enum Outcome {
    /** Still processing. */
    PENDING("pending"),
    /** Processing done; moderation {@code allowed}. */
    ALLOWED("allowed"),
    /** Processing done; moderation {@code limited}, delivered like {@code allowed}. */
    LIMITED("limited"),
    /** Processing done; moderation {@code age-restricted}. */
    AGE_RESTRICTED("age-restricted"),
    /** Processing done; moderation {@code blocked}. */
    BLOCKED("blocked"),
    /** Processing done; moderation {@code purged}, and the content is removed. */
    PURGED("purged"),
    /** Processing failed; the asset can be retried. */
    FAILED("failed");

    private final String value;

    Outcome(String value) { this.value = value; }

    /** @return the API value, such as {@code age-restricted} */
    public String value() { return value; }
  }

  /** Outcome, ID and clock controls for the in-memory API. */
  public static final class Options {
    java.util.function.Function<Models.Asset, Outcome> queuedOutcome = asset -> Outcome.PENDING, analyzedOutcome = asset -> Outcome.ALLOWED;
    java.util.function.Function<String, String> createId = MockApi::newId;
    LongSupplier now = monotonicClock();
    String signedUrlBaseUrl = "https://mock.calmlens.invalid";

    /** Defaults: queued uploads stay pending, analyzed ones are allowed. */
    public Options() {}

    /** @param value outcome of {@code assets.create} and queued multipart uploads @return these options */
    public Options queuedOutcome(Outcome value) { Objects.requireNonNull(value, "queuedOutcome"); queuedOutcome = asset -> value; return this; }

    /**
     * Chooses each queued upload's outcome, for example from {@code asset.name()}.
     *
     * @param value returns the outcome of each {@code assets.create} and queued multipart upload
     * @return these options
     */
    public Options queuedOutcome(java.util.function.Function<Models.Asset, Outcome> value) { queuedOutcome = Objects.requireNonNull(value, "queuedOutcome"); return this; }

    /** @param value outcome of {@code assets.classify} and {@code text.classify} @return these options */
    public Options analyzedOutcome(Outcome value) { Objects.requireNonNull(value, "analyzedOutcome"); analyzedOutcome = asset -> value; return this; }

    /**
     * Chooses each moderated upload's outcome, for example from {@code asset.name()}.
     *
     * @param value returns the outcome of each {@code assets.classify} and {@code text.classify}
     * @return these options
     */
    public Options analyzedOutcome(java.util.function.Function<Models.Asset, Outcome> value) { analyzedOutcome = Objects.requireNonNull(value, "analyzedOutcome"); return this; }

    /** The outcome for an upload that finished, from its stored record. */
    Outcome outcome(JsonObject asset, boolean queue) {
      Outcome outcome = (queue ? queuedOutcome : analyzedOutcome).apply(Json.GSON.fromJson(asset, Models.Asset.class));
      return Objects.requireNonNull(outcome, "outcome");
    }

    /**
     * @param value returns a new ID for an object of the kind the prefix names ({@code asset},
     *     {@code fldr}, {@code hl}, {@code hle}, {@code lens}, {@code evt} or {@code rev}); by
     *     default, like the API, the prefix, {@code _} and 20 random base62 characters, such as
     *     {@code asset_5Gm2Rk8XqT3wLp9VbN4c}
     * @return these options
     */
    public Options createId(java.util.function.Function<String, String> value) { createId = Objects.requireNonNull(value, "createId"); return this; }

    /**
     * @param value the current time in milliseconds since the Unix epoch; by default the system
     *     clock, moved on by at least a millisecond per reading so each asset is created after the last
     * @return these options
     */
    public Options now(LongSupplier value) { now = Objects.requireNonNull(value, "now"); return this; }

    /** @param value base URL of returned signed URLs (not production URLs) @return these options */
    public Options signedUrlBaseUrl(String value) { signedUrlBaseUrl = Objects.requireNonNull(value, "signedUrlBaseUrl").replaceAll("/+$", ""); return this; }

    private static LongSupplier monotonicClock() {
      java.util.concurrent.atomic.AtomicLong last = new java.util.concurrent.atomic.AtomicLong(Long.MIN_VALUE);
      return () -> last.updateAndGet(previous -> Math.max(previous + 1, System.currentTimeMillis()));
    }

    private Options copy() {
      Options copy = new Options().createId(createId).now(now).signedUrlBaseUrl(signedUrlBaseUrl);
      copy.queuedOutcome = queuedOutcome;
      copy.analyzedOutcome = analyzedOutcome;
      return copy;
    }
  }

  /**
   * A CDN download grant carried by a mock API key.
   *
   * @param actions granted actions, such as {@code assets:download}
   * @param folderId the folder the grant covers, or null for the whole project
   * @param includeSubfolders whether it also covers the folder's subfolders
   */
  public record Grant(List<String> actions, String folderId, boolean includeSubfolders) {
    /** Copies the actions. */
    public Grant { actions = List.copyOf(actions); }

    /** @return {@code assets:download} for the whole project */
    public static Grant download() { return new Grant(List.of("assets:download"), null, true); }
  }

  /**
   * Upload bytes of one asset.
   *
   * @param type the content's MIME type
   * @param parts the bytes by part number
   */
  public record StoredContent(String type, SortedMap<Integer, byte[]> parts) {
    /** @return the parts joined in order */
    public byte[] bytes() {
      var out = new java.io.ByteArrayOutputStream();
      parts.values().forEach(out::writeBytes);
      return out.toByteArray();
    }
  }

  /**
   * The in-memory API's records, with the API's field names. Change them inside {@link
   * #withStorage} to arrange a test, for example to set an asset's {@code
   * classification.moderation.status}.
   */
  public static final class Storage {
    /** Assets by ID. */
    public final Map<String, JsonObject> assets = new LinkedHashMap<>();
    /** Folders by ID. */
    public final Map<String, JsonObject> folders = new LinkedHashMap<>();
    /** Hash lists by ID. */
    public final Map<String, JsonObject> hashLists = new LinkedHashMap<>();
    /** Hash list entries by ID, oldest first. */
    public final Map<String, JsonObject> hashListEntries = new LinkedHashMap<>();
    /** The events feed, oldest first. */
    public final List<JsonObject> events = new ArrayList<>();
    /** Stored content by asset ID. */
    public final Map<String, StoredContent> content = new LinkedHashMap<>();

    Storage() {}
  }

  /**
   * A mock API key carrying CDN download grants. Pass it to the builder ({@code
   * CalmLensServerClient.builder(createMockApiKey(Grant.download()), "project-1")}) so {@code
   * cdn.serve} may read private and age-restricted assets.
   *
   * @param grants the grants
   * @return the key
   */
  public static String createMockApiKey(Grant... grants) {
    return "sk_test_" + Base64.getUrlEncoder().withoutPadding().encodeToString(Json.write(grantsJson(List.of(grants))).getBytes(StandardCharsets.UTF_8));
  }

  private static JsonArray grantsJson(List<Grant> grants) {
    JsonArray list = new JsonArray();
    for (Grant grant : grants) {
      JsonObject item = new JsonObject();
      JsonArray actions = new JsonArray();
      grant.actions().forEach(actions::add);
      item.add("actions", actions);
      item.addProperty("folderId", grant.folderId());
      item.addProperty("includeSubfolders", grant.includeSubfolders());
      list.add(item);
    }
    return list;
  }

  /**
   * Signs an upload token like {@code client.uploadTokens.sign}, with the same validation, at a
   * fixed time and nonce, so a test can compare exact tokens.
   *
   * @param apiKey the API key that signs it
   * @param options the preset, optional external ID and lifetime
   * @param now the signing time, in milliseconds since the Unix epoch
   * @param nonce the token's nonce
   * @return the token and when it expires
   */
  public static Models.SignedUploadToken signUploadToken(String apiKey, Models.SignUploadToken options, long now, String nonce) {
    if (apiKey == null || apiKey.isEmpty()) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "An API key is required");
    if (nonce == null || nonce.isEmpty()) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "A nonce is required");
    return CalmLensServerClient.signUploadToken(apiKey, options, now, nonce);
  }

  /**
   * Replaces the grants of the mock's API key, as editing the key in the portal would: later
   * requests, such as {@code cdn.serve}, use them. The key itself stays the same, so the
   * idempotency keys it used still replay.
   *
   * @param grants the key's new grants (none for a key without permissions)
   */
  public synchronized void setApiKeyGrants(Grant... grants) { api.grants = grantsJson(List.of(grants)); }

  /**
   * Makes the next request fail without running, as if it never completed: {@code
   * "transport-error"} ({@link ErrorCodes#SDK_TRANSPORT_ERROR}), {@code "timeout"} ({@link
   * ErrorCodes#SDK_TIMEOUT}) or a public API error code, answered with its HTTP status. Queue
   * several to fail several requests; each is used once.
   *
   * @param failure {@code transport-error}, {@code timeout} or an API error code
   */
  public void failNextRequest(String failure) { failNextRequest(failure, null); }

  /**
   * Makes the next request for {@code operation} fail without running; other requests are
   * answered meanwhile.
   *
   * @param failure {@code transport-error}, {@code timeout} or an API error code
   * @param operation a client method path, such as {@code assets.create}, {@code cdn.serve} or
   *     {@code assets.waitForDecision}, or null for any request
   */
  public synchronized void failNextRequest(String failure, String operation) {
    Objects.requireNonNull(failure, "failure");
    if (!failure.equals("transport-error") && !failure.equals("timeout") && ErrorCodes.httpStatus(failure).isEmpty())
      throw new IllegalArgumentException("failure must be transport-error, timeout or an API error code: " + failure);
    failures.add(new String[] {failure, operation});
  }

  private final Deque<Queued> responses = new ArrayDeque<>();
  private final List<String[]> failures = new ArrayList<>();
  private final MockApi api;
  private final String projectId;
  private final List<Request> requests = new ArrayList<>();
  /** Time the client spent in skipped waits; it moves the client's clock forward. */
  private final AtomicLong skippedNanos = new AtomicLong();
  /** The client under test. */
  public final CalmLensServerClient client;

  /** A mock for project {@code project-1} with unreachable base URLs and default {@link Options}. */
  public MockCalmLensServerClient() { this(new Options()); }

  /**
   * A mock for project {@code project-1} with unreachable base URLs.
   *
   * @param options outcome, ID and clock controls (copied)
   */
  public MockCalmLensServerClient(Options options) {
    this(CalmLensServerClient.builder("mock-key", "project-1").baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1"), options);
  }

  /**
   * A mock configured like a real client: project ID, base URLs, timeouts and retries come from the
   * builder and are validated the same way. Only the transport is replaced; the builder is unchanged.
   *
   * @param builder client options
   */
  public MockCalmLensServerClient(CalmLensServerClient.Builder builder) { this(builder, new Options()); }

  /**
   * @param builder client options
   * @param options outcome, ID and clock controls (copied)
   */
  public MockCalmLensServerClient(CalmLensServerClient.Builder builder, Options options) {
    client = builder.build(this::send, delay -> skippedNanos.addAndGet(delay.toNanos()), () -> System.nanoTime() + skippedNanos.get());
    // The in-memory API answers multipart size checks in the API's order.
    client.deferUploadChecks = true;
    projectId = client.projectId();
    api = new MockApi(projectId, client.baseUrl(), client.cdnBaseUrl(), Objects.requireNonNull(options, "options").copy());
  }

  private static Map<String, List<String>> headers(Object... pairs) {
    Map<String, List<String>> headers = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) if (pairs[i + 1] != null) headers.put((String) pairs[i], List.of(pairs[i + 1].toString()));
    return headers;
  }

  static String requestId() { return "req_mock_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12); }

  private synchronized MockCalmLensServerClient add(String method, String path, Transport.Response response, Exception failure) {
    responses.add(new Queued(method, path, response, failure));
    return this;
  }

  /**
   * Queues a JSON response for the next request. {@code body} may be a model record, a {@code Map}
   * or {@code List}, or a Gson tree.
   *
   * @param status HTTP status
   * @param body the JSON body
   * @return this mock
   */
  public MockCalmLensServerClient enqueue(int status, Object body) { return enqueue(null, null, status, body); }

  /**
   * Queues a JSON response for the next request, which must match {@code method} and end with
   * {@code path} (for example {@code "GET", "/assets/search"}).
   *
   * @param method HTTP method, or null for any
   * @param path path suffix, or null for any
   * @param status HTTP status
   * @param body the JSON body
   * @return this mock
   */
  public MockCalmLensServerClient enqueue(String method, String path, int status, Object body) {
    byte[] json = Json.WRITE.toJson(Json.GSON.toJsonTree(body)).getBytes(StandardCharsets.UTF_8);
    return add(method, path, new Transport.Response(status, headers("content-type", "application/json", "x-request-id", requestId()), json), null);
  }

  /**
   * Queues a response with raw bytes, for malformed or binary bodies.
   *
   * @param status HTTP status
   * @param body response bytes (copied)
   * @return this mock
   */
  public MockCalmLensServerClient enqueueRaw(int status, byte[] body) {
    return add(null, null, new Transport.Response(status, headers("x-request-id", requestId()), body.clone()), null);
  }

  /**
   * Queues the API's error response for {@code code}: its real HTTP status (from {@link
   * ErrorCodes#httpStatus(String)}), the {@code {code, message, traceId}} body, an {@code
   * X-Request-Id} and, for {@link ErrorCodes#IDEMPOTENT_REQUEST_IN_PROGRESS}, {@code Retry-After}.
   *
   * @param code a public API error code, such as {@link ErrorCodes#ASSET_NOT_FOUND}
   * @return this mock
   */
  public MockCalmLensServerClient enqueueError(String code) {
    int status = ErrorCodes.httpStatus(code).orElseThrow(() -> new IllegalArgumentException("Unknown API error code: " + code));
    JsonObject body = new JsonObject();
    body.addProperty("code", code);
    body.addProperty("message", "Mock " + code);
    body.addProperty("traceId", "trace_mock");
    byte[] json = Json.write(body).getBytes(StandardCharsets.UTF_8);
    String retryAfter = ErrorCodes.IDEMPOTENT_REQUEST_IN_PROGRESS.equals(code) ? "1" : null;
    return add(null, null, new Transport.Response(status, headers("content-type", "application/json", "x-request-id", requestId(), "retry-after", retryAfter), json), null);
  }

  /**
   * Queues an HTTP 429 with {@code Retry-After}, as the API sends when a request is throttled. It
   * surfaces as an {@link ApiException} with {@link ErrorCodes#SDK_HTTP_ERROR} once retries are used up.
   *
   * @param retryAfterSeconds the delay the API asks for
   * @return this mock
   */
  public MockCalmLensServerClient enqueueRateLimited(int retryAfterSeconds) {
    byte[] json = "{\"message\":\"Too many requests\"}".getBytes(StandardCharsets.UTF_8);
    return add(null, null, new Transport.Response(429, headers("content-type", "application/json", "x-request-id", requestId(), "retry-after", retryAfterSeconds), json), null);
  }

  /**
   * Queues one page of the events feed. {@code events} may be {@link Models.Event} records or maps.
   *
   * @param cursor the page's cursor
   * @param hasMore whether more events follow
   * @param events the events, oldest first
   * @return this mock
   */
  public MockCalmLensServerClient enqueueEvents(String cursor, boolean hasMore, Object... events) {
    Map<String, Object> page = new LinkedHashMap<>();
    page.put("events", List.of(events));
    page.put("cursor", Objects.requireNonNull(cursor, "cursor"));
    page.put("hasMore", hasMore);
    return enqueue("GET", "/events", 200, page);
  }

  /**
   * Queues a CDN response like the CDN sends: the bytes with {@code Content-Type}, {@code
   * Content-Length} and {@code X-Request-Id}.
   *
   * @param status HTTP status, such as 200 or 403
   * @param contentType the content's MIME type
   * @param body the content (copied)
   * @return this mock
   */
  public MockCalmLensServerClient enqueueCdn(int status, String contentType, byte[] body) {
    return add(null, null, new Transport.Response(status,
        headers("content-type", contentType, "content-length", body.length, "x-request-id", requestId()), body.clone()), null);
  }

  /**
   * Queues a failure thrown by the transport instead of a response, for example {@code new
   * java.net.ConnectException("refused")}. The client wraps it as it wraps real network failures
   * ({@link TransportException}, cause preserved).
   *
   * @param error the failure
   * @return this mock
   */
  public MockCalmLensServerClient enqueueFailure(Exception error) { return add(null, null, null, Objects.requireNonNull(error, "error")); }

  /** @return this mock, with a request timeout queued ({@link RequestTimeoutException}) */
  public MockCalmLensServerClient enqueueTimeout() { return enqueueFailure(new HttpTimeoutException("request timed out")); }

  /**
   * Gives an asset a new outcome, as a reviewer would: a decision ({@code allowed}, {@code
   * limited}, {@code age-restricted}, {@code blocked} or {@code purged}) records a manual review and
   * adds the matching {@code asset.<status>} event with the asset's snapshot, the event catalog's
   * severity ({@code low} for {@code allowed} and {@code limited}, {@code high} otherwise) and a
   * {@code decided-by: reviewer} fact. {@code purged} removes the content with reason {@code requested}, adding an {@code
   * asset.content-removed} event first, as the API does. {@code pending} and {@code failed} only
   * change the processing state ({@code failed} adds an {@code asset.failed} event).
   *
   * @param assetId a stored asset
   * @param outcome the new outcome
   * @return the asset
   * @throws ApiException {@link ErrorCodes#ASSET_NOT_FOUND} when the asset is not stored
   */
  public synchronized Models.Asset decide(String assetId, Outcome outcome) {
    Objects.requireNonNull(outcome, "outcome");
    JsonObject asset;
    try {
      asset = api.asset(assetId);
    } catch (MockApi.Failure missing) {
      Transport.Response response = MockApi.error(missing);
      throw new ApiException(missing.code, missing.getMessage(), Map.of("traceId", "trace_mock"), missing.status, response.headers(), null);
    }
    long now = api.now();
    api.applyOutcome(asset, outcome, "requested", now);
    if (outcome == Outcome.PENDING) return Json.GSON.fromJson(asset, Models.Asset.class);
    if (outcome != Outcome.FAILED) {
      JsonObject review = new JsonObject();
      review.addProperty("id", api.createId("rev"));
      review.addProperty("decision", outcome.value());
      review.add("note", null);
      review.add("reviewerUserId", null);
      review.addProperty("reviewedAt", now);
      review.addProperty("appliedToAsset", true);
      asset.getAsJsonObject("classification").getAsJsonObject("moderation").getAsJsonArray("manualReviews").add(review);
    }
    String name = MockApi.str(asset, "name"), type = MockApi.str(asset, "type");
    if (outcome == Outcome.PURGED)
      api.recordEvent("asset.content-removed", "low", asset, List.of(new Models.EventFact("asset-name", name, "https://calmlens.com/go/asset/" + assetId), new Models.EventFact("asset-type", type, null)));
    // Like the event catalog: allowing and limiting are low severity.
    api.recordEvent("asset." + outcome.value(), outcome == Outcome.ALLOWED || outcome == Outcome.LIMITED ? "low" : "high", asset, java.util.Arrays.asList(
        new Models.EventFact("decided-by", "reviewer", null), new Models.EventFact("asset-type", type, null),
        new Models.EventFact("asset-name", name, "https://calmlens.com/go/asset/" + assetId), new Models.EventFact("note", null, null)));
    return Json.GSON.fromJson(asset, Models.Asset.class);
  }

  /**
   * Adds an event to the feed that {@code events.list} and {@code events.pages} return after
   * cursors taken earlier. When {@code assetId} names a stored asset, the event carries a snapshot
   * of its status, as the API's events do.
   *
   * @param type a registered event type, such as {@code asset.blocked}
   * @param assetId the asset the event is about, or null
   * @param facts the event's registered facts
   * @return the event
   */
  public synchronized Models.Event enqueueEvent(String type, String assetId, Models.EventFact... facts) {
    long now = api.now();
    JsonObject event = new JsonObject();
    event.addProperty("id", api.createId("evt"));
    event.addProperty("projectId", projectId);
    event.add("userId", null);
    event.addProperty("type", Objects.requireNonNull(type, "type"));
    event.addProperty("severity", "low");
    event.addProperty("title", type);
    event.add("description", null);
    event.addProperty("assetId", assetId);
    JsonObject asset = assetId == null ? null : api.storage.assets.get(assetId);
    event.add("asset", asset == null ? null : MockApi.snapshot(asset));
    event.add("facts", MockApi.facts(java.util.Arrays.asList(facts)));
    event.addProperty("notify", false);
    event.addProperty("createdAt", now);
    event.addProperty("updatedAt", now);
    event.add("readAt", null);
    api.storage.events.add(event);
    return Json.GSON.fromJson(event, Models.Event.class);
  }

  /**
   * Reads or changes the in-memory records while no request is being answered.
   *
   * @param change receives the storage
   */
  public synchronized void withStorage(Consumer<Storage> change) { change.accept(api.storage); }

  /** @return every request received so far */
  public synchronized List<Request> requests() { return List.copyOf(requests); }

  /** @return the number of queued responses not used yet */
  public synchronized int remainingResponses() { return responses.size(); }

  /** Closes {@link #client}. */
  @Override public void close() { client.close(); }

  /** The status of the last response, null when the last request failed without one; the contract tests check it. */
  Integer lastStatus;

  private Transport.Response send(Transport.Request request) throws IOException, InterruptedException {
    synchronized (this) {
      lastStatus = null;
    }
    Transport.Response response = answer(request);
    synchronized (this) {
      lastStatus = response.status();
    }
    return response;
  }

  private Transport.Response answer(Transport.Request request) throws IOException, InterruptedException {
    Request captured = capture(request);
    Queued next;
    synchronized (this) {
      requests.add(captured);
      Set<String> operations = api.operations(captured);
      for (int i = 0; i < failures.size(); i++) {
        String[] pending = failures.get(i);
        if (pending[1] != null && !operations.contains(pending[1])) continue;
        failures.remove(i);
        if (pending[0].equals("transport-error")) throw new java.net.ConnectException("Simulated network failure");
        if (pending[0].equals("timeout")) throw new HttpTimeoutException("The operation timed out");
        return MockApi.error(new MockApi.Failure(pending[0]));
      }
      if (!responses.isEmpty() && responses.peek().matches(request.method(), captured.path())) next = responses.remove();
      else return api.answer(captured);
    }
    if (next.failure() != null) {
      if (next.failure() instanceof IOException e) throw e;
      if (next.failure() instanceof InterruptedException e) throw e;
      if (next.failure() instanceof RuntimeException e) throw e;
      throw new IOException(next.failure());
    }
    Transport.Response response = next.response();
    // Each queued body is read once; hand out a fresh stream so the queue can be inspected safely.
    byte[] body = response.body().readAllBytes();
    return new Transport.Response(response.status(), response.headers(), body);
  }

  private static Request capture(Transport.Request request) throws IOException {
    URI uri = request.uri();
    Map<String, String> query = new LinkedHashMap<>();
    if (uri.getRawQuery() != null)
      for (String pair : uri.getRawQuery().split("&")) {
        if (pair.isEmpty()) continue;
        String[] parts = pair.split("=", 2);
        query.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8), parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "");
      }
    byte[] body = null;
    if (request.body() != null) {
      try (InputStream in = request.body().open()) { body = in.readAllBytes(); }
    }
    return new Request(request.method(), uri.toString(), uri.getRawPath(), query, request.headers(), body);
  }
}
