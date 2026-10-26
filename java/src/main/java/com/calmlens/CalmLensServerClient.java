package com.calmlens;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonPrimitive;
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
import java.util.regex.Matcher;
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
  /** The longest signed URL lifetime the API accepts, in seconds: 24 hours. */
  public static final long MAX_SIGNED_URL_SECONDS = 24 * 60 * 60;

  private static final long MULTIPART_MIN_PART_BYTES = 5L * 1024 * 1024;
  private static final Pattern HEADER_NAME = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");
  private static final Set<String> RESTRICTED_HEADERS = Set.of("connection", "content-length", "expect", "host", "upgrade", "x-api-key");
  /** The API deadline of each request attempt when {@link Builder#timeout(Duration)} is not set: 120 seconds. */
  public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(120);
  /** Automatic retries when {@link Builder#maxRetries(int)} is not set. */
  public static final int DEFAULT_MAX_RETRIES = 2;
  /** The largest API response body read when {@link Builder#maxResponseBytes(long)} is not set: 32 MiB. */
  public static final long DEFAULT_MAX_RESPONSE_BYTES = 32L * 1024 * 1024;
  /** The backoff before the first retry is up to this long; it doubles per retry. */
  public static final Duration RETRY_BASE_DELAY = Duration.ofMillis(500);
  /** The longest backoff before a retry. */
  public static final Duration RETRY_MAX_DELAY = Duration.ofSeconds(8);
  /** A {@code Retry-After} longer than this is not waited out: the error goes back to the caller. */
  public static final Duration RETRY_AFTER_MAX = Duration.ofSeconds(60);
  /** {@code assets.createSignedUrl}'s lifetime when none is given, in seconds. */
  public static final long DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 900;
  /** {@code uploadTokens.sign}'s lifetime when none is given, in seconds. */
  public static final int DEFAULT_UPLOAD_TOKEN_EXPIRES_IN_SECONDS = 600;
  /** {@code assets.waitForDecision}'s timeout when none is given. */
  public static final Duration DEFAULT_DECISION_TIMEOUT = Duration.ofSeconds(60);
  /** The wait before {@code waitForDecision}'s second check. */
  public static final Duration DECISION_POLL_FIRST_DELAY = Duration.ofMillis(500);
  /** How much longer each {@code waitForDecision} wait is than the one before. */
  public static final double DECISION_POLL_DELAY_FACTOR = 1.5;
  /** The longest wait between {@code waitForDecision} checks. */
  public static final Duration DECISION_POLL_MAX_DELAY = Duration.ofSeconds(5);

  /** Asset uploads, moderation, listing and management. */
  public final Assets assets = new Assets();
  /** Text moderation. */
  public final Text text = new Text();
  /** Folders. */
  public final Folders folders = new Folders();
  /** Hash lists that image uploads are compared with. */
  public final HashLists hashLists = new HashLists();
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
  private final AtomicBoolean closed;
  private final LensCache lenses;
  /** Leaves multipart size checks to the API; set by the mock so its API answers them in the API's order. */
  boolean deferUploadChecks;

  /** Lenses ensured by a client and the clients derived from it, and the requests in flight. */
  private static final class LensCache {
    final Map<String, Models.Lens> ensured = new ConcurrentHashMap<>();
    final Map<String, java.util.concurrent.CompletableFuture<Void>> pending = new ConcurrentHashMap<>();
  }

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

  /** A client like {@code base} with other deadlines or retries, sharing its transport, state and lens cache. */
  private CalmLensServerClient(CalmLensServerClient base, Duration timeout, Duration uploadTimeout, int maxRetries) {
    this.apiKey = base.apiKey;
    this.projectId = base.projectId;
    this.baseUrl = base.baseUrl;
    this.cdnBaseUrl = base.cdnBaseUrl;
    this.userAgent = base.userAgent;
    this.timeout = timeout;
    this.uploadTimeout = uploadTimeout;
    this.maxRetries = maxRetries;
    this.maxResponseBytes = base.maxResponseBytes;
    this.transport = base.transport;
    this.ownedHttpClient = null;
    this.sleeper = base.sleeper;
    this.nanoTime = base.nanoTime;
    this.closed = base.closed;
    this.lenses = base.lenses;
    this.deferUploadChecks = base.deferUploadChecks;
  }

  private CalmLensServerClient(Builder options, Transport override, Sleeper sleeper, LongSupplier nanoTime) {
    // Validate every option before building anything.
    if (options.apiKey == null || options.apiKey.isBlank() || options.projectId == null || options.projectId.isBlank())
      throw config("API key and project ID are required");
    if (options.projectId.equals(".") || options.projectId.equals("..")) throw config("Project ID is invalid");
    positive("timeout", options.timeout, false);
    positive("connectTimeout", options.connectTimeout, false);
    positive("uploadTimeout", options.uploadTimeout, true);
    if (options.maxRetries < 0 || options.maxRetries > 10) throw config("maxRetries must be between 0 and 10");
    if (options.maxResponseBytes < 1) throw config("maxResponseBytes must be a positive number of bytes");
    this.closed = new AtomicBoolean();
    this.lenses = new LensCache();
    this.baseUrl = baseUrl("baseUrl", options.baseUrl);
    this.cdnBaseUrl = baseUrl("cdnBaseUrl", options.cdnBaseUrl);
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.timeout = options.timeout;
    this.uploadTimeout = options.uploadTimeout;
    this.maxRetries = options.maxRetries;
    this.maxResponseBytes = options.maxResponseBytes;
    this.userAgent = "calmlens-java/" + VERSION + " (java/" + Runtime.version() + ")";
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

  /** The most assets one {@code assets.batch} request takes. */
  public static final int ASSET_BATCH_MAX_ASSETS = 500;

  /** Refuses a batch the API would reject for its size, an ID or the operation. */
  static void validateBatch(Models.BatchAssets options) {
    if (options == null) throw argument("Batch options are required");
    java.util.List<String> ids = options.assetIdsValue();
    if (ids == null || ids.isEmpty() || ids.size() > ASSET_BATCH_MAX_ASSETS)
      throw argument("assetIds must list 1 to " + ASSET_BATCH_MAX_ASSETS + " asset IDs");
    for (String id : ids) if (id == null || id.isEmpty()) throw argument("Every asset ID must be a non-empty string");
    if (options.operationValue() == null) throw argument("operation must be one of delete, remove-content");
  }

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
    private Duration timeout = DEFAULT_TIMEOUT;
    private Duration connectTimeout = Duration.ofSeconds(10);
    private Duration uploadTimeout;
    private int maxRetries = DEFAULT_MAX_RETRIES;
    private long maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES;
    private Transport transport;
    private HttpClient httpClient;

    private Builder(String apiKey, String projectId) { this.apiKey = apiKey; this.projectId = projectId; }

    /** @param value the API base URL, such as {@code http://localhost:6110/v1} @return this builder */
    public Builder baseUrl(String value) { baseUrl = value; return this; }

    /** @param value the CDN base URL @return this builder */
    public Builder cdnBaseUrl(String value) { cdnBaseUrl = value; return this; }

    /**
     * Deadline of each API request attempt, from sending it to reading its response body (120
     * seconds by default). Text uploads use it too; binary uploads use {@link
     * #uploadTimeout(Duration)}. For {@code cdn.serve} it ends when the response headers arrive, and
     * a CDN stream then fails when no data arrives for this long.
     *
     * @param value a positive duration
     * @return this builder
     */
    public Builder timeout(Duration value) { timeout = value; return this; }

    /** @param value time allowed to open a connection (10 seconds by default) @return this builder */
    public Builder connectTimeout(Duration value) { connectTimeout = value; return this; }

    /**
     * Deadline of each binary upload attempt (file, byte and stream content and multipart parts).
     * There is none by default, so large files are never cut off; text content and URL submissions
     * use {@link #timeout(Duration)}. Override it per call with {@link
     * RequestOptions#uploadTimeout(Duration)}.
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

    /**
     * The largest API response body the client reads (32 MiB by default). A larger declared {@code
     * Content-Length} or body fails with {@link ErrorCodes#SDK_RESPONSE_TOO_LARGE}; {@code cdn.serve}
     * bodies are not limited.
     *
     * @param value a positive number of bytes
     * @return this builder
     */
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

  /**
   * A client whose calls use other deadlines or retries, sharing this client's credentials,
   * connection and lens cache. This client is unchanged, and closing either closes both.
   *
   * <pre>{@code
   * var patient = client.withRequestOptions(new RequestOptions().timeout(Duration.ofMinutes(5)).maxRetries(5));
   * }</pre>
   *
   * @param options {@code timeout}, {@code uploadTimeout} and {@code maxRetries}; an idempotency
   *     key belongs to one call, so it is refused here
   * @return the derived client
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for invalid options
   */
  public CalmLensServerClient withRequestOptions(RequestOptions options) {
    if (options == null) throw argument("Request options are required");
    if (options.idempotencyKeyValue() != null) throw argument("An idempotency key applies to one call; pass it to that call");
    return with(options);
  }

  /** This client, or a derived one with the overrides in {@code options}. */
  private CalmLensServerClient with(RequestOptions options) {
    if (options == null || options.timeoutValue() == null && options.uploadTimeoutValue() == null && options.maxRetriesValue() == null) return this;
    Duration callTimeout = options.timeoutValue() != null ? options.timeoutValue() : timeout;
    Duration callUploadTimeout = options.uploadTimeoutValue() != null ? options.uploadTimeoutValue() : uploadTimeout;
    int retries = options.maxRetriesValue() != null ? options.maxRetriesValue() : maxRetries;
    if (callTimeout.isZero() || callTimeout.isNegative()) throw argument("timeout must be a positive duration");
    if (callUploadTimeout != null && (callUploadTimeout.isZero() || callUploadTimeout.isNegative())) throw argument("uploadTimeout must be a positive duration");
    if (retries < 0 || retries > 10) throw argument("maxRetries must be between 0 and 10");
    return new CalmLensServerClient(this, callTimeout, callUploadTimeout, retries);
  }

  private static String key(RequestOptions options) { return options == null ? null : options.idempotencyKeyValue(); }

  // For MockCalmLensServerClient, which answers requests at these addresses.
  String projectId() { return projectId; }
  String baseUrl() { return baseUrl; }
  String cdnBaseUrl() { return cdnBaseUrl; }
  Duration timeout() { return timeout; }
  Duration uploadTimeout() { return uploadTimeout; }
  int maxRetries() { return maxRetries; }
  long maxResponseBytes() { return maxResponseBytes; }

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
    return encodeComponent(value);
  }

  /** Percent-encodes UTF-8 like JavaScript's {@code encodeURIComponent}: all but {@code A-Z a-z 0-9 - _ . ! ~ * ' ( )}. */
  static String encodeComponent(String value) {
    StringBuilder out = new StringBuilder();
    for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xff;
      if (c < 0x80 && (Character.isLetterOrDigit(c) || "-_.!~*'()".indexOf(c) >= 0)) out.append((char) c);
      else out.append(String.format("%%%02X", c));
    }
    return out.toString();
  }

  /** Encodes a CDN transform selector string like JavaScript's encodeURI, keeping its separators. */
  private static String transformPath(String value) {
    String transform = value.replaceFirst("^/+", "");
    if (transform.contains("..") || transform.contains("?") || transform.contains("#"))
      throw argument("Transform cannot contain \"..\", \"?\" or \"#\"");
    StringBuilder out = new StringBuilder();
    for (byte b : transform.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xff;
      if (c < 0x80 && (Character.isLetterOrDigit(c) || "-_.!~*'();/:@&=+$,".indexOf(c) >= 0)) out.append((char) c);
      else out.append(String.format("%%%02X", c));
    }
    return out.toString();
  }

  private static final Pattern TRANSFORM_OPTION_NAME = Pattern.compile("^[a-z][a-zA-Z0-9]*$");
  /** Options that hold colours, written as hex without {@code #} in a selector. */
  // <generated: image-transform-colours>
  // Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.
  // Options that hold colours, written as hex without `#` in a selector.
  private static final Set<String> TRANSFORM_COLOUR_KEYS = Set.of("background", "border.color", "trim.border.color");
  // </generated: image-transform-colours>
  private static final Pattern HEX_COLOUR = Pattern.compile("^#((?:[0-9a-fA-F]{3}){1,2}|(?:[0-9a-fA-F]{4}){1,2})$");

  /** The selector the API accepts: a string as given, or structured steps serialized. */
  private static String transformSelector(Object transform) {
    return transform == null || transform instanceof String ? (String) transform : serializeTransform(transform);
  }

  /**
   * Serializes structured transforms as a CDN selector, one path segment per step, such as
   * {@code fit=cover,width=640/format=webp}. Option keys are sorted so equal transforms share a URL,
   * nested keys are dotted ({@code border.color}), hex colours are written without {@code #} and
   * values are percent-encoded.
   */
  static String serializeTransform(Object transform) {
    List<?> steps = transform instanceof List<?> list ? list : List.of(transform);
    if (steps.isEmpty()) throw argument("Transform needs at least one step");
    List<String> selectors = new ArrayList<>();
    for (Object item : steps) {
      if (!(item instanceof Models.Transform step)) throw argument("Transform steps must be transforms");
      if (!Models.Transform.IMAGE.equals(step.type())) throw argument("Transform type must be \"imageTransform\"");
      Map<?, ?> options = transformOptions(step.options());
      List<String> pairs = new ArrayList<>();
      for (String key : sortedKeys(options, "")) appendTransformOption(pairs, key, options.get(key));
      if (pairs.isEmpty()) throw argument("Transform steps need at least one option");
      selectors.add(String.join(",", pairs));
    }
    return String.join("/", selectors);
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

  private static List<String> sortedKeys(Map<?, ?> map, String prefix) {
    List<String> keys = new ArrayList<>();
    for (Object key : map.keySet()) {
      if (!(key instanceof String text) || !TRANSFORM_OPTION_NAME.matcher(text).matches())
        throw argument("Transform option \"" + prefix + key + "\" is not a valid name");
      keys.add(text);
    }
    keys.sort(null);
    return keys;
  }

  private static void appendTransformOption(List<String> pairs, String key, Object value) {
    if (value == null) return;
    if (value instanceof Map<?, ?> map) {
      for (String child : sortedKeys(map, key + ".")) appendTransformOption(pairs, key + "." + child, map.get(child));
      return;
    }
    String text;
    if (value instanceof String string) {
      Matcher hex = TRANSFORM_COLOUR_KEYS.contains(key) ? HEX_COLOUR.matcher(string) : null;
      text = hex != null && hex.matches() ? hex.group(1).toLowerCase(Locale.ROOT) : string;
    }
    else if (value instanceof Boolean bool) text = bool.toString();
    else if (value instanceof Number number && finite(number)) text = jsNumber(number);
    else throw argument("Transform option \"" + key + "\" must be a string, number, boolean or map");
    pairs.add(key + "=" + encodeTransformComponent(text));
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

  /**
   * The caller's key, or a new one. The API decides which keys are valid ({@link
   * ErrorCodes#INVALID_IDEMPOTENCY_KEY}); only values no HTTP header can carry are refused here.
   */
  private static String idempotencyKey(String key) {
    if (key == null) return UUID.randomUUID().toString();
    for (int i = 0; i < key.length(); i++) {
      char c = key.charAt(i);
      if (c < 0x20 || c == 0x7f || c > 0xff) throw argument("An idempotency key cannot contain control or non-Latin-1 characters");
    }
    return key;
  }

  // ------------------------------------------------------------------ Requests, retries and errors

  private record Call(String method, String url, Map<String, String> headers, Transport.Body body, Duration timeout, boolean retryable) {}

  /** A response whose body has been read. */
  private record Reply(int status, Map<String, List<String>> headers, byte[] body, JsonElement json) {}

  private void ensureOpen() {
    if (closed.get()) throw new CalmLensException(ErrorCodes.SDK_CLIENT_CLOSED, "The client is closed");
  }

  /** The API key and User-Agent, and {@code accept} unless it is null. */
  private Map<String, String> baseHeaders(String accept) {
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("X-Api-Key", apiKey);
    headers.put("User-Agent", userAgent);
    if (accept != null) headers.put("Accept", accept);
    return headers;
  }

  private boolean canRetry(Call call, int attempt) {
    return attempt < maxRetries && call.retryable() && (call.body() == null || call.body().replayable());
  }

  /**
   * The backoff before retry {@code attempt} (0-based) without a {@code Retry-After}: {@code d =
   * min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * 2^attempt)}, waiting {@code d/2 + random * d/2}, rounded.
   */
  static Duration retryDelay(int attempt, double random) {
    double delay = Math.min(RETRY_MAX_DELAY.toMillis(), RETRY_BASE_DELAY.toMillis() * Math.pow(2, attempt));
    return Duration.ofMillis(Math.round(delay / 2 + random * (delay / 2)));
  }

  private void pause(Duration delay) {
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
      if (Thread.currentThread().isInterrupted())
        throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Request interrupted", failure);
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

  private static boolean isRedirect(int status) { return status >= 300 && status < 400; }

  /** The declared {@code Content-Length}, or -1. */
  private static long declaredLength(Transport.Response response) {
    String value = response.header("content-length");
    try { return value == null ? -1 : Long.parseLong(value.strip()); } catch (NumberFormatException invalid) { return -1; }
  }

  private ApiException tooLarge(Transport.Response response) {
    return new ApiException(ErrorCodes.SDK_RESPONSE_TOO_LARGE, "Response body exceeds " + maxResponseBytes + " bytes",
        null, response.status(), response.headers(), null);
  }

  /** The time left of an attempt that started at {@code started} (nanoTime), or null without a deadline. */
  private Duration remaining(Duration deadline, long started) {
    if (deadline == null) return null;
    Duration left = deadline.minusNanos(System.nanoTime() - started);
    return left.isNegative() || left.isZero() ? Duration.ofMillis(1) : left;
  }

  /**
   * Sends a JSON API request and reads its body within the size limit and the attempt's deadline,
   * retrying when allowed. A 2xx reply is returned; anything else is thrown.
   */
  private Reply execute(Call call) {
    for (int attempt = 0; ; attempt++) {
      Transport.Response response;
      byte[] body;
      try {
        long started = System.nanoTime();
        response = send(call);
        try (response) {
          // A redirect is an HTTP failure like any other: repeating the request redirects again.
          if (isRedirect(response.status()))
            throw new ApiException(ErrorCodes.SDK_HTTP_ERROR, "Unexpected redirect (HTTP " + response.status() + ")", null, response.status(), response.headers(), null);
          if (declaredLength(response) > maxResponseBytes) throw tooLarge(response);
          body = Timeouts.readAll(response.body(), maxResponseBytes, remaining(call.timeout(), started));
        } catch (IOException failure) {
          throw transportError(failure);
        }
      } catch (TransportException failure) {
        if (canRetry(call, attempt) && !Thread.currentThread().isInterrupted()) { pause(retryDelay(attempt, ThreadLocalRandom.current().nextDouble())); continue; }
        throw failure;
      }
      if (body == null) throw tooLarge(response);
      Reply reply = parse(response, body);
      if (reply.status() >= 200 && reply.status() < 300) return reply;
      ApiException error = error(reply);
      if (canRetry(call, attempt) && error.isRetryable()) {
        Duration wait = error.getRetryAfter().isPresent() ? error.getRetryAfter().get() : retryDelay(attempt, ThreadLocalRandom.current().nextDouble());
        if (wait.compareTo(RETRY_AFTER_MAX) <= 0) {
          pause(wait);
          continue;
        }
      }
      throw error;
    }
  }

  private static String errorCode(JsonElement json) {
    return json != null && json.isJsonObject() && json.getAsJsonObject().get("code") instanceof JsonPrimitive code && code.isString()
        ? code.getAsString() : null;
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

  /**
   * The error for a non-2xx reply: the API's code, message and details (with its {@code traceId}),
   * or {@link ErrorCodes#SDK_HTTP_ERROR} when the body carries no code.
   */
  private static ApiException error(Reply reply) {
    String code = errorCode(reply.json());
    if (code == null) return new ApiException(ErrorCodes.SDK_HTTP_ERROR, "HTTP " + reply.status(), null, reply.status(), reply.headers(), null);
    JsonObject failure = reply.json().getAsJsonObject();
    Map<String, Object> details = new LinkedHashMap<>();
    if (failure.has("details") && failure.get("details").isJsonObject())
      details.putAll(Json.GSON.fromJson(failure.get("details"), new TypeToken<Map<String, Object>>() {}.getType()));
    if (failure.get("traceId") instanceof JsonPrimitive trace && trace.isString()) details.put("traceId", trace.getAsString());
    String message = failure.get("message") instanceof JsonPrimitive text && text.isString() ? text.getAsString() : code;
    return new ApiException(code, message, details, reply.status(), reply.headers(), null);
  }

  /** The JSON body of a successful reply. */
  private static JsonElement success(Reply reply) { return reply.json(); }

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
        // A JSON object that is not an asset: the body was read, but it is not what was asked for.
        throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Expected an asset with an id, upload, classification and moderation status", null, reply.status(), Map.of(), null);
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

  /** MIME types the API refuses for uploads, after dropping parameters and lowercasing. */
  private static final Set<String> REJECTED_UPLOAD_MIME_TYPES = Set.of("application/octet-stream", "multipart/form-data",
      "multipart/mixed", "multipart/alternative", "multipart/related", "multipart/signed", "multipart/encrypted");

  private static void checkMimeType(String type) {
    String lower = type.toLowerCase(Locale.ROOT);
    String mime = lower.split(";", -1)[0].strip();
    if (mime.isEmpty()) mime = lower.strip();
    if (REJECTED_UPLOAD_MIME_TYPES.contains(mime))
      throw new CalmLensException(ErrorCodes.INVALID_UPLOAD_MIME_TYPE, mime
          + " is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process,"
          + " such as image/png, image/jpeg, application/pdf, or text/plain.", Map.of("mimeType", type), null);
  }

  /**
   * Refuses, before anything is sent, a multipart part under 5 MiB that is not the last and, for
   * images, a first part over 20 MiB or a final first part (the whole image) under 10 MiB. A
   * stream of unknown length is left to the API.
   */
  private void checkPartSize(long size, boolean last, boolean firstImagePart) {
    if (deferUploadChecks || size < 0) return;
    if (firstImagePart && size > 20L * 1024 * 1024)
      throw new CalmLensException(ErrorCodes.MULTIPART_IMAGE_TOO_LARGE, "Multipart image uploads cannot exceed 20MB.");
    if (firstImagePart && last && size < 10L * 1024 * 1024)
      throw new CalmLensException(ErrorCodes.MULTIPART_IMAGE_TOO_SMALL, "Multipart image uploads must total at least 10MB.");
    if (!last && size < MULTIPART_MIN_PART_BYTES)
      throw payloadError("Multipart upload parts must be at least 5MiB except the final part.");
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
    if (declared != null && declared < 0) throw payloadError("sizeInBytes must match the payload byte length");
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
      // A stream without a declared size is sent chunked, without sizeInBytes.
      default -> body = Transport.Body.ofStream(content.stream, declared == null ? -1 : declared);
    }
    if (declared != null && body.length() >= 0 && declared != body.length()) throw payloadError("sizeInBytes must match the payload byte length");
    return body;
  }

  /** Sends an upload: text keeps the API deadline, binary content uses the upload deadline. */
  private Reply upload(String path, JsonObject query, Transport.Body body, String contentType, String mode, String key, boolean text) {
    Map<String, String> headers = baseHeaders("application/json");
    if (contentType != null) headers.put("Content-Type", contentType);
    headers.put("X-CalmLens-Upload", mode);
    headers.put("Idempotency-Key", idempotencyKey(key));
    return execute(new Call("POST", baseUrl + path + query(query), headers, body, text ? timeout : uploadTimeout, true));
  }

  private Models.Asset submit(Models.SubmitAsset options, boolean queue, String key) {
    JsonObject o = Models.encode(options);
    if (List.of("content", "part", "url").stream().noneMatch(k -> o.has(k) && !o.get(k).isJsonNull()))
      throw payloadError("Either file content, URL, or multipart part is required");
    if (str(o, "name", "").isEmpty()) throw payloadError("Asset name is required");
    if (List.of("content", "part", "url").stream().filter(k -> o.has(k) && !o.get(k).isJsonNull()).count() != 1)
      throw payloadError("Supply exactly one of content, part, or url");
    if (options.contextValue() != null) {
      // Only the posts CalmLens uses are sent, which keeps a raw upload's query short.
      List<Models.ModerationContextItem> items = Models.selectModerationContextItems(options.contextValue().items());
      o.add("context", Json.GSON.toJsonTree(new Models.ModerationContext(items)));
    }
    JsonObject query = new JsonObject();
    query.addProperty("queue", queue);
    if (o.has("url")) {
      Map<String, String> headers = baseHeaders("application/json");
      headers.put("Content-Type", "application/json");
      headers.put("Idempotency-Key", idempotencyKey(key));
      Transport.Body body = Transport.Body.ofBytes(Json.write(o).getBytes(StandardCharsets.UTF_8));
      return decode(execute(new Call("POST", baseUrl + project("assets") + query(query), headers, body, timeout, true)), Models.Asset.class);
    }
    boolean multipart = o.has("part");
    Models.Content content = multipart ? options.partValue() : options.contentValue();
    JsonObject encoded = o.getAsJsonObject(multipart ? "part" : "content");
    if (multipart && encoded.has("partNumber") && encoded.get("partNumber").getAsLong() > 1)
      throw new CalmLensException(ErrorCodes.USE_UPLOAD_PART, "Use uploadPart for multipart upload parts after the first part");
    String type = str(encoded, "type", "");
    checkMimeType(type);
    Transport.Body body = payload(content, encoded, multipart);
    if (multipart) checkPartSize(body.length(), flag(encoded, "isFinal"), type.strip().toLowerCase(Locale.ROOT).startsWith("image/"));
    for (String k : List.of("name", "description", "processingOptions", "visibility", "metadata", "authorId", "context", "externalId", "externalUrl", "folderId", "uploadPresetId", "totalSizeInBytes"))
      if (o.has(k)) query.add(k, o.get(k));
    query.addProperty("contentType", type);
    if (body.length() >= 0) query.addProperty("sizeInBytes", body.length());
    if (multipart) {
      query.addProperty("partNumber", 1);
      query.addProperty("isFinal", flag(encoded, "isFinal"));
    }
    boolean text = encoded.has("plainText") && !encoded.get("plainText").isJsonNull();
    return decode(upload(project("assets"), query, body, type, multipart ? "part" : "content", key, text), Models.Asset.class);
  }

  // ------------------------------------------------------------------ Resources

  /** A later part of a multipart upload, sent without a {@code Content-Type}, as the API reads it. */
  private Models.Asset sendPart(Models.UploadPart options, String key) {
    JsonObject o = Models.encode(options);
    String path = "/assets/" + id(str(o, "assetId", null)) + "/part";
    if (!o.has("part")) throw argument("Part options are required");
    JsonObject part = o.getAsJsonObject("part");
    if (!part.has("partNumber") || part.get("partNumber").getAsLong() < 1)
      throw new CalmLensException(ErrorCodes.INVALID_UPLOAD_PART_NUMBER, "partNumber must be a positive integer");
    Transport.Body body = payload(options.partValue(), part, true);
    checkPartSize(body.length(), flag(part, "isFinal"), false);
    JsonObject query = new JsonObject();
    if (o.has("queue")) query.add("queue", o.get("queue"));
    query.add("partNumber", part.get("partNumber"));
    query.addProperty("isFinal", flag(part, "isFinal"));
    if (body.length() >= 0) query.addProperty("sizeInBytes", body.length());
    boolean text = part.has("plainText") && !part.get("plainText").isJsonNull();
    return decode(upload(path, query, body, null, "part", key, text), Models.Asset.class);
  }

  private AutoPager<Models.Asset> pages(String path, JsonObject options) {
    String first = options.has("cursor") && !options.get("cursor").isJsonNull() ? options.get("cursor").getAsString() : null;
    return new AutoPager<>(token -> {
      JsonObject query = options.deepCopy();
      if (token != null) query.addProperty("cursor", token);
      Models.AssetPage page = decode(json("GET", path, query, null), Models.AssetPage.class);
      boolean more = page.hasMore() && page.nextCursor() != null && !page.items().isEmpty();
      return new AutoPager.Chunk<>(page.items(), more ? page.nextCursor() : null, more);
    }, first, false);
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
     * @param requestOptions idempotency key, deadlines and retries for this call
     * @return the new asset
     */
    public Models.Asset create(Models.SubmitAsset options, RequestOptions requestOptions) { return with(requestOptions).submit(options, true, key(requestOptions)); }

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
     * @param requestOptions idempotency key, deadlines and retries for this call
     * @return the classified asset
     */
    public Models.Asset classify(Models.SubmitAsset options, RequestOptions requestOptions) {
      if (options != null) {
        JsonObject o = Models.encode(options);
        if (o.has("content") && o.getAsJsonObject("content").has("plainText") && str(o.getAsJsonObject("content"), "plainText", "").isBlank())
          throw payloadError("Text to classify must be a non-empty string");
      }
      return with(requestOptions).submit(options, false, key(requestOptions));
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
     * pending} ({@code allowed}, {@code limited}, {@code age-restricted}, {@code blocked} or {@code purged}), or its
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
      long delay = DECISION_POLL_FIRST_DELAY.toNanos();
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
        delay = Math.min(DECISION_POLL_MAX_DELAY.toNanos(), Math.round(delay * DECISION_POLL_DELAY_FACTOR));
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
     * Completes the policy evidence behind a decided asset's moderation decision: the report's
     * {@code classification.moderation.policy.evidence} becomes {@code full} and every action stays as
     * decided. With {@code rerun} the asset is moderated again with the project's current policy and
     * returns in {@code processing}; use it when the policy changed since the decision
     * ({@code asset/policy-changed}).
     *
     * @param options the asset, and whether to moderate it again
     * @return the asset
     */
    public Models.Asset explain(Models.ExplainAsset options) {
      JsonObject body = new JsonObject();
      if (options.rerunValue()) body.addProperty("rerun", true);
      return decode(json("POST", "/assets/" + id(str(Models.encode(options), "assetId", null)) + "/explain", null, body), Models.Asset.class);
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

    /**
     * Deletes up to 500 assets ({@link Models.AssetBatchOperation#DELETE}) or removes their stored
     * content ({@link Models.AssetBatchOperation#REMOVE_CONTENT}) in one request. Every asset must
     * exist in the project and the key needs {@code assets:delete} for its folder, or nothing is
     * queued. The work runs in the background and records {@code asset.deleted} or
     * {@code asset.content-removed} for each asset; assets under a safety hold are skipped. Not
     * retried: it carries no {@code Idempotency-Key}.
     *
     * @param options the asset IDs and the operation
     * @return the queued response
     */
    public Models.BatchAssetsResponse batch(Models.BatchAssets options) {
      validateBatch(options);
      JsonObject body = new JsonObject();
      com.google.gson.JsonArray ids = new com.google.gson.JsonArray();
      options.assetIdsValue().forEach(ids::add);
      body.add("assetIds", ids);
      body.addProperty("operation", options.operationValue().value());
      return decode(json("POST", project("assets/batch"), null, body), Models.BatchAssetsResponse.class);
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
     * @param requestOptions idempotency key, deadlines and retries for this call
     * @return the asset
     */
    public Models.Asset uploadPart(Models.UploadPart options, RequestOptions requestOptions) {
      return with(requestOptions).sendPart(options, key(requestOptions));
    }

    /**
     * Creates a short-lived signed CDN URL for a private asset. The API signs the {@code rendered}
     * resource unless the options ask for {@code original}; the expiry defaults to 900 seconds.
     *
     * @param options the asset, resource, lens or transform and expiry
     * @return the URL
     */
    public Models.SignedUrl createSignedUrl(Models.SignedUrlOptions options) {
      JsonObject o = Models.encode(options);
      String path = "/assets/" + id(str(o, "assetId", null)) + "/signed-url";
      // As the API checks: a placeholder needs no signature, and only the rendered resource takes
      // a lens or transform.
      String resource = str(o, "resource", "rendered");
      if (!resource.equals("original") && !resource.equals("rendered")) throw argument("A signed URL's resource must be original or rendered");
      if (resource.equals("original") && (o.has("lens") || options.transformValue() != null))
        throw argument("Lenses and transforms apply only to the rendered resource");
      if (o.has("expiresInSeconds")) {
        long seconds = o.get("expiresInSeconds").getAsLong();
        if (seconds < 1 || seconds > MAX_SIGNED_URL_SECONDS) throw argument("expiresInSeconds must be from 1 to 86400");
      }
      JsonObject body = new JsonObject();
      body.addProperty("expiresInSeconds", DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS);
      without(o, "assetId").entrySet().forEach(entry -> body.add(entry.getKey(), entry.getValue()));
      String transform = transformSelector(options.transformValue());
      if (transform != null) body.addProperty("transform", transform);
      return decode(json("POST", path, null, body), Models.SignedUrl.class);
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
      return signUploadToken(apiKey, options, System.currentTimeMillis(), UUID.randomUUID().toString());
    }
  }

  /**
   * Signs an upload token at {@code now} (epoch milliseconds) with {@code nonce}. The claims are
   * written as JavaScript's {@code JSON.stringify} writes them, which the API verifies byte for byte.
   */
  static Models.SignedUploadToken signUploadToken(String apiKey, Models.SignUploadToken options, long now, String nonce) {
    if (options == null) throw argument("Options are required");
    String presetId = options.uploadPresetIdValue();
    id(presetId);
    int ttl = options.expiresInSecondsValue() == null ? DEFAULT_UPLOAD_TOKEN_EXPIRES_IN_SECONDS : options.expiresInSecondsValue();
    if (ttl < 1 || ttl > 3600) throw argument("expiresInSeconds must be a whole number from 1 to 3600");
    String externalId = options.externalIdValue();
    if (externalId != null && externalId.isEmpty()) throw argument("externalId must be a non-empty string");
    long expiresAt = now + ttl * 1000L;
    String prefix = apiKey.substring(0, Math.min(apiKey.length(), apiKey.startsWith("clsk_") ? 13 : 8));
    String claims = "{\"v\":1,\"u\":" + jsonString(presetId) + ",\"k\":" + jsonString(prefix) + ",\"e\":" + expiresAt
        + ",\"n\":" + jsonString(nonce) + (externalId == null ? "" : ",\"x\":" + jsonString(externalId)) + "}";
    String body = Base64.getUrlEncoder().withoutPadding().encodeToString(claims.getBytes(StandardCharsets.UTF_8));
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

  /**
   * A JSON string as {@code JSON.stringify} writes it: only quotes, backslashes, control characters
   * and lone surrogates are escaped; everything else, {@code /}, {@code <}, {@code >} and {@code &}
   * included, is written as it is.
   */
  static String jsonString(String value) {
    StringBuilder out = new StringBuilder("\"");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          boolean lone = Character.isHighSurrogate(c) ? i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(i + 1))
              : Character.isLowSurrogate(c) && (i == 0 || !Character.isHighSurrogate(value.charAt(i - 1)));
          if (c < 0x20 || lone) out.append(String.format("\\u%04x", (int) c));
          else out.append(c);
        }
      }
    }
    return out.append('"').toString();
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

  /**
   * Hash lists: PDQ perceptual hashes that image uploads are compared with. A {@code flag} list
   * reports matches in {@code classification.moderation.hashMatches}; a {@code block} list also
   * blocks close matches.
   */
  public final class HashLists {
    private HashLists() {}

    /** @return every hash list in the project */
    public Models.HashListList list() {
      return decode(json("GET", project("hash-lists"), null, null), Models.HashListList.class);
    }

    /** @param options the hash list @return the hash list */
    public Models.HashList retrieve(Models.HashListId options) {
      return decode(json("GET", "/hash-lists/" + id(str(Models.encode(options), "hashListId", null)), null, null), Models.HashList.class);
    }

    /** @param options name, action and description @return the new hash list */
    public Models.HashList create(Models.CreateHashList options) {
      return decode(json("POST", project("hash-lists"), null, Models.encode(options)), Models.HashList.class);
    }

    /** Renames a list or changes its action; the new action applies to later uploads. @param options the hash list and fields to change @return the hash list */
    public Models.HashList update(Models.UpdateHashList options) {
      JsonObject o = Models.encode(options);
      return decode(json("PATCH", "/hash-lists/" + id(str(o, "hashListId", null)), null, without(o, "hashListId")), Models.HashList.class);
    }

    /** Deletes the list and every entry in it. @param options the hash list */
    public void delete(Models.HashListId options) {
      success(json("DELETE", "/hash-lists/" + id(str(Models.encode(options), "hashListId", null)), null, null));
    }

    /** @param options the hash list, cursor and page size @return one page of entries, newest first */
    public Models.HashListEntryPage listEntries(Models.ListHashListEntries options) {
      JsonObject o = Models.encode(options);
      return decode(json("GET", "/hash-lists/" + id(str(o, "hashListId", null)) + "/entries", without(o, "hashListId"), null), Models.HashListEntryPage.class);
    }

    /**
     * Adds a hash, or an image asset's perceptual hash; a hash the list already holds returns its
     * existing entry.
     *
     * @param options the hash list and either a hash or an asset
     * @return the entry
     */
    public Models.HashListEntry addEntry(Models.AddHashListEntry options) {
      JsonObject o = Models.encode(options);
      return decode(json("POST", "/hash-lists/" + id(str(o, "hashListId", null)) + "/entries", null, without(o, "hashListId")), Models.HashListEntry.class);
    }

    /** Removes a hash from its list; later uploads no longer match it. @param options the entry */
    public void removeEntry(Models.HashListEntryId options) {
      success(json("DELETE", "/hash-list-entries/" + id(str(Models.encode(options), "entryId", null)), null, null));
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
      }, str(o, "after", null), true);
    }
  }


  /** CDN URLs and downloads. */
  public final class Cdn {
    private Cdn() {}

    /**
     * Builds the CDN URL of an asset's {@code rendered} (default), {@code original} or {@code placeholder}
     * resource, with {@code ?allowAgeRestricted=true} when {@link Models.CdnRequest#allowAgeRestricted(Boolean)}
     * is true. Only the rendered resource takes a lens or transform. A placeholder is a small blurred PNG,
     * public for public assets whatever their moderation status; it takes no {@code allowAgeRestricted} either.
     *
     * @param options the asset and selector
     * @return the URL
     */
    public String getAssetUrl(Models.CdnRequest options) {
      JsonObject o = Models.encode(options);
      Object transform = options.transformValue();
      String resource = str(o, "resource", "rendered");
      if (!List.of("original", "rendered", "placeholder").contains(resource)) throw argument("Resource must be original, rendered or placeholder");
      boolean transformed = o.has("lens") && !o.get("lens").isJsonNull() || transform != null;
      if (resource.equals("original") && transformed) throw argument("Lenses and transforms apply only to the rendered resource");
      if (resource.equals("placeholder") && (transformed
          || o.has("allowAgeRestricted") && !o.get("allowAgeRestricted").isJsonNull() && o.get("allowAgeRestricted").getAsBoolean())) {
        throw argument("A placeholder takes no lens, transform or allowAgeRestricted");
      }
      String url = cdnBaseUrl + "/assets/" + id(projectId) + "/" + id(str(o, "assetIdentifier", null)) + "/" + resource;
      if (o.has("lens") && !o.get("lens").isJsonNull()) url += "/@" + id(o.get("lens").getAsString());
      if (transform instanceof String text) { if (!text.isEmpty()) url += "/" + transformPath(text); }
      // A serialized selector is already path-safe: unreserved characters, escapes, "=", "," and "/".
      else if (transform != null) url += "/" + serializeTransform(transform);
      if (o.has("allowAgeRestricted") && !o.get("allowAgeRestricted").isJsonNull() && o.get("allowAgeRestricted").getAsBoolean()) url += "?allowAgeRestricted=true";
      return url;
    }

    /**
     * Streams an asset from the CDN with the API key. Every status but a redirect is returned
     * (redirects fail with {@link ErrorCodes#SDK_HTTP_ERROR} and are never followed); close the
     * response when done. Transport failures and HTTP 429, 502, 503 and 504 are retried like API
     * reads, and once retries run out the last response is returned.
     *
     * @param options the asset, selector, method and headers
     * @return the streamed response
     */
    public CdnResponse serve(Models.CdnRequest options) { return serve(options, null); }

    /**
     * @param options the asset, selector, method and headers
     * @param requestOptions {@code timeout} (the wait for the response headers and between received
     *     bytes) and {@code maxRetries} for this call
     * @return the streamed response
     */
    public CdnResponse serve(Models.CdnRequest options, RequestOptions requestOptions) {
      CalmLensServerClient derived = with(requestOptions);
      if (derived != CalmLensServerClient.this) return derived.cdn.serve(options);
      String url = getAssetUrl(options);
      // No Accept unless the caller sets one: the CDN answers with the content's own type.
      Map<String, String> headers = baseHeaders(null);
      Models.HttpOptions init = options.initValue();
      String method = init == null || init.methodValue() == null ? "GET" : init.methodValue().toUpperCase(Locale.ROOT);
      if (!method.equals("GET") && !method.equals("HEAD")) throw argument("CDN requests use GET or HEAD");
      if (init != null && init.headersValue() != null)
        init.headersValue().forEach((name, value) -> { if (name == null || !name.equalsIgnoreCase("X-Api-Key")) header(headers, name, value); });
      Call call = new Call(method, url, headers, null, timeout, true);
      for (int attempt = 0; ; attempt++) {
        Transport.Response response;
        try {
          response = send(call);
        } catch (TransportException failure) {
          if (canRetry(call, attempt) && !Thread.currentThread().isInterrupted()) { pause(retryDelay(attempt, ThreadLocalRandom.current().nextDouble())); continue; }
          throw failure;
        }
        if (isRedirect(response.status())) {
          try { response.close(); } catch (IOException ignored) { /* failing */ }
          throw new ApiException(ErrorCodes.SDK_HTTP_ERROR, "Unexpected redirect (HTTP " + response.status() + ")", null, response.status(), response.headers(), null);
        }
        if (retryableStatus(response.status()) && canRetry(call, attempt)) {
          Duration retryAfter = ApiException.retryAfter(response.header("retry-after"));
          Duration wait = retryAfter != null ? retryAfter : retryDelay(attempt, ThreadLocalRandom.current().nextDouble());
          if (wait.compareTo(RETRY_AFTER_MAX) <= 0) {
            try { response.close(); } catch (IOException ignored) { /* retrying */ }
            pause(wait);
            continue;
          }
        }
        return new CdnResponse(response, new Timeouts.IdleTimeoutInputStream(response.body(), timeout));
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
   * Creates or updates lenses. Definitions already ensured by this client (or a client derived from
   * it with {@link #withRequestOptions}) are not sent again, and concurrent calls for the same new
   * definitions share one request. More than {@link #ENSURE_LENSES_MAX_PER_REQUEST} new definitions
   * are sent in consecutive requests, in order.
   *
   * @param options the lens definitions
   * @return the lenses, in the order given
   */
  public List<Models.Lens> ensureLenses(Models.EnsureLenses options) {
    JsonObject o = Models.encode(options);
    JsonArray definitions = o.has("lenses") && o.get("lenses").isJsonArray() ? o.getAsJsonArray("lenses") : null;
    if (definitions == null || definitions.isEmpty()) throw argument("At least one lens is required");
    LinkedHashMap<String, JsonObject> missing = new LinkedHashMap<>();
    List<String> keys = new ArrayList<>();
    for (JsonElement lens : definitions) {
      if (!lens.isJsonObject() || str(lens.getAsJsonObject(), "identifier", "").isEmpty()) throw argument("Lens identifier is required");
      JsonObject value = lens.getAsJsonObject();
      id(str(value, "identifier", null));
      String key = Json.write(canonical(value));
      keys.add(key);
      if (!lenses.ensured.containsKey(key)) missing.putIfAbsent(key, value);
    }
    if (!missing.isEmpty()) {
      String batch = Json.write(Json.GSON.toJsonTree(new java.util.TreeSet<>(missing.keySet())));
      java.util.concurrent.CompletableFuture<Void> mine = new java.util.concurrent.CompletableFuture<>();
      java.util.concurrent.CompletableFuture<Void> running = lenses.pending.putIfAbsent(batch, mine);
      if (running == null) {
        try {
          submitLenses(new ArrayList<>(missing.values()));
          mine.complete(null);
        } catch (RuntimeException failure) {
          mine.completeExceptionally(failure);
          throw failure;
        } finally {
          lenses.pending.remove(batch, mine);
        }
      } else {
        try {
          running.get();
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for lenses", interrupted);
        } catch (java.util.concurrent.ExecutionException failed) {
          if (failed.getCause() instanceof RuntimeException cause) throw cause;
          throw new IllegalStateException(failed.getCause());
        }
      }
    }
    List<Models.Lens> result = new ArrayList<>();
    for (int i = 0; i < keys.size(); i++) {
      Models.Lens lens = lenses.ensured.get(keys.get(i));
      // Another call may have replaced this definition with a newer version meanwhile.
      if (lens == null) throw new CalmLensException(ErrorCodes.SDK_INVALID_RESPONSE,
          "CalmLens did not return lens \"" + str(definitions.get(i).getAsJsonObject(), "identifier", "") + "\"");
      result.add(lens);
    }
    return List.copyOf(result);
  }

  /** {@code value} with object keys sorted at every level, so equal definitions share a cache key. */
  private static JsonElement canonical(JsonElement value) {
    if (value.isJsonObject()) {
      JsonObject sorted = new JsonObject();
      new TreeMap<>(value.getAsJsonObject().asMap()).forEach((key, item) -> sorted.add(key, canonical(item)));
      return sorted;
    }
    if (value.isJsonArray()) {
      JsonArray items = new JsonArray();
      value.getAsJsonArray().forEach(item -> items.add(canonical(item)));
      return items;
    }
    return value;
  }

  /** Sends new definitions in chunks, in order, caching each chunk before sending the next. */
  private void submitLenses(List<JsonObject> definitions) {
    for (int start = 0; start < definitions.size(); start += ENSURE_LENSES_MAX_PER_REQUEST) {
      List<JsonObject> chunk = definitions.subList(start, Math.min(start + ENSURE_LENSES_MAX_PER_REQUEST, definitions.size()));
      JsonArray pending = new JsonArray();
      chunk.forEach(pending::add);
      JsonObject body = new JsonObject();
      body.add("lenses", pending);
      Reply reply = json("PUT", project("lenses"), null, body);
      JsonElement returned = object(reply).get("lenses");
      int count = returned != null && returned.isJsonArray() ? returned.getAsJsonArray().size() : 0;
      if (count != chunk.size())
        throw new CalmLensException(ErrorCodes.SDK_INVALID_RESPONSE, "Expected " + chunk.size() + " lenses but CalmLens returned " + count);
      Models.Lens[] created = decode(new Reply(reply.status(), reply.headers(), reply.body(), returned), Models.Lens[].class);
      for (int index = 0; index < chunk.size(); index++) {
        Models.Lens lens = created[index];
        String identifier = str(chunk.get(index), "identifier", "");
        if (lens == null || !identifier.equals(lens.identifier()))
          throw new CalmLensException(ErrorCodes.SDK_INVALID_RESPONSE, "Expected lens \"" + identifier + "\" at position " + index);
        lenses.ensured.entrySet().removeIf(cached -> identifier.equals(cached.getValue().identifier()));
        lenses.ensured.put(Json.write(canonical(chunk.get(index))), lens);
      }
    }
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

  /**
   * The headers of one signed delivery of a body, as CalmLens sends them, for testing a webhook
   * handler. Pass the current time: handlers reject deliveries more than five minutes old.
   *
   * @param secret the webhook signing secret
   * @param body the exact raw body
   * @param deliveryId the {@link #WEBHOOK_DELIVERY_HEADER} value
   * @param timestampSeconds Unix seconds, such as {@code Instant.now().getEpochSecond()}
   * @return {@code content-type} and the delivery, timestamp and signature headers
   */
  public static Map<String, String> createWebhookHeaders(String secret, String body, String deliveryId, long timestampSeconds) {
    String timestamp = Long.toString(timestampSeconds);
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("content-type", "application/json");
    headers.put(WEBHOOK_DELIVERY_HEADER, deliveryId);
    headers.put(WEBHOOK_TIMESTAMP_HEADER, timestamp);
    headers.put(WEBHOOK_SIGNATURE_HEADER, createWebhookSignatureHeader(secret, timestamp, body));
    return java.util.Collections.unmodifiableMap(headers);
  }

  /**
   * The JSON body of the webhook delivery for an event from {@code events.list}.
   *
   * @param event the event
   * @return its delivery payload
   */
  public static Models.WebhookEventPayload toWebhookEventPayload(Models.Event event) {
    if (event.json() == null)
      return new Models.WebhookEventPayload(event.id(), event.type(), event.createdAt(), event.projectId(),
          new Models.WebhookEventData(event.severity(), event.title(), event.description(), event.assetId(), event.asset(), event.facts()));
    // From the event as received, so asset and fact fields this SDK version does not model are kept.
    Map<String, Object> json = event.json();
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("severity", json.get("severity"));
    data.put("title", json.get("title"));
    data.put("description", json.get("description"));
    data.put("assetId", json.get("assetId"));
    data.put("asset", json.get("asset"));
    data.put("facts", json.containsKey("facts") ? json.get("facts") : List.of());
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("id", json.get("id"));
    payload.put("type", json.get("type"));
    payload.put("createdAt", json.get("createdAt"));
    payload.put("projectId", json.get("projectId"));
    payload.put("data", data);
    return Json.GSON.fromJson(Json.WRITE.toJsonTree(payload), Models.WebhookEventPayload.class);
  }

  /**
   * Whether an event is a test send from the portal or API: its facts include {@code { key: "test",
   * value: true }}. Other values, keys in another case and missing facts are not.
   *
   * @param event a parsed delivery
   * @return whether it is a test send
   */
  public static boolean isTestWebhookEvent(Models.WebhookEventPayload event) {
    return event != null && event.data() != null && isTestFacts(event.data().facts());
  }

  /**
   * @param event an event from {@code events.list}
   * @return whether it is a test send
   */
  public static boolean isTestWebhookEvent(Models.Event event) { return event != null && isTestFacts(event.facts()); }

  private static boolean isTestFacts(List<Models.EventFact> facts) {
    return facts != null && facts.stream().anyMatch(fact -> fact != null && "test".equals(fact.key()) && Boolean.TRUE.equals(fact.value()));
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
    if (payload == null || secret == null || secret.isEmpty() || signature == null || signature.isEmpty() || timestamp == null) return false;
    String time = timestamp.strip();
    if (!time.matches("[0-9]+")) return false;
    // Timestamps too large for a long are further than any tolerance from now.
    String digits = time.replaceFirst("^0+(?=.)", "");
    if (digits.length() > 18 || Math.abs(nowSeconds - Long.parseLong(digits)) > toleranceSeconds) return false;
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
   * Verifies a delivery from its request headers against the current time with {@link
   * #WEBHOOK_SIGNATURE_TOLERANCE_SECONDS}. Header names match in any case, and a header repeated in
   * the request (a list value) is joined with commas, so a signature list split across headers
   * verifies.
   *
   * <pre>{@code
   * boolean ok = CalmLensServerClient.verifyWebhookRequest(request.headers().map(), rawBody, secret);
   * }</pre>
   *
   * @param headers the request headers: names to a {@code String} or a collection of strings
   * @param payload the exact raw request body
   * @param secret the webhook signing secret
   * @return whether the delivery is authentic and fresh
   */
  public static boolean verifyWebhookRequest(Map<String, ?> headers, byte[] payload, String secret) {
    return verifyWebhookRequest(headers, payload, secret, System.currentTimeMillis() / 1000, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
  }

  /**
   * @param headers the request headers: names to a {@code String} or a collection of strings
   * @param payload the exact raw request body
   * @param secret the webhook signing secret
   * @param nowSeconds the current Unix time in seconds
   * @param toleranceSeconds the largest accepted clock distance
   * @return whether the delivery is authentic and fresh
   */
  public static boolean verifyWebhookRequest(Map<String, ?> headers, byte[] payload, String secret, long nowSeconds, long toleranceSeconds) {
    return verifyWebhookSignature(payload, webhookHeader(headers, WEBHOOK_SIGNATURE_HEADER), webhookHeader(headers, WEBHOOK_TIMESTAMP_HEADER),
        secret, nowSeconds, toleranceSeconds);
  }

  /**
   * @param headers the request headers: names to a {@code String} or a collection of strings
   * @param payload the raw request body, encoded as UTF-8
   * @param secret the webhook signing secret
   * @param nowSeconds the current Unix time in seconds
   * @param toleranceSeconds the largest accepted clock distance
   * @return whether the delivery is authentic and fresh
   */
  public static boolean verifyWebhookRequest(Map<String, ?> headers, String payload, String secret, long nowSeconds, long toleranceSeconds) {
    return payload != null && verifyWebhookRequest(headers, payload.getBytes(StandardCharsets.UTF_8), secret, nowSeconds, toleranceSeconds);
  }

  /**
   * Verifies a delivery from its request headers, then parses it; see {@link
   * #verifyWebhookRequest(Map, byte[], String)} and {@link #parseWebhookEvent(byte[], String, String, String)}.
   *
   * @param headers the request headers: names to a {@code String} or a collection of strings
   * @param payload the exact raw request body
   * @param secret the webhook signing secret
   * @return the delivery
   */
  public static Models.WebhookEventPayload parseWebhookRequest(Map<String, ?> headers, byte[] payload, String secret) {
    return parseWebhookRequest(headers, payload, secret, System.currentTimeMillis() / 1000, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
  }

  /**
   * @param headers the request headers: names to a {@code String} or a collection of strings
   * @param payload the exact raw request body
   * @param secret the webhook signing secret
   * @param nowSeconds the current Unix time in seconds
   * @param toleranceSeconds the largest accepted clock distance
   * @return the delivery
   */
  public static Models.WebhookEventPayload parseWebhookRequest(Map<String, ?> headers, byte[] payload, String secret, long nowSeconds, long toleranceSeconds) {
    return parseWebhookEvent(payload, webhookHeader(headers, WEBHOOK_SIGNATURE_HEADER), webhookHeader(headers, WEBHOOK_TIMESTAMP_HEADER),
        secret, nowSeconds, toleranceSeconds);
  }

  /** A header's value by case-insensitive name, repeated values joined with commas, or null. */
  private static String webhookHeader(Map<String, ?> headers, String name) {
    if (headers == null) return null;
    List<String> values = new ArrayList<>();
    for (var entry : headers.entrySet()) {
      if (entry.getKey() == null || !entry.getKey().equalsIgnoreCase(name) || entry.getValue() == null) continue;
      if (entry.getValue() instanceof java.util.Collection<?> list) list.forEach(item -> { if (item != null) values.add(item.toString()); });
      else if (entry.getValue() instanceof String[] array) values.addAll(java.util.Arrays.asList(array));
      else values.add(entry.getValue().toString());
    }
    return values.isEmpty() ? null : String.join(",", values);
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

  /**
   * Reads a verified body like the API's receiver schema: a JSON object with string {@code id},
   * {@code type} and {@code projectId}, numeric {@code createdAt} and object {@code data} whose known
   * fields, when present, have the API's types. Unknown fields are kept in {@code json()}.
   */
  static Models.WebhookEventPayload readWebhookEvent(String payload) {
    JsonElement json;
    try {
      json = payload == null ? null : Json.GSON.fromJson(payload, JsonElement.class);
    } catch (JsonParseException | IllegalStateException cause) {
      throw new CalmLensException(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not JSON", cause);
    }
    if (json == null || !isWebhookEvent(json))
      throw new CalmLensException(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not a CalmLens event");
    try {
      return Json.GSON.fromJson(json, Models.WebhookEventPayload.class);
    } catch (JsonParseException | IllegalStateException | IllegalArgumentException cause) {
      throw new CalmLensException(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not a CalmLens event", cause);
    }
  }

  private static boolean isString(JsonElement value) { return value instanceof JsonPrimitive primitive && primitive.isString(); }

  /** Absent, or a string (or, when {@code nullable}, JSON null). */
  private static boolean optionalString(JsonObject object, String key, boolean nullable) {
    JsonElement value = object.get(key);
    return value == null || nullable && value.isJsonNull() || isString(value);
  }

  private static boolean isWebhookEvent(JsonElement json) {
    if (!(json instanceof JsonObject event) || !isString(event.get("id")) || !isString(event.get("type")) || !isString(event.get("projectId"))
        || !(event.get("createdAt") instanceof JsonPrimitive createdAt && createdAt.isNumber()) || !(event.get("data") instanceof JsonObject data))
      return false;
    if (!optionalString(data, "severity", false) || !optionalString(data, "title", false)
        || !optionalString(data, "description", true) || !optionalString(data, "assetId", true)) return false;
    JsonElement asset = data.get("asset");
    if (asset != null && !asset.isJsonNull() && !(asset instanceof JsonObject snapshot && isString(snapshot.get("id")))) return false;
    JsonElement facts = data.get("facts");
    if (facts == null) return true;
    if (!(facts instanceof JsonArray list)) return false;
    for (JsonElement fact : list)
      if (!(fact instanceof JsonObject item) || !isString(item.get("key")) || !item.has("value") || !optionalString(item, "url", false)) return false;
    return true;
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
      else {
        HttpRequest.BodyPublisher stream = HttpRequest.BodyPublishers.ofInputStream(() -> {
          try { return body.open(); } catch (IOException e) { throw new UncheckedIOException(e); }
        });
        // A stream of unknown length is sent chunked; an empty one has no body.
        publisher = body.length() < 0 ? stream : body.length() == 0 ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.fromPublisher(stream, body.length());
      }
      HttpResponse<InputStream> response = http.send(builder.method(request.method(), publisher).build(), HttpResponse.BodyHandlers.ofInputStream());
      return new Response(response.statusCode(), response.headers().map(), response.body());
    }
  }
}
