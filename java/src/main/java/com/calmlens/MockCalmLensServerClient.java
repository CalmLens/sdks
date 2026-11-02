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
 * stored bytes. It does not classify content: {@link Options#moderate} decides each upload from the
 * asset, its content and why it is moderated, with a status or a {@link MockDecision}. Without it,
 * queued uploads ({@code assets.create}), retries and reruns stay {@code pending} until {@link
 * #completeProcessing}, and {@code assets.classify} and {@code text.classify} are {@code allowed}.
 * Like the pipeline, a finished upload records {@code asset.uploaded}, then {@code asset.classified}
 * and the automated {@code asset.<status>} (or {@code asset.failed}). Finished processing removes
 * the content unless the upload sets {@code keepContentAfterProcessing}, and {@code purged} always
 * removes it. {@link #decide} changes an asset's status as a reviewer would. Errors use the API's
 * codes, statuses and body, every response has an {@code X-Request-Id}, and idempotency keys replay
 * the first response.
 *
 * <pre>{@code
 * var mock = new MockCalmLensServerClient(new MockCalmLensServerClient.Options().moderate(input ->
 *     "threat.txt".equals(input.asset().name())
 *         ? MockDecision.of("blocked").flag("violence", 0.92, Map.of("violence-threat", 0.9))
 *         : MockDecision.of(input.queued() && input.trigger() != MockCalmLensServerClient.Trigger.COMPLETE ? "pending" : "allowed")));
 * Models.Asset asset = mock.client.assets.create("photo.png", bytes, "image/png");  // pending
 * mock.completeProcessing(asset.id(), MockDecision.of("blocked").flag("violence", 0.9));
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
 * other requests meanwhile go to the in-memory API. The mock's client makes no retries unless its
 * builder sets {@code maxRetries}, so each queued response or failure answers one call. With
 * retries, reads and uploads are retried on HTTP 429, 502, 503 and 504 and on network failures
 * (without waiting), and each attempt takes the next queued answer.
 *
 * <p>{@code assets.waitForDecision} retrieves the asset until its {@code
 * classification.moderation.status} is no longer {@code pending} or its classification failed.
 * Its waits are skipped but still count towards its timeout, so a pending asset times out at once.
 */
public final class MockCalmLensServerClient implements AutoCloseable {
  /**
   * A captured request. {@code path} is relative to the API (or CDN) base URL, with its segments
   * decoded (for example {@code /projects/project-1/assets} or {@code /assets/asset_1}); {@code
   * query} holds the decoded query parameters in request order. {@link #toString()} hides the API key.
   *
   * @param method HTTP method
   * @param url full URL
   * @param path the path after the base URL, segments decoded
   * @param query decoded query parameters
   * @param headers request headers
   * @param body request body, or null
   * @param status the response's HTTP status, or null when the request failed without one (or is
   *     still being answered)
   */
  public record Request(String method, String url, String path, Map<String, String> query, Map<String, String> headers, byte[] body, Integer status) {
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
      return "Request[method=" + method + ", url=" + url + ", headers=" + safe + ", body=" + (body == null ? "none" : body.length + " bytes") + ", status=" + status + "]";
    }

    Request withStatus(Integer value) { return new Request(method, url, path, query, headers, body, value); }
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
    /** Processing failed with {@code failureReason} {@code processing-error}; the asset can be retried. */
    FAILED("failed");

    private final String value;

    Outcome(String value) { this.value = value; }

    /** @return the API value, such as {@code age-restricted} */
    public String value() { return value; }
  }

  /** Why the mock is moderating an asset, for {@link Options#moderate}. */
  public enum Trigger {
    /** An upload completed: {@code assets.create}, {@code assets.classify}, {@code text.classify} or a final part. */
    UPLOAD("upload"),
    /** {@code assets.retry} queued a failed asset again. */
    RETRY("retry"),
    /** {@code assets.explain} with {@code rerun} queued the asset again. */
    RERUN("rerun"),
    /** {@link MockCalmLensServerClient#completeProcessing(String)} finished processing without a decision of its own. */
    COMPLETE("complete");

    private final String value;

    Trigger(String value) { this.value = value; }

    /** @return the trigger's name, such as {@code upload} */
    public String value() { return value; }
  }

  /**
   * The uploaded content {@link Options#moderate} receives.
   *
   * @param bytes the uploaded bytes (parts joined in order), or null without stored content, such
   *     as a website or removed content
   * @param text the bytes decoded as UTF-8 for a {@code plaintext-document}, else null
   */
  public record Content(byte[] bytes, String text) {
    /** Copies the bytes. */
    public Content { bytes = bytes == null ? null : bytes.clone(); }

    @Override public byte[] bytes() { return bytes == null ? null : bytes.clone(); }
  }

  /**
   * What {@link Options#moderate} receives for each asset the mock moderates.
   *
   * @param asset the asset as stored, still processing
   * @param content its uploaded content
   * @param trigger why it is moderated
   * @param queued true when the API would queue the work rather than answer with the decision:
   *     queued uploads, retries, reruns and {@link MockCalmLensServerClient#completeProcessing(String)}
   */
  public record ModerationInput(Models.Asset asset, Content content, Trigger trigger, boolean queued) {}

  /** The default {@link Options#moderate}: queued work stays pending until {@link MockCalmLensServerClient#completeProcessing(String)}, which allows it. */
  static MockDecision defaultModerate(ModerationInput input) {
    return MockDecision.of(input.queued() && input.trigger() != Trigger.COMPLETE ? Outcome.PENDING : Outcome.ALLOWED);
  }

  /** Moderation, ID and clock controls for the in-memory API. */
  public static final class Options {
    java.util.function.Function<ModerationInput, MockDecision> moderate = MockCalmLensServerClient::defaultModerate;
    java.util.function.Function<String, String> createId = MockApi::newId;
    LongSupplier now = monotonicClock();
    String signedUrlBaseUrl = "https://mock.calmlens.invalid";

    /** Defaults: queued work stays pending until {@link MockCalmLensServerClient#completeProcessing(String)}, everything else is allowed. */
    public Options() {}

    /**
     * Decides each asset the mock moderates: uploads ({@code assets.create}, {@code
     * assets.classify}, {@code text.classify} and final parts), retries, reruns and {@link
     * #completeProcessing(String)} without a decision. Return {@code MockDecision.of("pending")} to
     * leave the asset processing.
     *
     * @param value returns the decision for each input
     * @return these options
     */
    public Options moderate(java.util.function.Function<ModerationInput, MockDecision> value) { moderate = Objects.requireNonNull(value, "moderate"); return this; }

    /** Asks {@link #moderate} for a decision. */
    MockDecision decide(ModerationInput input) {
      MockDecision decision = moderate.apply(input);
      if (decision == null) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "moderate must return a MockDecision");
      return decision;
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
      return new Options().moderate(moderate).createId(createId).now(now).signedUrlBaseUrl(signedUrlBaseUrl);
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
   * Which request {@link #failNextRequest(String, FailureOptions)} fails, and the details and
   * {@code Retry-After} of an API error.
   */
  public static final class FailureOptions {
    String operation;
    Map<String, Object> details;
    Integer retryAfter;

    /** Fails the next request, with the API error's default body. */
    public FailureOptions() {}

    /**
     * @param value a client method path, such as {@code assets.create}, {@code cdn.serve} or
     *     {@code assets.waitForDecision}; the failure waits for a request it sends
     * @return these options
     * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for a method that sends no
     *     request
     */
    public FailureOptions operation(String value) {
      if (!MockApi.OPERATIONS.contains(value)) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Unknown operation: " + value);
      operation = value;
      return this;
    }

    /** @param value the API error's {@code details} (copied) @return these options */
    public FailureOptions details(Map<String, Object> value) { details = new LinkedHashMap<>(Objects.requireNonNull(value, "details")); return this; }

    /**
     * @param seconds the API error's {@code Retry-After}, in whole seconds
     * @return these options
     * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for a negative value
     */
    public FailureOptions retryAfter(int seconds) {
      if (seconds < 0) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "retryAfter must be a whole number of seconds");
      retryAfter = seconds;
      return this;
    }
  }

  private record PendingFailure(String failure, String operation, Map<String, Object> details, Integer retryAfter) {}

  /**
   * Makes the next request fail without running, as if it never completed: {@code
   * "transport-error"} ({@link ErrorCodes#SDK_TRANSPORT_ERROR}), {@code "timeout"} ({@link
   * ErrorCodes#SDK_TIMEOUT}) or a public API error code, answered with its HTTP status and the
   * API's error body. Each queued failure fails exactly one request, so a client retry takes the
   * next queued failure or reaches the in-memory API.
   *
   * @param failure {@code transport-error}, {@code timeout} or an API error code
   */
  public void failNextRequest(String failure) { failNextRequest(failure, new FailureOptions()); }

  /**
   * Like {@link #failNextRequest(String)}, for the next request an operation sends (other requests
   * are answered meanwhile), or with an API error's details and {@code Retry-After}.
   *
   * @param failure {@code transport-error}, {@code timeout} or an API error code
   * @param options the operation, details and Retry-After
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for another failure, or
   *     details or Retry-After for a failure without a response
   */
  public synchronized void failNextRequest(String failure, FailureOptions options) {
    Objects.requireNonNull(options, "options");
    boolean network = "transport-error".equals(failure) || "timeout".equals(failure);
    if (!network && (failure == null || ErrorCodes.httpStatus(failure).isEmpty()))
      throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "failure must be transport-error, timeout or an API error code: " + failure);
    if (network && (options.details != null || options.retryAfter != null))
      throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "details and retryAfter need an API error code");
    failures.add(new PendingFailure(failure, options.operation, options.details, options.retryAfter));
  }

  /** A request as received, with the status of its response once there is one. */
  private static final class Recorded {
    final Request request;
    Integer status;

    Recorded(Request request) { this.request = request; }
  }

  private final Deque<Queued> responses = new ArrayDeque<>();
  private final List<PendingFailure> failures = new ArrayList<>();
  private final MockApi api;
  private final String projectId;
  private final List<Recorded> requests = new ArrayList<>();
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
   * builder and are validated the same way, except that retries are off unless the builder sets
   * {@code maxRetries}. Only the transport is replaced; the builder is unchanged.
   *
   * @param builder client options
   */
  public MockCalmLensServerClient(CalmLensServerClient.Builder builder) { this(builder, new Options()); }

  /**
   * @param builder client options
   * @param options outcome, ID and clock controls (copied)
   */
  public MockCalmLensServerClient(CalmLensServerClient.Builder builder, Options options) {
    // Unless the builder sets maxRetries, each queued failure or response answers one call.
    client = builder.build(this::send, delay -> skippedNanos.addAndGet(delay.toNanos()), () -> System.nanoTime() + skippedNanos.get(), 0);
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
   * ErrorCodes#httpStatus(String)}), the {@code {code, message, requestId, details}} body, the
   * same {@code X-Request-Id} and, for {@link ErrorCodes#IDEMPOTENT_REQUEST_IN_PROGRESS}, {@code Retry-After}.
   *
   * @param code a public API error code, such as {@link ErrorCodes#ASSET_NOT_FOUND}
   * @return this mock
   */
  public MockCalmLensServerClient enqueueError(String code) {
    int status = ErrorCodes.httpStatus(code).orElseThrow(() -> new IllegalArgumentException("Unknown API error code: " + code));
    JsonObject body = new JsonObject();
    body.addProperty("code", code);
    body.addProperty("message", "Mock " + code);
    String requestId = requestId();
    body.addProperty("requestId", requestId);
    body.add("details", new JsonObject());
    byte[] json = Json.write(body).getBytes(StandardCharsets.UTF_8);
    String retryAfter = ErrorCodes.IDEMPOTENT_REQUEST_IN_PROGRESS.equals(code) ? "1" : null;
    return add(null, null, new Transport.Response(status, headers("content-type", "application/json", "x-request-id", requestId, "retry-after", retryAfter), json), null);
  }

  /**
   * Queues one page of the events feed. {@code events} may be {@link Models.Event} records or maps.
   *
   * @param nextCursor the page's {@code nextCursor}
   * @param hasMore whether more events follow
   * @param events the events, oldest first
   * @return this mock
   */
  public MockCalmLensServerClient enqueueEvents(String nextCursor, boolean hasMore, Object... events) {
    Map<String, Object> page = new LinkedHashMap<>();
    page.put("items", List.of(events));
    page.put("nextCursor", Objects.requireNonNull(nextCursor, "nextCursor"));
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

  private JsonObject stored(String assetId) {
    try {
      return api.asset(assetId);
    } catch (MockApi.Failure missing) {
      Transport.Response response = MockApi.error(missing);
      throw new ApiException(missing.code, missing.getMessage(), missing.details, missing.status, response.headers(), null);
    }
  }

  /**
   * Gives an asset a reviewer's decision ({@code allowed}, {@code limited}, {@code
   * age-restricted}, {@code blocked} or {@code purged}): it records a manual review and adds the
   * matching {@code asset.<status>} event with the asset's snapshot, the event catalog's severity
   * ({@code low} for {@code allowed} and {@code limited}, {@code high} otherwise) and a {@code
   * decided-by: reviewer} fact. {@code purged} removes the content with reason {@code requested},
   * adding an {@code asset.content-removed} event first, as the API does. The moderation report
   * stays as the pipeline left it.
   *
   * @param assetId a stored asset
   * @param outcome the reviewer's decision
   * @return the asset
   * @throws ApiException {@link ErrorCodes#ASSET_NOT_FOUND} when the asset is not stored
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for {@code pending} or
   *     {@code failed}, which are not decisions
   */
  public synchronized Models.Asset decide(String assetId, Outcome outcome) {
    Objects.requireNonNull(outcome, "outcome");
    if (outcome == Outcome.PENDING || outcome == Outcome.FAILED)
      throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "decision must be allowed, limited, age-restricted, blocked or purged");
    JsonObject asset = stored(assetId);
    long now = api.now();
    api.applyOutcome(asset, outcome, "requested", now, null);
    JsonObject review = new JsonObject();
    review.addProperty("id", api.createId("rev"));
    review.addProperty("decision", outcome.value());
    review.add("note", null);
    review.addProperty("reviewedAt", now);
    review.addProperty("appliedToAsset", true);
    asset.getAsJsonObject("classification").getAsJsonObject("moderation").getAsJsonArray("manualReviews").add(review);
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
   * Finishes processing a pending asset as the moderation pipeline would, asking {@link
   * Options#moderate} for the decision with trigger {@link Trigger#COMPLETE}. It records the
   * pipeline's events ({@code asset.classified} and the automated {@code asset.<status>}, or
   * {@code asset.failed}) and no manual review.
   *
   * @param assetId a stored asset whose classification is {@code processing}
   * @return the asset
   * @throws ApiException {@link ErrorCodes#ASSET_NOT_FOUND} when the asset is not stored
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} when it isn't processing
   */
  public Models.Asset completeProcessing(String assetId) { return completeProcessing(assetId, null); }

  /**
   * Finishes processing a pending asset with {@code decision}, as the moderation pipeline would.
   *
   * @param assetId a stored asset whose classification is {@code processing}
   * @param decision the decision, or null to ask {@link Options#moderate}
   * @return the asset
   * @throws ApiException {@link ErrorCodes#ASSET_NOT_FOUND} when the asset is not stored
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} when it isn't processing
   */
  public synchronized Models.Asset completeProcessing(String assetId, MockDecision decision) {
    JsonObject asset = stored(assetId);
    if (!"processing".equals(MockApi.str(asset.getAsJsonObject("classification"), "status")))
      throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Asset " + assetId + " isn't processing");
    api.moderateStored(asset, Trigger.COMPLETE, decision);
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
    event.addProperty("type", Objects.requireNonNull(type, "type"));
    event.addProperty("severity", "low");
    event.addProperty("title", type);
    event.add("description", null);
    event.addProperty("assetId", assetId);
    JsonObject asset = assetId == null ? null : api.storage.assets.get(assetId);
    event.add("asset", asset == null ? null : MockApi.snapshot(asset));
    event.add("facts", MockApi.facts(java.util.Arrays.asList(facts)));
    event.addProperty("createdAt", now);
    api.storage.events.add(event);
    return Json.GSON.fromJson(event, Models.Event.class);
  }

  /**
   * Reads or changes the in-memory records while no request is being answered.
   *
   * @param change receives the storage
   */
  public synchronized void withStorage(Consumer<Storage> change) { change.accept(api.storage); }

  /** @return every request received so far (or since {@link #clearRequests}), with its response status */
  public synchronized List<Request> requests() { return requests.stream().map(r -> r.request.withStatus(r.status)).toList(); }

  /** Forgets the requests received so far. */
  public synchronized void clearRequests() { requests.clear(); }

  /** @return the number of queued responses not used yet */
  public synchronized int remainingResponses() { return responses.size(); }

  /** Closes {@link #client}. */
  @Override public void close() { client.close(); }

  private Transport.Response send(Transport.Request request) throws IOException, InterruptedException {
    Recorded recorded = new Recorded(capture(request));
    synchronized (this) {
      requests.add(recorded);
    }
    Transport.Response response = answer(recorded.request);
    synchronized (this) {
      recorded.status = response.status();
    }
    return response;
  }

  private Transport.Response answer(Request captured) throws IOException, InterruptedException {
    Queued next;
    synchronized (this) {
      Set<String> operations = api.operations(captured);
      for (int i = 0; i < failures.size(); i++) {
        PendingFailure pending = failures.get(i);
        if (pending.operation() != null && !operations.contains(pending.operation())) continue;
        failures.remove(i);
        if (pending.failure().equals("transport-error")) throw new java.net.ConnectException("Simulated network failure");
        if (pending.failure().equals("timeout")) throw new HttpTimeoutException("The operation timed out");
        Transport.Response failure = MockApi.error(MockApi.Failure.of(pending.failure(), pending.details()));
        if (pending.retryAfter() == null) return failure;
        Map<String, List<String>> headers = new LinkedHashMap<>(failure.headers());
        headers.put("Retry-After", List.of(pending.retryAfter().toString()));
        return new Transport.Response(failure.status(), headers, failure.body().readAllBytes());
      }
      if (!responses.isEmpty() && responses.peek().matches(captured.method(), captured.path())) next = responses.remove();
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

  private Request capture(Transport.Request request) throws IOException {
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
    return new Request(request.method(), uri.toString(), api.relativePath(uri.toString()), query, request.headers(), body, null);
  }
}
