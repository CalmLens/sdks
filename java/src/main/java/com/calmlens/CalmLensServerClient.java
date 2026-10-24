package com.calmlens;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Synchronous, thread-safe CalmLens client. Create one per API key and reuse it; close it when your
 * application shuts down.
 *
 * <pre>{@code
 * try (var client = CalmLensServerClient.builder(apiKey, projectId).build()) {
 *   Asset asset = client.text.classify("Hello world");
 *   if (asset.classification().moderation().status() == AssetModerationStatus.ALLOWED) publish();
 * }
 * }</pre>
 *
 * <p>Failures are {@link CalmLensException}s. Reads ({@code GET}) and uploads, which carry an
 * {@code Idempotency-Key}, are retried with jittered backoff on network failures, HTTP 429, 502,
 * 503 and 504 and {@link ErrorCodes#IDEMPOTENT_REQUEST_IN_PROGRESS}, honouring {@code Retry-After}.
 * Requests never follow redirects.
 */
public final class CalmLensServerClient implements AutoCloseable {
  /** This SDK's version, from its Maven manifest. */
  public static final String VERSION = loadVersion();
  /** The production API. */
  public static final String DEFAULT_BASE_URL = "https://api.calmlens.com/v1";
  /** The production CDN. */
  public static final String DEFAULT_CDN_BASE_URL = "https://cdn.calmlens.com/v1";

  /** Header carrying {@code v1=<hex>} HMAC-SHA256 signatures (comma-separated during secret rotation). */
  public static final String WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
  /** Header carrying the delivery's Unix timestamp in seconds, which is part of the signed content. */
  public static final String WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
  /** Header carrying the delivery ID; it stays the same across retries of one delivery. */
  public static final String WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
  /** Deliveries whose timestamp is further than this from the receiver's clock are rejected. */
  public static final long WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

  private static final long MULTIPART_MIN_PART_BYTES = 5L * 1024 * 1024;
  private static final Duration MAX_RETRY_AFTER = Duration.ofSeconds(60);
  private static final Pattern HEADER_NAME = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");
  private static final Set<String> RESTRICTED_HEADERS = Set.of("connection", "content-length", "expect", "host", "upgrade", "x-api-key");
  private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[\\x20-\\x7e]{1,255}");
  private static final long DECISION_POLL_FIRST_DELAY_NANOS = 500_000_000L;
  private static final long DECISION_POLL_MAX_DELAY_NANOS = 5_000_000_000L;
  private static final Duration DEFAULT_DECISION_TIMEOUT = Duration.ofSeconds(60);

  /** Asset uploads, moderation, listing and management. */
  public final Assets assets = new Assets();
  /** Text moderation. */
  public final Text text = new Text();
  /** Folders. */
  public final Folders folders = new Folders();
  /** Signs upload tokens for upload presets, locally. */
  public final UploadTokens uploadTokens = new UploadTokens();
  /** The events feed. */
  public final Events events = new Events();
  /** CDN URLs and downloads. */
  public final Cdn cdn = new Cdn();

  private final String apiKey, projectId, baseUrl, cdnBaseUrl, userAgent;
  private final Duration timeout, uploadTimeout;
  private final int maxRetries;
  private final long maxResponseBytes;
  private final Transport transport;
  private final HttpClient ownedHttpClient;
  private final Sleeper sleeper;
  private final LongSupplier nanoTime;
  private final AtomicBoolean closed = new AtomicBoolean();
  private final Map<String, Models.Lens> lenses = new ConcurrentHashMap<>();

  /** Waits between retries; replaced in mocks so tests do not sleep. */
  @FunctionalInterface
  interface Sleeper { void sleep(Duration delay) throws InterruptedException; }

  /**
   * A client for the production API with default options. Prefer {@link #builder(String, String)}.
   *
   * @param apiKey a project API key
   * @param projectId the project ID
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_CONFIG} for a missing key or project
   */
  public CalmLensServerClient(String apiKey, String projectId) { this(builder(apiKey, projectId), null, null, null); }

  private CalmLensServerClient(Builder options, Transport override, Sleeper sleeper, LongSupplier nanoTime) {
    // Validate every option before building anything.
    if (options.apiKey == null || options.apiKey.isBlank() || options.projectId == null || options.projectId.isBlank())
      throw config("API key and project ID are required");
    if (options.projectId.equals(".") || options.projectId.equals("..")) throw config("Project ID is invalid");
    positive("timeout", options.timeout, false);
    positive("connectTimeout", options.connectTimeout, false);
    positive("uploadTimeout", options.uploadTimeout, true);
    if (options.maxRetries < 0 || options.maxRetries > 10) throw config("maxRetries must be between 0 and 10");
    if (options.maxResponseBytes < 1024) throw config("maxResponseBytes must be at least 1024");
    this.baseUrl = baseUrl("baseUrl", options.baseUrl);
    this.cdnBaseUrl = baseUrl("cdnBaseUrl", options.cdnBaseUrl);
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.timeout = options.timeout;
    this.uploadTimeout = options.uploadTimeout;
    this.maxRetries = options.maxRetries;
    this.maxResponseBytes = options.maxResponseBytes;
    this.userAgent = "calmlens-java/" + VERSION + " (Java " + Runtime.version() + ")";
    this.sleeper = sleeper != null ? sleeper : delay -> Thread.sleep(delay.toMillis());
    this.nanoTime = nanoTime != null ? nanoTime : System::nanoTime;
    Transport custom = override != null ? override : options.transport;
    if (custom != null) {
      this.transport = custom;
      this.ownedHttpClient = null;
    } else {
      HttpClient http = options.httpClient;
      this.ownedHttpClient = http == null
          ? HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(options.connectTimeout).build()
          : null;
      this.transport = new HttpClientTransport(http != null ? http : ownedHttpClient);
    }
  }

  private static void positive(String name, Duration value, boolean optional) {
    if (value == null ? !optional : value.isZero() || value.isNegative()) throw config(name + " must be a positive duration");
  }

  private static CalmLensException config(String message) { return new CalmLensException(ErrorCodes.SDK_INVALID_CONFIG, message); }

  private static CalmLensException argument(String message) { return new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, message); }

  private static CalmLensException payloadError(String message) { return new CalmLensException(ErrorCodes.INVALID_UPLOAD_PAYLOAD, message); }

  private static String baseUrl(String option, String value) {
    URI uri;
    try { uri = value == null ? null : new URI(value); }
    catch (URISyntaxException cause) { throw new CalmLensException(ErrorCodes.SDK_INVALID_CONFIG, option + " must be an absolute http(s) URL", cause); }
    if (uri == null || uri.getHost() == null || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())))
      throw config(option + " must be an absolute http(s) URL");
    return value.replaceAll("/+$", "");
  }

  private static String loadVersion() {
    try (InputStream in = CalmLensServerClient.class.getResourceAsStream("sdk.properties")) {
      Properties properties = new Properties();
      if (in != null) properties.load(in);
      String version = properties.getProperty("version", "");
      return version.isEmpty() || version.startsWith("$") ? "0.0.0-dev" : version;
    } catch (IOException unreadable) {
      return "0.0.0-dev";
    }
  }

  /**
   * @param apiKey a project API key
   * @param projectId the project ID
   * @return a builder with production defaults
   */
  public static Builder builder(String apiKey, String projectId) { return new Builder(apiKey, projectId); }

  /** Client options. Every option is validated by {@link #build()}. */
  public static final class Builder {
    private final String apiKey, projectId;
    private String baseUrl = DEFAULT_BASE_URL, cdnBaseUrl = DEFAULT_CDN_BASE_URL;
    private Duration timeout = Duration.ofSeconds(60);
    private Duration connectTimeout = Duration.ofSeconds(10);
    private Duration uploadTimeout = Duration.ofMinutes(15);
    private int maxRetries = 2;
    private long maxResponseBytes = 32L * 1024 * 1024;
    private Transport transport;
    private HttpClient httpClient;

    private Builder(String apiKey, String projectId) { this.apiKey = apiKey; this.projectId = projectId; }

    /** @param value the API base URL, such as {@code http://localhost:6110/v1} @return this builder */
    public Builder baseUrl(String value) { baseUrl = value; return this; }

    /** @param value the CDN base URL @return this builder */
    public Builder cdnBaseUrl(String value) { cdnBaseUrl = value; return this; }

    /**
     * Time allowed for an API request to return its response (60 seconds by default), for reading a
     * response body, and between bytes of a CDN stream. Uploads use {@link #uploadTimeout(Duration)}.
     *
     * @param value a positive duration
     * @return this builder
     */
    public Builder timeout(Duration value) { timeout = value; return this; }

    /** @param value time allowed to open a connection (10 seconds by default) @return this builder */
    public Builder connectTimeout(Duration value) { connectTimeout = value; return this; }

    /**
     * Time allowed for an upload to be sent and answered (15 minutes by default), so large files
     * are not cut off by {@link #timeout(Duration)}. Null removes the limit. Override it per call
     * with {@link RequestOptions#timeout(Duration)}.
     *
     * @param value a positive duration, or null for no limit
     * @return this builder
     */
    public Builder uploadTimeout(Duration value) { uploadTimeout = value; return this; }

    /**
     * Automatic retries for reads and idempotent uploads (2 by default; 0 disables them).
     *
     * @param value 0 to 10
     * @return this builder
     */
    public Builder maxRetries(int value) { maxRetries = value; return this; }

    /** @param value the largest API response body read into memory (32 MiB by default) @return this builder */
    public Builder maxResponseBytes(long value) { maxResponseBytes = value; return this; }

    /**
     * Sends requests through {@code value} instead of the built-in {@link HttpClient}.
     *
     * @param value the transport
     * @return this builder
     */
    public Builder transport(Transport value) { transport = value; return this; }

    /**
     * Uses your own {@link HttpClient} (proxy, TLS, executor). The client does not close it. It
     * should not follow redirects.
     *
     * @param value the HTTP client
     * @return this builder
     */
    public Builder httpClient(HttpClient value) { httpClient = value; return this; }

    /**
     * @return a new client
     * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_CONFIG} for invalid options
     */
    public CalmLensServerClient build() { return new CalmLensServerClient(this, null, null, null); }

    /** Builds with this configuration but another transport, leaving this builder unchanged. */
    CalmLensServerClient build(Transport override, Sleeper sleeper) { return new CalmLensServerClient(this, override, sleeper, null); }

    /** Like {@link #build(Transport, Sleeper)}, measuring decision waits with {@code nanoTime}. */
    CalmLensServerClient build(Transport override, Sleeper sleeper, LongSupplier nanoTime) { return new CalmLensServerClient(this, override, sleeper, nanoTime); }

    @Override public String toString() {
      return "CalmLensServerClient.Builder[projectId=" + projectId + ", baseUrl=" + baseUrl + ", cdnBaseUrl=" + cdnBaseUrl + "]";
    }
  }

  /**
   * Stops the client: later calls fail with {@link ErrorCodes#SDK_CLIENT_CLOSED}. On Java 21 and
   * later this also closes the built-in {@link HttpClient}; an {@code httpClient} you supplied is
   * left open.
   */
  @Override public void close() {
    if (!closed.compareAndSet(false, true)) return;
    // HttpClient implements AutoCloseable from Java 21; on Java 17 it is released by garbage collection.
    if (ownedHttpClient instanceof AutoCloseable closeable) {
      try { closeable.close(); } catch (Exception ignored) { /* already closing */ }
    }
  }

  @Override public String toString() {
    return "CalmLensServerClient[projectId=" + projectId + ", baseUrl=" + baseUrl + ", cdnBaseUrl=" + cdnBaseUrl + "]";
  }

  // ------------------------------------------------------------------ Encoding helpers

  private static String str(JsonObject o, String key, String fallback) {
    return !o.has(key) || o.get(key).isJsonNull() ? fallback : o.get(key).getAsString();
  }

  private static boolean flag(JsonObject o, String key) { return o.has(key) && !o.get(key).isJsonNull() && o.get(key).getAsBoolean(); }

  private static JsonObject without(JsonObject o, String... keys) {
    JsonObject out = o.deepCopy();
    for (String key : keys) out.remove(key);
    return out;
  }

  /**
   * Encodes an identifier as one path segment. "." and ".." are rejected because URL resolution
   * treats them as relative segments, which would reach another route.
   */
  private static String id(String value) {
    if (value == null || value.isEmpty()) throw argument("Identifier is required");
    if (value.equals(".") || value.equals("..")) throw argument("Identifier cannot be \".\" or \"..\"");
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  /**
   * Encodes a CDN transform selector string like JavaScript's encodeURI, keeping its separators
   * and the literal {@code [} and {@code ]} the CDN matches.
   */
  private static String transformPath(String value) {
    String transform = value.replaceFirst("^/+", "");
    if (transform.contains("..") || transform.contains("?") || transform.contains("#"))
      throw argument("Transform cannot contain \"..\", \"?\" or \"#\"");
    StringBuilder out = new StringBuilder();
    for (byte b : transform.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xff;
      if (c < 0x80 && (Character.isLetterOrDigit(c) || "-_.!~*'();/:@&=+$,[]".indexOf(c) >= 0)) out.append((char) c);
      else out.append(String.format("%%%02X", c));
    }
    return out.toString();
  }

  private static final Pattern TRANSFORM_TYPE = Pattern.compile("^[A-Za-z0-9_]+$");

  /** The selector the API accepts: a string as given, or structured steps serialized. */
  private static String transformSelector(Object transform) {
    return transform == null || transform instanceof String ? (String) transform : serializeTransform(transform);
  }

  /**
   * Serializes structured transforms as a CDN selector, such as
   * {@code imageTransform[format=png,width=1024]}. Option keys are sorted so equal transforms share
   * a URL; nested keys ({@code border[color]}) and values are percent-encoded.
   */
  private static String serializeTransform(Object transform) {
    List<?> steps = transform instanceof List<?> list ? list : List.of(transform);
    if (steps.isEmpty()) throw argument("Transform needs at least one step");
    List<String> selectors = new ArrayList<>();
    for (Object item : steps) {
      if (!(item instanceof Models.Transform step)) throw argument("Transform steps must be transforms");
      if (step.type() == null || !TRANSFORM_TYPE.matcher(step.type()).matches())
        throw argument("Transform type must contain only letters, digits and underscores");
      Map<?, ?> options = transformOptions(step.options());
      List<String> pairs = new ArrayList<>();
      for (String key : sortedKeys(options)) appendTransformOption(pairs, key, options.get(key));
      selectors.add(step.type() + "[" + String.join(",", pairs) + "]");
    }
    return String.join(",", selectors);
  }

  /** Returns the options as nested maps of their wire values, or an empty map for none. */
  private static Map<?, ?> transformOptions(Models.ImageTransformOptions options) {
    if (options == null) return Map.of();
    try {
      return Json.GSON.fromJson(Json.GSON.toJsonTree(options), new TypeToken<Map<String, Object>>() {}.getType());
    } catch (IllegalArgumentException nonFinite) {
      throw argument("Transform numbers must be finite");
    }
  }

  private static List<String> sortedKeys(Map<?, ?> map) {
    List<String> keys = new ArrayList<>();
    for (Object key : map.keySet()) {
      if (!(key instanceof String text)) throw argument("Transform option keys must be strings");
      keys.add(text);
    }
    keys.sort(null);
    return keys;
  }

  private static void appendTransformOption(List<String> pairs, String key, Object value) {
    if (value == null) return;
    if (value instanceof Map<?, ?> map) {
      for (String child : sortedKeys(map)) appendTransformOption(pairs, key + "[" + child + "]", map.get(child));
      return;
    }
    String text;
    if (value instanceof String string) text = string;
    else if (value instanceof Boolean bool) text = bool.toString();
    else if (value instanceof Number number && finite(number)) text = jsNumber(number);
    else throw argument("Transform option \"" + key + "\" must be a string, number, boolean or map");
    pairs.add(encodeTransformComponent(key) + "=" + encodeTransformComponent(text));
  }

  private static boolean finite(Number number) {
    return !(number instanceof Double || number instanceof Float) || Double.isFinite(number.doubleValue());
  }

  /** Formats a number as JavaScript's {@code String(n)} does. */
  private static String jsNumber(Number number) {
    if (number instanceof Long || number instanceof Integer || number instanceof Short || number instanceof Byte
        || number instanceof java.math.BigInteger) return number.toString();
    double value = number.doubleValue();
    if (!Double.isFinite(value)) throw argument("Transform numbers must be finite");
    if (value == 0) return "0";
    java.math.BigDecimal decimal = new java.math.BigDecimal(Double.toString(Math.abs(value))).stripTrailingZeros();
    String digits = decimal.unscaledValue().toString();
    int k = digits.length();
    int n = k - decimal.scale();
    StringBuilder out = new StringBuilder(value < 0 ? "-" : "");
    if (k <= n && n <= 21) out.append(digits).append("0".repeat(n - k));
    else if (0 < n && n <= 21) out.append(digits, 0, n).append('.').append(digits, n, k);
    else if (-6 < n && n <= 0) out.append("0.").append("0".repeat(-n)).append(digits);
    else {
      out.append(digits.charAt(0));
      if (k > 1) out.append('.').append(digits, 1, k);
      out.append('e').append(n - 1 >= 0 ? "+" : "-").append(Math.abs(n - 1));
    }
    return out.toString();
  }

  /** Percent-encodes UTF-8 bytes except RFC 3986 unreserved characters ({@code A-Z a-z 0-9 - . _ ~}). */
  private static String encodeTransformComponent(String value) {
    StringBuilder out = new StringBuilder();
    for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xff;
      if (c < 0x80 && (Character.isLetterOrDigit(c) || "-._~".indexOf(c) >= 0)) out.append((char) c);
      else out.append(String.format("%%%02X", c));
    }
    return out.toString();
  }

  private String project(String path) { return "/projects/" + id(projectId) + "/" + path; }

  private static String query(JsonObject query) {
    List<String> params = new ArrayList<>();
    if (query != null)
      for (var entry : query.entrySet()) {
        JsonElement value = entry.getValue();
        if (value.isJsonNull()) continue;
        if (entry.getKey().equals("ordering") && value.isJsonArray()) {
          int index = 0;
          for (JsonElement order : value.getAsJsonArray()) {
            for (var field : order.getAsJsonObject().entrySet())
              params.add(id("ordering[" + index + "][" + field.getKey() + "]") + "=" + id(field.getValue().getAsString()));
            index++;
          }
        } else if (entry.getKey().equals("ids") && value.isJsonArray()) {
          int index = 0;
          for (JsonElement folderId : value.getAsJsonArray()) params.add(id("ids[" + index++ + "]") + "=" + id(folderId.getAsString()));
        } else
          params.add(id(entry.getKey()) + "=" + URLEncoder.encode(
              value.isJsonPrimitive() && value.getAsJsonPrimitive().isString() ? value.getAsString() : Json.write(value),
              StandardCharsets.UTF_8));
      }
    return params.isEmpty() ? "" : "?" + String.join("&", params);
  }

  /** Header names must be tokens and values must not contain line breaks or control characters. */
  private static void header(Map<String, String> headers, String name, String value) {
    if (name == null || !HEADER_NAME.matcher(name).matches()) throw argument("Invalid header name");
    if (RESTRICTED_HEADERS.contains(name.toLowerCase(Locale.ROOT))) throw argument("Header " + name + " cannot be set");
    if (value == null) throw argument("Header " + name + " needs a value");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (c != '\t' && (c < 0x20 || c == 0x7f)) throw argument("Header " + name + " contains a control character");
    }
    headers.put(name, value);
  }

  private String idempotencyKey(RequestOptions options) {
    String key = options == null ? null : options.idempotencyKeyValue();
    if (key == null) return UUID.randomUUID().toString();
    if (!IDEMPOTENCY_KEY.matcher(key).matches()) throw argument("Idempotency keys are 1 to 255 printable ASCII characters");
    return key;
  }

  private Duration uploadTimeout(RequestOptions options) {
    Duration override = options == null ? null : options.timeoutValue();
    if (override != null && (override.isZero() || override.isNegative())) throw argument("timeout must be a positive duration");
    return override != null ? override : uploadTimeout;
  }

  // ------------------------------------------------------------------ Requests, retries and errors

  private record Call(String method, String url, Map<String, String> headers, Transport.Body body, Duration timeout, boolean retryable) {}

  /** A response whose body has been read. */
  private record Reply(int status, Map<String, List<String>> headers, byte[] body, JsonElement json) {}

  private void ensureOpen() {
    if (closed.get()) throw new CalmLensException(ErrorCodes.SDK_CLIENT_CLOSED, "The client is closed");
  }

  private Map<String, String> baseHeaders(String accept) {
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("X-Api-Key", apiKey);
    headers.put("User-Agent", userAgent);
    headers.put("Accept", accept);
    return headers;
  }

  private boolean canRetry(Call call, int attempt) {
    return attempt < maxRetries && call.retryable() && (call.body() == null || call.body().replayable());
  }

  private void backoff(int attempt, Duration retryAfter) {
    Duration delay = retryAfter;
    if (delay == null) {
      long cap = Math.min(8000, 500L << Math.min(attempt, 4));
      delay = Duration.ofMillis(cap / 2 + ThreadLocalRandom.current().nextLong(cap / 2 + 1));
    }
    try {
      sleeper.sleep(delay);
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting to retry", interrupted);
    }
  }

  private Transport.Response send(Call call) {
    ensureOpen();
    try {
      Transport.Response response = transport.send(new Transport.Request(call.method(), URI.create(call.url()), call.headers(), call.body(), call.timeout()));
      if (response == null) throw new TransportException(ErrorCodes.SDK_TRANSPORT_ERROR, "Transport returned no response", null);
      return response;
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Request interrupted", interrupted);
    } catch (CalmLensException failure) {
      throw failure;
    } catch (IOException | RuntimeException failure) {
      throw transportError(failure);
    }
  }

  static TransportException transportError(Throwable failure) {
    Throwable classify = failure instanceof UncheckedIOException unchecked && unchecked.getCause() != null ? unchecked.getCause() : failure;
    String message = failure.getMessage() == null ? failure.getClass().getName() : failure.getMessage();
    boolean timedOut = classify instanceof HttpTimeoutException || classify instanceof SocketTimeoutException;
    return timedOut ? new RequestTimeoutException(message, failure) : new TransportException(ErrorCodes.SDK_TRANSPORT_ERROR, message, failure);
  }

  private static boolean retryableStatus(int status) { return status == 429 || status == 502 || status == 503 || status == 504; }

  /** Sends a JSON API request, retrying when allowed, and reads its body within the limits. */
  private Reply execute(Call call) {
    for (int attempt = 0; ; attempt++) {
      Transport.Response response;
      byte[] body;
      try {
        response = send(call);
        try (response) {
          body = Timeouts.readAll(response.body(), maxResponseBytes, timeout);
        } catch (IOException failure) {
          throw transportError(failure);
        }
      } catch (TransportException failure) {
        if (canRetry(call, attempt)) { backoff(attempt, null); continue; }
        throw failure;
      }
      if (body == null)
        throw new ApiException(ErrorCodes.SDK_RESPONSE_TOO_LARGE, "Response is larger than " + maxResponseBytes + " bytes",
            null, response.status(), response.headers(), null);
      Reply reply = parse(response, body);
      boolean inProgress = reply.status() == 409 && ErrorCodes.IDEMPOTENT_REQUEST_IN_PROGRESS.equals(errorCode(reply.json()));
      if ((retryableStatus(reply.status()) || inProgress) && canRetry(call, attempt)) {
        Duration retryAfter = ApiException.retryAfter(response.header("retry-after"));
        if (retryAfter == null || retryAfter.compareTo(MAX_RETRY_AFTER) <= 0) {
          backoff(attempt, retryAfter);
          continue;
        }
      }
      return reply;
    }
  }

  private static String errorCode(JsonElement json) {
    return json != null && json.isJsonObject() && json.getAsJsonObject().has("code") && json.getAsJsonObject().get("code").isJsonPrimitive()
        ? json.getAsJsonObject().get("code").getAsString() : null;
  }

  private static Reply parse(Transport.Response response, byte[] body) {
    JsonElement json = null;
    JsonParseException invalid = null;
    try {
      json = body.length == 0 ? JsonNull.INSTANCE : Json.GSON.fromJson(new String(body, StandardCharsets.UTF_8), JsonElement.class);
    } catch (JsonParseException failure) {
      invalid = failure;
    }
    if (response.status() >= 200 && response.status() < 300 && invalid != null)
      throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Invalid JSON response (HTTP " + response.status() + ")", null, response.status(), response.headers(), invalid);
    return new Reply(response.status(), response.headers(), body, json);
  }

  /** Throws the API error for a failed reply and returns the JSON body of a successful one. */
  private static JsonElement success(Reply reply) {
    if (reply.status() >= 200 && reply.status() < 300) return reply.json();
    String code = errorCode(reply.json());
    if (code != null) {
      JsonObject failure = reply.json().getAsJsonObject();
      Map<String, Object> details = new LinkedHashMap<>();
      if (failure.has("details") && failure.get("details").isJsonObject())
        details.putAll(Json.GSON.fromJson(failure.get("details"), new TypeToken<Map<String, Object>>() {}.getType()));
      details.put("network", true);
      if (failure.has("traceId") && failure.get("traceId").isJsonPrimitive()) details.put("traceId", failure.get("traceId").getAsString());
      throw new ApiException(code, str(failure, "message", null), details, reply.status(), reply.headers(), null);
    }
    throw new ApiException(ErrorCodes.SDK_HTTP_ERROR, "HTTP " + reply.status(), Map.of("network", true), reply.status(), reply.headers(), null);
  }

  private Reply json(String method, String path, JsonObject query, JsonElement body) {
    Map<String, String> headers = baseHeaders("application/json");
    Transport.Body payload = null;
    if (body != null) {
      headers.put("Content-Type", "application/json");
      payload = Transport.Body.ofBytes(Json.write(body).getBytes(StandardCharsets.UTF_8));
    }
    boolean retryable = method.equals("GET") || method.equals("HEAD");
    return execute(new Call(method, baseUrl + path + query(query), headers, payload, timeout, retryable));
  }

  private <T> T decode(Reply reply, Class<T> type) {
    JsonElement value = success(reply);
    try {
      T result = value == null || value.isJsonNull() || (!type.isArray() && !value.isJsonObject()) || (type.isArray() && !value.isJsonArray())
          ? null : Json.GSON.fromJson(value, type);
      if (result == null) throw new JsonParseException("Expected a JSON " + (type.isArray() ? "array" : "object"));
      if (result instanceof Models.Asset asset && (asset.id() == null || asset.id().isEmpty()
          || asset.upload() == null || asset.upload().status() == null || asset.classification() == null || asset.classification().status() == null || asset.classification().moderation() == null || asset.classification().moderation().status() == null))
        throw new JsonParseException("Expected an asset with an id, a classification status and a moderation status");
      return result;
    } catch (JsonParseException | IllegalStateException | IllegalArgumentException | NullPointerException cause) {
      throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Invalid response model: " + cause.getMessage(), null, reply.status(), reply.headers(), cause);
    }
  }

  private static JsonObject object(Reply reply) {
    JsonElement value = success(reply);
    if (value == null || !value.isJsonObject())
      throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Expected a JSON object response", null, reply.status(), reply.headers(), null);
    return value.getAsJsonObject();
  }

  // ------------------------------------------------------------------ Uploads

  private static void imageSize(long size, boolean last) {
    if (size > 20L * 1024 * 1024) throw new CalmLensException(ErrorCodes.MULTIPART_IMAGE_TOO_LARGE, null);
    if (last && size < 10L * 1024 * 1024) throw new CalmLensException(ErrorCodes.MULTIPART_IMAGE_TOO_SMALL, null);
  }

  /** The request body for upload content: exactly one source, sent without copying files or streams. */
  private static Transport.Body payload(Models.Content content, JsonObject encoded, boolean multipart) {
    List<String> sources = new ArrayList<>();
    for (String key : List.of("plainText", "base64", "bytes")) if (encoded.has(key) && !encoded.get(key).isJsonNull()) sources.add(key);
    if (content != null && content.data != null) sources.add("data");
    if (content != null && content.file != null) sources.add("file");
    if (content != null && content.stream != null) sources.add("stream");
    if (sources.size() != 1) throw payloadError("Supply exactly one payload representation");
    Long declared = encoded.has("sizeInBytes") && !encoded.get("sizeInBytes").isJsonNull() ? encoded.get("sizeInBytes").getAsLong() : null;
    Transport.Body body;
    switch (sources.get(0)) {
      case "plainText" -> body = Transport.Body.ofBytes(encoded.get("plainText").getAsString().getBytes(StandardCharsets.UTF_8));
      case "bytes" -> {
        JsonArray values = encoded.getAsJsonArray("bytes");
        byte[] data = new byte[values.size()];
        for (int i = 0; i < data.length; i++) {
          int b;
          try { b = values.get(i).getAsBigDecimal().intValueExact(); }
          catch (ArithmeticException | NumberFormatException | UnsupportedOperationException e) { throw new CalmLensException(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Expected integer bytes", e); }
          if (b < 0 || b > 255) throw payloadError("Expected bytes between 0 and 255");
          data[i] = (byte) b;
        }
        body = Transport.Body.ofBytes(data);
      }
      case "base64" -> {
        String text = encoded.get("base64").getAsString().replaceFirst("^.*;base64,", "").replaceAll("\\s", "");
        if (multipart && text.length() % 4 != 0) throw payloadError("Split bytes before base64-encoding each part");
        try { body = Transport.Body.ofBytes(Base64.getDecoder().decode(text)); }
        catch (IllegalArgumentException e) { throw new CalmLensException(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Invalid base64", e); }
      }
      case "data" -> body = Transport.Body.ofBytes(content.data);
      case "file" -> {
        try {
          if (!Files.isRegularFile(content.file)) throw argument("Content file must be a readable regular file");
          body = Transport.Body.ofFile(content.file, Files.size(content.file));
        } catch (IOException e) { throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Content file cannot be read", e); }
      }
      default -> {
        if (declared == null || declared < 0) throw argument("Streamed content needs its exact sizeInBytes");
        body = Transport.Body.ofStream(content.stream, declared);
      }
    }
    if (declared != null && declared != body.length()) throw payloadError("sizeInBytes must match the payload byte length");
    if (multipart && !flag(encoded, "isFinal") && body.length() < MULTIPART_MIN_PART_BYTES)
      throw payloadError("Multipart upload parts must be at least 5MiB except the final part.");
    return body;
  }

  private Reply upload(String path, JsonObject query, Transport.Body body, String contentType, String mode, RequestOptions options) {
    Map<String, String> headers = baseHeaders("application/json");
    headers.put("Content-Type", contentType);
    headers.put("X-CalmLens-Upload", mode);
    headers.put("Idempotency-Key", idempotencyKey(options));
    return execute(new Call("POST", baseUrl + path + query(query), headers, body, uploadTimeout(options), true));
  }

  private Models.Asset submit(Models.SubmitAsset options, boolean queue, RequestOptions requestOptions) {
    JsonObject o = Models.encode(options);
    if (str(o, "name", "").isEmpty()) throw payloadError("Asset name is required");
    if (List.of("content", "part", "url").stream().filter(key -> o.has(key) && !o.get(key).isJsonNull()).count() != 1)
      throw payloadError("Supply exactly one of content, part, or url");
    JsonObject query = new JsonObject();
    query.addProperty("queue", queue);
    if (o.has("url")) {
      Map<String, String> headers = baseHeaders("application/json");
      headers.put("Content-Type", "application/json");
      headers.put("Idempotency-Key", idempotencyKey(requestOptions));
      Transport.Body body = Transport.Body.ofBytes(Json.write(o).getBytes(StandardCharsets.UTF_8));
      return decode(execute(new Call("POST", baseUrl + project("assets") + query(query), headers, body, timeout, true)), Models.Asset.class);
    }
    boolean multipart = o.has("part");
    Models.Content content = multipart ? options.partValue() : options.contentValue();
    JsonObject encoded = o.getAsJsonObject(multipart ? "part" : "content");
    String type = str(encoded, "type", "");
    String mime = type.split(";", -1)[0].strip().toLowerCase(Locale.ROOT);
    if (mime.isEmpty() || mime.equals("application/octet-stream") || mime.startsWith("multipart/"))
      throw new CalmLensException(ErrorCodes.INVALID_UPLOAD_MIME_TYPE, mime
          + " is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process,"
          + " such as image/png, image/jpeg, application/pdf, or text/plain.");
    if (multipart && encoded.has("partNumber") && encoded.get("partNumber").getAsInt() != 1)
      throw new CalmLensException(ErrorCodes.USE_UPLOAD_PART, "Use uploadPart for multipart upload parts after the first part");
    Transport.Body body = payload(content, encoded, multipart);
    if (multipart && mime.startsWith("image/")) imageSize(body.length(), flag(encoded, "isFinal"));
    for (String key : List.of("name", "description", "processingOptions", "visibility", "metadata", "externalId", "externalUrl", "folderId", "uploadPresetId", "totalSizeInBytes"))
      if (o.has(key)) query.add(key, o.get(key));
    query.addProperty("contentType", type);
    query.addProperty("sizeInBytes", body.length());
    if (multipart) {
      query.addProperty("partNumber", 1);
      query.addProperty("isFinal", flag(encoded, "isFinal"));
    }
    return decode(upload(project("assets"), query, body, type, multipart ? "part" : "content", requestOptions), Models.Asset.class);
  }

  // ------------------------------------------------------------------ Resources

  private AutoPager<Models.Asset> pages(String path, JsonObject options) {
    String first = options.has("cursor") && !options.get("cursor").isJsonNull() ? options.get("cursor").getAsString() : null;
    return new AutoPager<>(token -> {
      JsonObject query = options.deepCopy();
      if (token != null) query.addProperty("cursor", token);
      Models.AssetPage page = decode(json("GET", path, query, null), Models.AssetPage.class);
      boolean more = page.hasMore() && page.nextCursor() != null && !page.items().isEmpty();
      return new AutoPager.Chunk<>(page.items(), more ? page.nextCursor() : null, more);
    }, first);
  }

  /** Assets: uploads, moderation, listing and management. */
  public final class Assets {
    private Assets() {}

    /**
     * Uploads an asset and queues it for processing; it returns while its {@code classification.status}
     * is {@code processing} ({@code uploading} for the first part of a multipart upload). The
     * upload carries an {@code Idempotency-Key}, so it is retried safely.
     *
     * @param options name and content, part or url
     * @return the new asset
     */
    public Models.Asset create(Models.SubmitAsset options) { return submit(options, true, null); }

    /**
     * @param options name and content, part or url
     * @param requestOptions idempotency key and timeout for this call
     * @return the new asset
     */
    public Models.Asset create(Models.SubmitAsset options, RequestOptions requestOptions) { return submit(options, true, requestOptions); }

    /**
     * Uploads bytes and queues them for processing.
     *
     * @param name asset name
     * @param bytes content
     * @param mimeType MIME type, such as {@code image/png}
     * @return the new asset
     */
    public Models.Asset create(String name, byte[] bytes, String mimeType) { return create(new Models.SubmitAsset(name, Models.Content.bytes(bytes, mimeType))); }

    /**
     * Uploads an asset and waits for classification.
     *
     * @param options name and content, part or url
     * @return the classified asset
     */
    public Models.Asset classify(Models.SubmitAsset options) { return classify(options, null); }

    /**
     * @param options name and content, part or url
     * @param requestOptions idempotency key and timeout for this call
     * @return the classified asset
     */
    public Models.Asset classify(Models.SubmitAsset options, RequestOptions requestOptions) {
      if (options != null) {
        JsonObject o = Models.encode(options);
        if (o.has("content") && o.getAsJsonObject("content").has("plainText") && str(o.getAsJsonObject("content"), "plainText", "").isBlank())
          throw payloadError("Text to classify must be a non-empty string");
      }
      return submit(options, false, requestOptions);
    }

    /** @param options search query @return matches, best first */
    public Models.AssetSearchResponse search(Models.SearchAssets options) {
      return decode(json("GET", project("assets/search"), Models.encode(options), null), Models.AssetSearchResponse.class);
    }

    /** @param options page and filter @return one page of assets */
    public Models.AssetPage list(Models.ListAssets options) {
      JsonObject query = new JsonObject();
      Models.encode(options).entrySet().forEach(entry -> query.add(entry.getKey(), entry.getValue()));
      return decode(json("GET", project("assets/page"), query, null), Models.AssetPage.class);
    }

    /**
     * Iterates over every matching asset, page by page, from the supplied cursor.
     *
     * @param options page size, filter and ordering
     * @return a lazy iterable
     */
    public AutoPager<Models.Asset> iterate(Models.ListAssets options) { return pages(project("assets/page"), Models.encode(options)); }

    /** @param options the asset @return the asset */
    public Models.Asset retrieve(Models.AssetId options) {
      return decode(json("GET", "/assets/" + id(str(Models.encode(options), "assetId", null)), null, null), Models.Asset.class);
    }

    /**
     * Retrieves the asset until its {@code classification.moderation.status} is no longer {@code
     * pending} ({@code allowed}, {@code age-restricted}, {@code blocked} or {@code purged}), or its
     * {@code classification.status} is {@code failed}, and returns it. It waits 0.5 seconds before the second check and 1.5 times
     * longer each time after that, up to 5 seconds, never past the timeout (60 seconds by default).
     * Webhooks report decisions without polling.
     *
     * @param options the asset and timeout
     * @return the decided asset
     * @throws CalmLensException {@link ErrorCodes#SDK_TIMEOUT} when the timeout passes without a
     *     decision, with {@code assetId} and the last {@code classificationStatus} and {@code
     *     moderationStatus} in its details; {@link
     *     ErrorCodes#SDK_CANCELLED} when the thread is interrupted (the interrupt flag is kept)
     */
    public Models.Asset waitForDecision(Models.WaitForDecision options) {
      String assetId = str(Models.encode(options), "assetId", null);
      id(assetId);
      Duration limit = options.timeoutValue() == null ? DEFAULT_DECISION_TIMEOUT : options.timeoutValue();
      if (limit.isNegative()) throw argument("timeout must not be negative");
      long limitNanos;
      try { limitNanos = limit.toNanos(); } catch (ArithmeticException tooLong) { limitNanos = Long.MAX_VALUE; }
      long started = nanoTime.getAsLong();
      long delay = DECISION_POLL_FIRST_DELAY_NANOS;
      for (;;) {
        if (Thread.currentThread().isInterrupted())
          throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for a decision");
        Models.Asset asset = retrieve(new Models.AssetId(assetId));
        if (isDecided(asset)) return asset;
        long remaining = limitNanos - (nanoTime.getAsLong() - started);
        if (remaining <= 0) {
          String processing = asset.classification().status().value(), moderation = asset.classification().moderation().status().value();
          Map<String, Object> details = new LinkedHashMap<>();
          details.put("assetId", asset.id());
          details.put("classificationStatus", processing);
          details.put("moderationStatus", moderation);
          throw new CalmLensException(ErrorCodes.SDK_TIMEOUT, "Asset " + asset.id() + " had no moderation decision after "
              + limit.toMillis() + "ms (processing " + processing + ", moderation " + moderation + ")", details, null);
        }
        try {
          sleeper.sleep(Duration.ofNanos(Math.min(delay, remaining)));
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for a decision", interrupted);
        }
        delay = Math.min(DECISION_POLL_MAX_DELAY_NANOS, delay + delay / 2);
      }
    }

    private static boolean isDecided(Models.Asset asset) {
      return !Models.AssetModerationStatus.PENDING.equals(asset.classification().moderation().status())
          || asset.classification().status() == Models.AssetClassificationStatus.FAILED;
    }

    /** @param options the asset and the fields to change @return the updated asset */
    public Models.Asset update(Models.UpdateAsset options) {
      JsonObject o = Models.encode(options);
      return decode(json("PATCH", "/assets/" + id(str(o, "assetId", null)), null, without(o, "assetId")), Models.Asset.class);
    }

    /**
     * Processes an asset whose {@code classification.status} is {@code failed} again; its moderation
     * returns to {@code pending}. Its content must still be held.
     *
     * @param options the asset
     * @return the asset, processing again
     */
    public Models.Asset retry(Models.AssetId options) {
      return decode(json("POST", "/assets/" + id(str(Models.encode(options), "assetId", null)) + "/retry", null, null), Models.Asset.class);
    }

    /**
     * Removes the asset's stored content (the CDN stops serving it); the record and report stay,
     * with {@code content.status} {@code removed} and {@code content.removalReason} {@code requested}.
     *
     * @param options the asset
     * @return the asset
     */
    public Models.Asset deleteContent(Models.AssetId options) {
      return decode(json("DELETE", "/assets/" + id(str(Models.encode(options), "assetId", null)) + "/content", null, null), Models.Asset.class);
    }

    /** Permanently deletes the asset record, its report and its stored content. @param options the asset */
    public void delete(Models.AssetId options) {
      success(json("DELETE", "/assets/" + id(str(Models.encode(options), "assetId", null)), null, null));
    }

    /** @param options the asset and target folder (null for the root) @return the moved asset */
    public Models.Asset move(Models.MoveAsset options) {
      JsonObject o = Models.encode(options);
      JsonObject body = new JsonObject();
      body.addProperty("folderId", options.folderIdValue());
      return decode(json("POST", "/assets/" + id(str(o, "assetId", null)) + "/move", null, body), Models.Asset.class);
    }

    /** @param options the parent asset and page @return one page of child assets, such as images extracted from documents */
    public Models.AssetPage listChildren(Models.ListChildren options) {
      JsonObject o = Models.encode(options);
      JsonObject query = new JsonObject();
      without(o, "assetId").entrySet().forEach(entry -> query.add(entry.getKey(), entry.getValue()));
      return decode(json("GET", "/assets/" + id(str(o, "assetId", null)) + "/children", query, null), Models.AssetPage.class);
    }

    /** @param options the parent asset, page size and filter @return a lazy iterable over every child */
    public AutoPager<Models.Asset> iterateChildren(Models.ListChildren options) {
      JsonObject o = Models.encode(options);
      return pages("/assets/" + id(str(o, "assetId", null)) + "/children", without(o, "assetId"));
    }

    /**
     * Sends a later part of a multipart upload. The queue choice saved when the upload started
     * applies unless {@link Models.UploadPart#queue(Boolean)} overrides it.
     *
     * @param options the asset and the part
     * @return the asset; its {@code classification.status} is {@code uploading} until the final part
     */
    public Models.Asset uploadPart(Models.UploadPart options) { return uploadPart(options, null); }

    /**
     * @param options the asset and the part
     * @param requestOptions idempotency key and timeout for this call
     * @return the asset
     */
    public Models.Asset uploadPart(Models.UploadPart options, RequestOptions requestOptions) {
      JsonObject o = Models.encode(options);
      String path = "/assets/" + id(str(o, "assetId", null)) + "/part";
      if (!o.has("part")) throw payloadError("A part is required");
      JsonObject part = o.getAsJsonObject("part");
      if (!part.has("partNumber") || part.get("partNumber").getAsInt() < 1)
        throw new CalmLensException(ErrorCodes.INVALID_UPLOAD_PART_NUMBER, null);
      Transport.Body body = payload(options.partValue(), part, true);
      JsonObject query = new JsonObject();
      if (o.has("queue")) query.add("queue", o.get("queue"));
      query.add("partNumber", part.get("partNumber"));
      query.addProperty("isFinal", flag(part, "isFinal"));
      query.addProperty("sizeInBytes", body.length());
      return decode(upload(path, query, body, "application/octet-stream", "part", requestOptions), Models.Asset.class);
    }

    /**
     * Creates a short-lived signed CDN URL for a private asset.
     *
     * @param options the asset, resource, lens or transform and expiry
     * @return the URL
     */
    public Models.SignedUrl createSignedUrl(Models.SignedUrlOptions options) {
      JsonObject o = Models.encode(options);
      JsonObject body = JsonParser.parseString("{\"resource\":\"content\",\"expiresInSeconds\":900}").getAsJsonObject();
      without(o, "assetId").entrySet().forEach(entry -> body.add(entry.getKey(), entry.getValue()));
      String transform = transformSelector(options.transformValue());
      if (transform != null) body.addProperty("transform", transform);
      return decode(json("POST", "/assets/" + id(str(o, "assetId", null)) + "/signed-url", null, body), Models.SignedUrl.class);
    }
  }

  /** Text moderation. */
  public final class Text {
    private Text() {}

    /**
     * Moderates text and waits for the decision.
     *
     * @param text the text
     * @return the classified text asset
     */
    public Models.Asset classify(String text) { return classify(new Models.ClassifyText(text)); }

    /** @param options the text, name and metadata @return the classified text asset */
    public Models.Asset classify(Models.ClassifyText options) { return classify(options, null); }

    /**
     * @param options the text, name and metadata
     * @param requestOptions idempotency key and timeout for this call
     * @return the classified text asset
     */
    public Models.Asset classify(Models.ClassifyText options, RequestOptions requestOptions) {
      if (options == null || options.textValue() == null || options.textValue().isBlank())
        throw payloadError("Text to classify must be a non-empty string");
      return assets.classify(options.toSubmitAsset(), requestOptions);
    }
  }

  /** {@code client.uploadTokens}: tokens that let a browser upload through an upload preset. */
  public final class UploadTokens {
    private UploadTokens() {}

    /**
     * Signs a single-use upload token with this client's API key. Makes no request.
     *
     * @param options the preset, optional external ID and lifetime (1 to 3600 seconds, default 600)
     * @return the token and when it expires
     */
    public Models.SignedUploadToken sign(Models.SignUploadToken options) {
      if (options == null) throw argument("Options are required");
      String presetId = options.uploadPresetIdValue();
      id(presetId);
      int ttl = options.expiresInSecondsValue() == null ? 600 : options.expiresInSecondsValue();
      if (ttl < 1 || ttl > 3600) throw argument("expiresInSeconds must be a whole number from 1 to 3600");
      String externalId = options.externalIdValue();
      if (externalId != null && externalId.isEmpty()) throw argument("externalId must be a non-empty string");
      long expiresAt = System.currentTimeMillis() + ttl * 1000L;
      JsonObject claims = new JsonObject();
      claims.addProperty("v", 1);
      claims.addProperty("u", presetId);
      claims.addProperty("k", apiKey.substring(0, Math.min(apiKey.length(), apiKey.startsWith("clsk_") ? 13 : 8)));
      claims.addProperty("e", expiresAt);
      claims.addProperty("n", UUID.randomUUID().toString());
      if (externalId != null) claims.addProperty("x", externalId);
      String body = Base64.getUrlEncoder().withoutPadding().encodeToString(claims.toString().getBytes(StandardCharsets.UTF_8));
      try {
        String secret = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(apiKey.getBytes(StandardCharsets.UTF_8)));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String signature = HexFormat.of().formatHex(mac.doFinal(("calmlens-upload-token:v1:" + body).getBytes(StandardCharsets.UTF_8)));
        return new Models.SignedUploadToken("clut_" + body + "." + signature, expiresAt);
      } catch (GeneralSecurityException e) {
        throw new IllegalStateException(e);
      }
    }
  }

  /** Folders. */
  public final class Folders {
    private Folders() {}

    /** @return one child-folder page */
    public Models.FolderPage list(Models.ListFolders options) {
      Reply reply = json("GET", project("folders"), Models.encode(options), null);
      JsonObject page = object(reply);
      if (!page.has("folders") || !page.get("folders").isJsonArray() || !page.has("ancestors") || !page.get("ancestors").isJsonArray() || !page.has("hasMore") || !page.get("hasMore").isJsonPrimitive() || !page.get("hasMore").getAsJsonPrimitive().isBoolean())
        throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Expected a folder page", null, reply.status(), reply.headers(), null);
      return decode(reply, Models.FolderPage.class);
    }

    /** @param options the folder @return the folder */
    public Models.Folder retrieve(Models.FolderId options) {
      return decode(json("GET", "/folders/" + id(str(Models.encode(options), "folderId", null)), null, null), Models.Folder.class);
    }

    /** @param options name, parent and description @return the new folder */
    public Models.Folder create(Models.CreateFolder options) {
      return decode(json("POST", project("folders"), null, Models.encode(options)), Models.Folder.class);
    }

    /** @param options the folder and fields to change @return the folder */
    public Models.Folder update(Models.UpdateFolder options) {
      JsonObject o = Models.encode(options);
      return decode(json("PATCH", "/folders/" + id(str(o, "folderId", null)), null, without(o, "folderId")), Models.Folder.class);
    }

    /** @param options the folder and new parent (null for the root) @return the folder */
    public Models.Folder move(Models.MoveFolder options) {
      JsonObject o = Models.encode(options);
      JsonObject body = new JsonObject();
      body.addProperty("parentId", options.parentIdValue());
      return decode(json("POST", "/folders/" + id(str(o, "folderId", null)) + "/move", null, body), Models.Folder.class);
    }

    /** Deletes an empty folder. @param options the folder */
    public void delete(Models.FolderId options) {
      success(json("DELETE", "/folders/" + id(str(Models.encode(options), "folderId", null)), null, null));
    }
  }

  /** The events feed. Prefer webhooks in production. */
  public final class Events {
    private Events() {}

    /**
     * Lists events after a cursor. Without {@code after} it returns no events and a cursor for the
     * current time.
     *
     * @param options cursor and limit
     * @return one page of events
     */
    public Models.EventsPage list(Models.ListEvents options) {
      return decode(json("GET", project("events"), Models.encode(options), null), Models.EventsPage.class);
    }

    /**
     * Yields pages of events after {@code after} until no more are waiting, like the JavaScript
     * SDK's {@code events.pages}. Save each page's {@code cursor()} after handling it to resume
     * later. Without {@code after}, it yields one empty page whose cursor is "now".
     *
     * @param options cursor and page size
     * @return a lazy iterable of pages
     */
    public AutoPager<Models.EventsPage> pages(Models.ListEvents options) {
      JsonObject o = Models.encode(options);
      return new AutoPager<>(token -> {
        JsonObject query = o.deepCopy();
        if (token != null) query.addProperty("after", token);
        Models.EventsPage page = decode(json("GET", project("events"), query, null), Models.EventsPage.class);
        if (page.cursor() == null || page.cursor().isEmpty())
          throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Events page has no cursor", null, 200, Map.of(), null);
        return new AutoPager.Chunk<>(List.of(page), page.cursor(), page.hasMore());
      }, str(o, "after", null));
    }
  }


  /** CDN URLs and downloads. */
  public final class Cdn {
    private Cdn() {}

    /**
     * Builds the CDN URL of an asset's content, preview or placeholder, optionally through a lens or
     * transform, with {@code ?allowAgeRestricted=true} when {@link Models.CdnRequest#allowAgeRestricted(Boolean)}
     * is true. A placeholder is a small blurred PNG, public for public assets whatever their moderation
     * status; it takes no lens, transform or {@code allowAgeRestricted}.
     *
     * @param options the asset and selector
     * @return the URL
     */
    public String getAssetUrl(Models.CdnRequest options) {
      JsonObject o = Models.encode(options);
      Object transform = options.transformValue();
      String resource = str(o, "resource", "content");
      if (!List.of("content", "preview", "placeholder").contains(resource)) throw argument("Resource must be content, preview or placeholder");
      if (resource.equals("placeholder") && (o.has("lens") && !o.get("lens").isJsonNull() || transform != null
          || o.has("allowAgeRestricted") && !o.get("allowAgeRestricted").isJsonNull() && o.get("allowAgeRestricted").getAsBoolean())) {
        throw argument("A placeholder takes no lens, transform or allowAgeRestricted");
      }
      String url = cdnBaseUrl + "/assets/" + id(projectId) + "/" + id(str(o, "assetIdentifier", null)) + "/" + resource;
      if (o.has("lens") && !o.get("lens").isJsonNull()) url += "/@" + id(o.get("lens").getAsString());
      String separator = o.has("lens") && !o.get("lens").isJsonNull() ? "," : "/";
      if (transform instanceof String text) { if (!text.isEmpty()) url += separator + transformPath(text); }
      // A serialized selector is already path-safe: unreserved characters, escapes, brackets, "=" and ",".
      else if (transform != null) url += separator + serializeTransform(transform);
      if (o.has("allowAgeRestricted") && !o.get("allowAgeRestricted").isJsonNull() && o.get("allowAgeRestricted").getAsBoolean()) url += "?allowAgeRestricted=true";
      return url;
    }

    /**
     * Streams an asset from the CDN with the API key. The response is returned for any status;
     * close it when done.
     *
     * @param options the asset, selector, method and headers (such as {@code Range})
     * @return the streamed response
     */
    public CdnResponse serve(Models.CdnRequest options) { return serve(options, null); }

    /**
     * @param options the asset, selector, method and headers
     * @param requestOptions {@code timeout} overrides the idle timeout between received bytes
     * @return the streamed response
     */
    public CdnResponse serve(Models.CdnRequest options, RequestOptions requestOptions) {
      String url = getAssetUrl(options);
      Map<String, String> headers = baseHeaders("*/*");
      Models.HttpOptions init = options.initValue();
      String method = init == null || init.methodValue() == null ? "GET" : init.methodValue().toUpperCase(Locale.ROOT);
      if (!method.equals("GET") && !method.equals("HEAD")) throw argument("CDN requests use GET or HEAD");
      if (init != null && init.headersValue() != null)
        init.headersValue().forEach((name, value) -> { if (name == null || !name.equalsIgnoreCase("X-Api-Key")) header(headers, name, value); });
      Duration idle = requestOptions != null && requestOptions.timeoutValue() != null ? requestOptions.timeoutValue() : timeout;
      if (idle.isZero() || idle.isNegative()) throw argument("timeout must be a positive duration");
      Call call = new Call(method, url, headers, null, timeout, true);
      for (int attempt = 0; ; attempt++) {
        Transport.Response response;
        try {
          response = send(call);
        } catch (TransportException failure) {
          if (canRetry(call, attempt)) { backoff(attempt, null); continue; }
          throw failure;
        }
        if (retryableStatus(response.status()) && canRetry(call, attempt)) {
          Duration retryAfter = ApiException.retryAfter(response.header("retry-after"));
          if (retryAfter == null || retryAfter.compareTo(MAX_RETRY_AFTER) <= 0) {
            try { response.close(); } catch (IOException ignored) { /* retrying */ }
            backoff(attempt, retryAfter);
            continue;
          }
        }
        return new CdnResponse(response, new Timeouts.IdleTimeoutInputStream(response.body(), idle));
      }
    }
  }

  // ------------------------------------------------------------------ Lenses

  /**
   * Creates or updates one lens, caching the result in this client.
   *
   * @param options the lens definition
   * @return the lens
   */
  public Models.Lens ensureLens(Models.LensDefinition options) {
    return ensureLenses(new Models.EnsureLenses(List.of(options))).get(0);
  }

  /** The most lens definitions {@link #ensureLenses} sends in one request. */
  public static final int ENSURE_LENSES_MAX_PER_REQUEST = 100;

  /**
   * Creates or updates lenses. Definitions already ensured by this client are not sent again; more
   * than {@link #ENSURE_LENSES_MAX_PER_REQUEST} new definitions are sent in consecutive requests, in
   * order.
   *
   * @param options the lens definitions
   * @return the lenses, in the order given
   */
  public List<Models.Lens> ensureLenses(Models.EnsureLenses options) {
    JsonObject o = Models.encode(options);
    JsonArray definitions = o.has("lenses") && o.get("lenses").isJsonArray() ? o.getAsJsonArray("lenses") : null;
    if (definitions == null || definitions.isEmpty()) throw argument("At least one lens with an identifier is required");
    LinkedHashMap<String, JsonObject> missing = new LinkedHashMap<>();
    List<String> keys = new ArrayList<>();
    for (JsonElement lens : definitions) {
      if (!lens.isJsonObject()) throw argument("Lens definitions must be objects");
      JsonObject value = lens.getAsJsonObject();
      id(str(value, "identifier", null));
      String key = Json.write(Json.GSON.toJsonTree(new TreeMap<>(value.asMap())));
      keys.add(key);
      if (!lenses.containsKey(key)) missing.put(key, value);
    }
    Map<String, Models.Lens> resolved = new LinkedHashMap<>();
    List<Map.Entry<String, JsonObject>> queue = new ArrayList<>(missing.entrySet());
    for (int start = 0; start < queue.size(); start += ENSURE_LENSES_MAX_PER_REQUEST) {
      List<Map.Entry<String, JsonObject>> chunk = queue.subList(start, Math.min(start + ENSURE_LENSES_MAX_PER_REQUEST, queue.size()));
      JsonArray pending = new JsonArray();
      chunk.forEach(entry -> pending.add(entry.getValue()));
      JsonObject body = new JsonObject();
      body.add("lenses", pending);
      // The PUT is idempotent, so concurrent callers may both send it; no lock is held across I/O.
      Reply reply = json("PUT", project("lenses"), null, body);
      JsonElement returned = object(reply).get("lenses");
      if (returned == null || !returned.isJsonArray() || returned.getAsJsonArray().size() != chunk.size())
        throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Unexpected lens response", null, reply.status(), reply.headers(), null);
      Models.Lens[] created = decode(new Reply(reply.status(), reply.headers(), reply.body(), returned), Models.Lens[].class);
      Map<String, Models.Lens> chunkResolved = new LinkedHashMap<>();
      int index = 0;
      for (var entry : chunk) {
        Models.Lens lens = created[index++];
        if (lens == null || !str(entry.getValue(), "identifier", "").equals(lens.identifier()))
          throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Unexpected lens identifier", null, reply.status(), reply.headers(), null);
        chunkResolved.put(entry.getKey(), lens);
      }
      chunkResolved.forEach((key, lens) -> {
        lenses.entrySet().removeIf(cached -> lens.identifier().equals(cached.getValue().identifier()));
        lenses.put(key, lens);
      });
      resolved.putAll(chunkResolved);
    }
    List<Models.Lens> result = new ArrayList<>();
    for (String key : keys) {
      Models.Lens lens = resolved.containsKey(key) ? resolved.get(key) : lenses.get(key);
      if (lens == null) throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Lens is missing from the response", null, 200, Map.of(), null);
      result.add(lens);
    }
    return List.copyOf(result);
  }

  // ------------------------------------------------------------------ Webhooks

  /**
   * Creates the {@link #WEBHOOK_SIGNATURE_HEADER} value for a body, for tests. Arguments follow the
   * JavaScript SDK's order.
   *
   * @param secret the webhook signing secret
   * @param timestamp Unix seconds, as sent in {@link #WEBHOOK_TIMESTAMP_HEADER}
   * @param body the exact raw body
   * @return {@code v1=<hex>}
   */
  public static String createWebhookSignatureHeader(String secret, String timestamp, byte[] body) {
    return "v1=" + HexFormat.of().formatHex(webhookMac(secret, timestamp, body));
  }

  /**
   * @param secret the webhook signing secret
   * @param timestamp Unix seconds
   * @param body the raw body, encoded as UTF-8
   * @return {@code v1=<hex>}
   */
  public static String createWebhookSignatureHeader(String secret, String timestamp, String body) {
    return createWebhookSignatureHeader(secret, timestamp, body.getBytes(StandardCharsets.UTF_8));
  }

  private static byte[] webhookMac(String secret, String timestamp, byte[] body) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      mac.update((timestamp + ".").getBytes(StandardCharsets.UTF_8));
      return mac.doFinal(body);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("HmacSHA256 is unavailable", e);
    }
  }

  /**
   * Verifies a delivery against the current time with {@link #WEBHOOK_SIGNATURE_TOLERANCE_SECONDS}.
   * Pass the exact raw request body: bytes as received, never a re-serialized object.
   *
   * @param payload the raw request body
   * @param signature the {@link #WEBHOOK_SIGNATURE_HEADER} value
   * @param timestamp the {@link #WEBHOOK_TIMESTAMP_HEADER} value
   * @param secret the webhook signing secret
   * @return whether the delivery is authentic and fresh; false for anything missing or malformed
   */
  public static boolean verifyWebhookSignature(byte[] payload, String signature, String timestamp, String secret) {
    return verifyWebhookSignature(payload, signature, timestamp, secret, System.currentTimeMillis() / 1000, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
  }

  /**
   * Verifies a body held as text. Prefer the {@code byte[]} overload in servers: decoding bytes that
   * are not valid UTF-8 changes them.
   *
   * @param payload the raw request body
   * @param signature the signature header value
   * @param timestamp the timestamp header value
   * @param secret the webhook signing secret
   * @return whether the delivery is authentic and fresh
   */
  public static boolean verifyWebhookSignature(String payload, String signature, String timestamp, String secret) {
    return payload != null && verifyWebhookSignature(payload.getBytes(StandardCharsets.UTF_8), signature, timestamp, secret);
  }

  /**
   * @param payload the raw request body
   * @param signature the signature header value
   * @param timestamp the timestamp header value
   * @param secret the webhook signing secret
   * @param nowSeconds the current Unix time in seconds
   * @param toleranceSeconds the largest accepted clock distance
   * @return whether the delivery is authentic and fresh
   */
  public static boolean verifyWebhookSignature(String payload, String signature, String timestamp, String secret, long nowSeconds, long toleranceSeconds) {
    return payload != null && verifyWebhookSignature(payload.getBytes(StandardCharsets.UTF_8), signature, timestamp, secret, nowSeconds, toleranceSeconds);
  }

  /**
   * @param payload the raw request body
   * @param signature the signature header value
   * @param timestamp the timestamp header value
   * @param secret the webhook signing secret
   * @param nowSeconds the current Unix time in seconds
   * @param toleranceSeconds the largest accepted clock distance
   * @return whether the delivery is authentic and fresh
   */
  public static boolean verifyWebhookSignature(byte[] payload, String signature, String timestamp, String secret, long nowSeconds, long toleranceSeconds) {
    if (payload == null || secret == null || secret.isEmpty() || signature == null || timestamp == null) return false;
    String time = timestamp.strip();
    if (!time.matches("[0-9]{1,18}")) return false;
    if (Math.abs(nowSeconds - Long.parseLong(time)) > toleranceSeconds) return false;
    byte[] expected = HexFormat.of().formatHex(webhookMac(secret, time, payload)).getBytes(StandardCharsets.UTF_8);
    boolean matched = false;
    for (String part : signature.split(",")) {
      String candidate = part.strip();
      if (candidate.startsWith("v1="))
        matched |= MessageDigest.isEqual(expected, candidate.substring(3).toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
    }
    return matched;
  }

  /**
   * Verifies a delivery, then parses it, like the JavaScript SDK's {@code parseWebhookEvent}. Use
   * this in webhook handlers, with the exact raw request body.
   *
   * <pre>{@code
   * WebhookEventPayload event = CalmLensServerClient.parseWebhookEvent(rawBody,
   *     request.getHeader(CalmLensServerClient.WEBHOOK_SIGNATURE_HEADER),
   *     request.getHeader(CalmLensServerClient.WEBHOOK_TIMESTAMP_HEADER), secret);
   * }</pre>
   *
   * <p>Event types and fact keys added to CalmLens after this SDK version are returned as they are,
   * so keep a default branch when you switch on {@code type()}.
   *
   * @param payload the exact raw request body
   * @param signature the {@link #WEBHOOK_SIGNATURE_HEADER} value
   * @param timestamp the {@link #WEBHOOK_TIMESTAMP_HEADER} value
   * @param secret the webhook signing secret
   * @return the delivery
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_WEBHOOK_SIGNATURE} when the signature or
   *     timestamp does not verify (respond 401), {@link ErrorCodes#SDK_INVALID_WEBHOOK_PAYLOAD} when a
   *     verified body is not a webhook event
   */
  public static Models.WebhookEventPayload parseWebhookEvent(byte[] payload, String signature, String timestamp, String secret) {
    return parseWebhookEvent(payload, signature, timestamp, secret, System.currentTimeMillis() / 1000, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
  }

  /**
   * @param payload the exact raw request body
   * @param signature the signature header value
   * @param timestamp the timestamp header value
   * @param secret the webhook signing secret
   * @param nowSeconds the current Unix time in seconds
   * @param toleranceSeconds the largest accepted clock distance
   * @return the delivery
   */
  public static Models.WebhookEventPayload parseWebhookEvent(byte[] payload, String signature, String timestamp, String secret, long nowSeconds, long toleranceSeconds) {
    if (!verifyWebhookSignature(payload, signature, timestamp, secret, nowSeconds, toleranceSeconds))
      throw new CalmLensException(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE, "Webhook signature or timestamp did not verify");
    return readWebhookEvent(new String(payload, StandardCharsets.UTF_8));
  }

  /**
   * Verifies and parses a body held as text. Prefer the {@code byte[]} overload in servers.
   *
   * @param payload the raw request body as text
   * @param signature the signature header value
   * @param timestamp the timestamp header value
   * @param secret the webhook signing secret
   * @return the delivery
   */
  public static Models.WebhookEventPayload parseWebhookEvent(String payload, String signature, String timestamp, String secret) {
    if (payload == null) throw new CalmLensException(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE, "Webhook body is required");
    return parseWebhookEvent(payload.getBytes(StandardCharsets.UTF_8), signature, timestamp, secret);
  }

  /** Reads a verified body; requires {@code id}, {@code type}, {@code projectId} and {@code data}. */
  static Models.WebhookEventPayload readWebhookEvent(String payload) {
    Models.WebhookEventPayload event;
    try {
      JsonElement json = payload == null ? null : Json.GSON.fromJson(payload, JsonElement.class);
      event = json == null || !json.isJsonObject() ? null : Json.GSON.fromJson(json, Models.WebhookEventPayload.class);
    } catch (JsonParseException | IllegalStateException | IllegalArgumentException cause) {
      throw new CalmLensException(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not JSON", cause);
    }
    if (event == null || event.id() == null || event.id().isEmpty() || event.type() == null || event.type().isEmpty()
        || event.projectId() == null || event.data() == null)
      throw new CalmLensException(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not a CalmLens event");
    return event;
  }

  // ------------------------------------------------------------------ Default transport

  /** Sends requests with {@link HttpClient}, streaming bodies from memory, files or streams. */
  private static final class HttpClientTransport implements Transport {
    private final HttpClient http;

    HttpClientTransport(HttpClient http) { this.http = http; }

    @Override public Response send(Request request) throws IOException, InterruptedException {
      HttpRequest.Builder builder = HttpRequest.newBuilder(request.uri());
      if (request.timeout() != null) builder.timeout(request.timeout());
      request.headers().forEach(builder::header);
      Body body = request.body();
      HttpRequest.BodyPublisher publisher;
      if (body == null) publisher = HttpRequest.BodyPublishers.noBody();
      else if (body.bytes() != null) publisher = HttpRequest.BodyPublishers.ofByteArray(body.bytes());
      else if (body.file() != null) publisher = HttpRequest.BodyPublishers.ofFile(body.file());
      else publisher = HttpRequest.BodyPublishers.fromPublisher(HttpRequest.BodyPublishers.ofInputStream(() -> {
        try { return body.open(); } catch (IOException e) { throw new UncheckedIOException(e); }
      }), body.length());
      HttpResponse<InputStream> response = http.send(builder.method(request.method(), publisher).build(), HttpResponse.BodyHandlers.ofInputStream());
      return new Response(response.statusCode(), response.headers().map(), response.body());
    }
  }
}
