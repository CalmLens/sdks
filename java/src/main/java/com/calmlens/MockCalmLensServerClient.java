package com.calmlens;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

/**
 * An offline client for tests. {@link #client} is a real {@link CalmLensServerClient} (validation,
 * encoding, retries, error mapping) whose transport answers from a queue you fill, and records
 * every request it receives. It does not classify content or keep state between requests.
 *
 * <pre>{@code
 * var mock = new MockCalmLensServerClient();
 * mock.enqueue(200, Map.of("id", "asset-1", "upload", Map.of("status", "completed"),
 *     "classification", Map.of("status", "completed",
 *     "moderation", Map.of("status", "allowed")), "content", Map.of("status", "removed")));
 * mock.enqueueError(ErrorCodes.ASSET_NOT_FOUND);            // HTTP 404 with the API's error body
 * mock.enqueue("GET", "/events", 200, Map.of("events", List.of(event), "cursor", "c1", "hasMore", false));
 * }</pre>
 *
 * <p>Like the real client, reads and uploads are retried on HTTP 429, 502, 503 and 504 and on
 * network failures (without waiting), so queue one response per attempt, or build the mock from a
 * builder with {@code maxRetries(0)}. A request with an empty queue, or whose next response is
 * bound to another route, fails with {@link ErrorCodes#SDK_TRANSPORT_ERROR}.
 *
 * <p>{@code assets.waitForDecision} retrieves the asset from the queue until a response's
 * {@code classification.moderation.status} is no longer {@code pending} or its classification failed. Its waits are skipped but still count towards its timeout, so a test of the timeout
 * finishes at once: queue one response per check.
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

  private final Deque<Queued> responses = new ArrayDeque<>();
  private final List<Request> requests = new ArrayList<>();
  /** Time the client spent in skipped waits; it moves the client's clock forward. */
  private final AtomicLong skippedNanos = new AtomicLong();
  /** The client under test. */
  public final CalmLensServerClient client;

  /** A mock for project {@code project-1} with unreachable base URLs. */
  public MockCalmLensServerClient() {
    this(CalmLensServerClient.builder("mock-key", "project-1").baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1"));
  }

  /**
   * A mock configured like a real client: project ID, base URLs, timeouts and retries come from the
   * builder and are validated the same way. Only the transport is replaced; the builder is unchanged.
   *
   * @param builder client options
   */
  public MockCalmLensServerClient(CalmLensServerClient.Builder builder) {
    client = builder.build(this::send, delay -> skippedNanos.addAndGet(delay.toNanos()), () -> System.nanoTime() + skippedNanos.get());
  }

  private static Map<String, List<String>> headers(Object... pairs) {
    Map<String, List<String>> headers = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) if (pairs[i + 1] != null) headers.put((String) pairs[i], List.of(pairs[i + 1].toString()));
    return headers;
  }

  private static String requestId() { return "req_mock_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12); }

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

  /** @return every request received so far */
  public synchronized List<Request> requests() { return List.copyOf(requests); }

  /** @return the number of queued responses not used yet */
  public synchronized int remainingResponses() { return responses.size(); }

  /** Closes {@link #client}. */
  @Override public void close() { client.close(); }

  private Transport.Response send(Transport.Request request) throws IOException, InterruptedException {
    Request captured = capture(request);
    Queued next;
    synchronized (this) {
      requests.add(captured);
      if (responses.isEmpty()) throw new IOException("No queued mock response for " + request.method() + " " + captured.path());
      if (!responses.peek().matches(request.method(), captured.path()))
        throw new IOException("The next queued mock response is for " + responses.peek().method() + " " + responses.peek().path()
            + ", not " + request.method() + " " + captured.path());
      next = responses.remove();
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
