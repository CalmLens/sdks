package com.calmlens;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.google.gson.reflect.TypeToken;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
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
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
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
 * {@code Idempotency-Key}, are retried with jittered backoff on network failures, HTTP 429, 500, 502,
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
  /**
   * The resources beneath an asset URL, public or signed: the exact {@code original} upload (beneath
   * a signed URL only when it grants the original), the {@code rendered} file for display (an image,
   * a PDF, or browser-safe video or audio), the {@code preview}, a still image that stands for the
   * asset, the blurred {@code placeholder}, the {@code hls} stream of audio or video (its adaptive
   * HLS master playlist; its media playlists and segments are relative paths beneath {@code hls/}),
   * the {@code embed} page, which shows the asset in an iframe, and the {@code info} display JSON
   * ({@link Cdn#getAssetInfo(String)}).
   */
  public static final List<String> CDN_RESOURCES = List.of("original", "rendered", "preview", "placeholder", "hls", "embed", "info");
  /** Where each resource is served beneath an asset URL. */
  private static final Map<String, String> CDN_RESOURCE_PATHS = Map.of(
      "original", "original",
      "rendered", "rendered",
      "preview", "preview",
      "placeholder", "placeholder",
      "hls", "hls/index.m3u8",
      "embed", "embed",
      "info", "info");
  /** The resources that take a lens or transform: the rendered file and the preview. */
  private static final Set<String> SELECTABLE_CDN_RESOURCES = Set.of("rendered", "preview");
  /** The asset segment prefix that names an asset by its external ID. */
  private static final String EXTERNAL_ID_SEGMENT_PREFIX = "ext:";
  /** The ISO 3166-1 alpha-2 countries a viewer's region can be. EU is not a viewer country. */
  private static final Set<String> VIEWER_COUNTRIES = Set.of(("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" "));

  /** Header carrying {@code v1=<hex>} HMAC-SHA256 signatures (comma-separated during secret rotation). */
  public static final String WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
  /** Header carrying the delivery's Unix timestamp in seconds, which is part of the signed content. */
  public static final String WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
  /** Header carrying the delivery ID; it stays the same across retries of one delivery. */
  public static final String WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
  /** Deliveries whose timestamp is further than this from the receiver's clock are rejected. */
  public static final long WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
  /** The longest signed asset URL lifetime the API accepts, in seconds: 24 hours. */
  public static final long MAX_SIGNED_URL_EXPIRES_IN_SECONDS = 24 * 60 * 60;

  private static final long MULTIPART_MIN_PART_BYTES = 5L * 1024 * 1024;
  private static final Pattern HEADER_NAME = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");
  private static final Set<String> RESTRICTED_HEADERS = Set.of("connection", "content-length", "expect", "host", "upgrade", "x-api-key");
  /** The API deadline of each request attempt when {@link Builder#timeout(Duration)} is not set: 120 seconds. */
  public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(120);
  /** Automatic retries when {@link Builder#maxRetries(int)} is not set. */
  public static final int DEFAULT_MAX_RETRIES = 2;
  /** The largest API response body read when {@link Builder#maxResponseBytes(long)} is not set: 32 MiB. */
  public static final long DEFAULT_MAX_RESPONSE_BYTES = 32L * 1024 * 1024;
  /** Content larger than this is uploaded in parts of this size when {@link Builder#partSizeBytes(long)} is not set: 8 MiB. */
  public static final long DEFAULT_PART_SIZE_BYTES = 8L * 1024 * 1024;
  /** The smallest {@link Builder#partSizeBytes(long)}: every part but the last is at least 5 MiB. */
  public static final long MIN_PART_SIZE_BYTES = 5L * 1024 * 1024;
  /** The largest {@link Builder#partSizeBytes(long)}: 64 MiB. */
  public static final long MAX_PART_SIZE_BYTES = 64L * 1024 * 1024;
  /** The longest idempotency key of an upload sent in parts: each part's key adds {@code :part-<n>}. */
  static final int MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH = 240;
  /** The backoff before the first retry is up to this long; it doubles per retry. */
  public static final Duration RETRY_BASE_DELAY = Duration.ofMillis(500);
  /** The longest backoff before a retry. */
  public static final Duration RETRY_MAX_DELAY = Duration.ofSeconds(8);
  /** A {@code Retry-After} longer than this is not waited out: the error goes back to the caller. */
  public static final Duration RETRY_AFTER_MAX = Duration.ofSeconds(60);
  /** {@code cdn.signAssetUrl}'s lifetime when none is given, in seconds: 15 minutes. */
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
  public static final Duration DECISION_POLL_MAX_DELAY = Duration.ofSeconds(2);

  /** Asset uploads, moderation, listing and management. */
  public final Assets assets = new Assets();
  /** Text moderation. */
  public final Text text = new Text();
  /** Folders. */
  public final Folders folders = new Folders();
  /** Hash lists that image uploads are compared with. */
  public final HashLists hashLists = new HashLists();
  /** Moderation policies, shared by the project's organisation. */
  public final Policies policies = new Policies();
  /** {@code client.lenses}: the project's lenses. */
  public final Lenses lenses = new Lenses();
  /** The project's upload presets. */
  public final UploadPresets uploadPresets = new UploadPresets();
  /** The project's settings. */
  public final ProjectSettings projectSettings = new ProjectSettings();
  /** The project's metadata fields. */
  public final MetadataFields metadataFields = new MetadataFields();
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
  private final long partSizeBytes;
  private final Transport transport;
  private final HttpClient ownedHttpClient;
  private final Sleeper sleeper;
  private final LongSupplier nanoTime;
  private final AtomicBoolean closed;
  private final LensCache lensCache;
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
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_CONFIG} for a missing key or project, or
   *     a key that can't be sent as a header
   */
  public CalmLensServerClient(String apiKey, String projectId) { this(builder(apiKey, projectId), null, null, null, DEFAULT_MAX_RETRIES); }

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
    this.partSizeBytes = base.partSizeBytes;
    this.transport = base.transport;
    this.ownedHttpClient = null;
    this.sleeper = base.sleeper;
    this.nanoTime = base.nanoTime;
    this.closed = base.closed;
    this.lensCache = base.lensCache;
    this.deferUploadChecks = base.deferUploadChecks;
  }

  private CalmLensServerClient(Builder options, Transport override, Sleeper sleeper, LongSupplier nanoTime, int defaultMaxRetries) {
    int retries = options.maxRetries != null ? options.maxRetries : defaultMaxRetries;
    // Validate every option before building anything.
    if (options.apiKey == null || options.apiKey.isBlank() || options.projectId == null || options.projectId.isBlank())
      throw config("API key and project ID are required");
    // Only what can be sent as a header is checked: the API decides whether a key is real.
    if (!options.apiKey.chars().allMatch(c -> c >= 0x21 && c <= 0x7e)) throw config("API key must be printable ASCII without spaces");
    if (options.projectId.equals(".") || options.projectId.equals("..")) throw config("Project ID is invalid");
    positive("timeout", options.timeout, false);
    positive("connectTimeout", options.connectTimeout, false);
    positive("uploadTimeout", options.uploadTimeout, true);
    if (retries < 0 || retries > 10) throw config("maxRetries must be between 0 and 10");
    if (options.maxResponseBytes < 1) throw config("maxResponseBytes must be a positive number of bytes");
    if (options.partSizeBytes < MIN_PART_SIZE_BYTES || options.partSizeBytes > MAX_PART_SIZE_BYTES)
      throw config("partSizeBytes must be from 5 MiB (5242880) to 64 MiB (67108864)");
    this.closed = new AtomicBoolean();
    this.lensCache = new LensCache();
    this.baseUrl = baseUrl("baseUrl", options.baseUrl);
    this.cdnBaseUrl = baseUrl("cdnBaseUrl", options.cdnBaseUrl);
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.timeout = options.timeout;
    this.uploadTimeout = options.uploadTimeout;
    this.maxRetries = retries;
    this.maxResponseBytes = options.maxResponseBytes;
    this.partSizeBytes = options.partSizeBytes;
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
    /** Null until set, so the mock can default to none. */
    private Integer maxRetries;
    private long maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES;
    private long partSizeBytes = DEFAULT_PART_SIZE_BYTES;
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
     * Content larger than this many bytes, whose size the client knows and can read again (bytes,
     * base64 and files, not streams or text), is uploaded in parts of this size (8 MiB by default).
     * Each part is retried on its own, and calling {@code assets.create} or {@code assets.classify}
     * again with the same idempotency key resumes an interrupted upload.
     *
     * @param value 5 MiB (5242880) to 64 MiB (67108864)
     * @return this builder
     */
    public Builder partSizeBytes(long value) { partSizeBytes = value; return this; }

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
    public CalmLensServerClient build() { return new CalmLensServerClient(this, null, null, null, DEFAULT_MAX_RETRIES); }

    /** Builds with this configuration but another transport, leaving this builder unchanged. */
    CalmLensServerClient build(Transport override, Sleeper sleeper) { return new CalmLensServerClient(this, override, sleeper, null, DEFAULT_MAX_RETRIES); }

    /** Like {@link #build(Transport, Sleeper)}, measuring decision waits with {@code nanoTime}. */
    CalmLensServerClient build(Transport override, Sleeper sleeper, LongSupplier nanoTime) { return new CalmLensServerClient(this, override, sleeper, nanoTime, DEFAULT_MAX_RETRIES); }

    /** Like {@link #build(Transport, Sleeper, LongSupplier)}, with {@code defaultMaxRetries} unless {@link #maxRetries(int)} was set. */
    CalmLensServerClient build(Transport override, Sleeper sleeper, LongSupplier nanoTime, int defaultMaxRetries) {
      return new CalmLensServerClient(this, override, sleeper, nanoTime, defaultMaxRetries);
    }

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
  long partSizeBytes() { return partSizeBytes; }

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

  /** Encodes a checked CDN transform selector string like JavaScript's encodeURI, keeping its separators. */
  private static String transformPath(String value) {
    StringBuilder out = new StringBuilder();
    for (byte b : transformSelector(value).getBytes(StandardCharsets.UTF_8)) {
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

  /** The selector the API accepts: a string checked and as given, or structured options serialized. */
  private static String transformSelector(Object transform) {
    if (transform == null) return null;
    if (transform instanceof Models.ImageTransformOptions options) return serializeTransform(options);
    String text = (String) transform;
    // A transform is one path segment of options: it must not add a segment, lens, query or fragment.
    if (text.contains("/") || text.contains("?") || text.contains("#") || text.contains("..") || text.startsWith("@"))
      throw argument("Transform cannot contain \"/\", \"..\", \"?\" or \"#\", or start with \"@\"");
    return text;
  }

  /**
   * Serializes structured transform options as a CDN selector, such as {@code fit=cover,width=640}.
   * Option keys are sorted so equal transforms share a URL, nested keys are dotted
   * ({@code border.color}), hex colours are written without {@code #} and values are percent-encoded.
   */
  static String serializeTransform(Models.ImageTransformOptions transform) {
    Map<?, ?> options = transformOptions(transform);
    assertTransformOptions(Json.GSON.toJsonTree(options));
    List<String> pairs = new ArrayList<>();
    for (String key : sortedKeys(options, "")) appendTransformOption(pairs, key, options.get(key));
    if (pairs.isEmpty()) throw argument("A transform needs at least one option");
    return String.join(",", pairs);
  }

  /** The image transform options' schema, read once from {@link TransformSchema#JSON}. */
  private static final JsonObject TRANSFORM_OPTIONS_SCHEMA = JsonParser.parseString(TransformSchema.JSON).getAsJsonObject();

  /** The dotted keys of transform options the CDN doesn't know, and those whose values it refuses. */
  record TransformProblems(List<String> unknownKeys, List<String> invalidKeys) {
    boolean isEmpty() { return unknownKeys.isEmpty() && invalidKeys.isEmpty(); }
  }

  /**
   * Checks transform options against the image transform schema, as the CDN does, and returns the
   * dotted keys it doesn't know and those whose values it refuses (or that are required and
   * missing). Null options are left out of a selector, so they are not checked.
   */
  static TransformProblems checkTransformOptions(JsonElement options) {
    TransformProblems problems = new TransformProblems(new ArrayList<>(), new ArrayList<>());
    checkTransformRule(TRANSFORM_OPTIONS_SCHEMA, options, "", problems);
    return problems;
  }

  private static void checkTransformRule(JsonObject schema, JsonElement value, String key, TransformProblems problems) {
    JsonObject rule = schema;
    if (schema.has("oneOf")) {
      rule = null;
      for (JsonElement branch : schema.getAsJsonArray("oneOf")) {
        if (hasRuleType(str(branch.getAsJsonObject(), "type", null), value)) { rule = branch.getAsJsonObject(); break; }
      }
    }
    if (rule == null || !hasRuleType(str(rule, "type", null), value) || rule.has("enum") && !inEnum(rule.getAsJsonArray("enum"), value)
        || rule.has("minimum") && value.getAsBigDecimal().compareTo(rule.get("minimum").getAsBigDecimal()) < 0
        || rule.has("maximum") && value.getAsBigDecimal().compareTo(rule.get("maximum").getAsBigDecimal()) > 0) {
      problems.invalidKeys().add(key);
      return;
    }
    if (!"object".equals(str(rule, "type", null))) return;
    JsonObject object = value.getAsJsonObject();
    JsonObject properties = rule.has("properties") ? rule.getAsJsonObject("properties") : new JsonObject();
    if (rule.has("required"))
      for (JsonElement name : rule.getAsJsonArray("required")) {
        JsonElement child = object.get(name.getAsString());
        if (child == null || child.isJsonNull()) problems.invalidKeys().add(childKey(key, name.getAsString()));
      }
    List<String> names = new ArrayList<>(object.keySet());
    names.sort(null);
    for (String name : names) {
      JsonElement child = object.get(name);
      if (child.isJsonNull()) continue;
      if (properties.has(name)) checkTransformRule(properties.getAsJsonObject(name), child, childKey(key, name), problems);
      else problems.unknownKeys().add(childKey(key, name));
    }
  }

  private static String childKey(String key, String name) { return key.isEmpty() ? name : key + "." + name; }

  /** Whether a JSON value has a schema type: integers are numbers with no fraction, booleans aren't numbers. */
  private static boolean hasRuleType(String type, JsonElement value) {
    if (type == null) return true;
    boolean primitive = value.isJsonPrimitive();
    return switch (type) {
      case "object" -> value.isJsonObject();
      case "string" -> primitive && value.getAsJsonPrimitive().isString();
      case "boolean" -> primitive && value.getAsJsonPrimitive().isBoolean();
      case "number" -> primitive && value.getAsJsonPrimitive().isNumber() && Double.isFinite(value.getAsDouble());
      case "integer" -> primitive && value.getAsJsonPrimitive().isNumber() && Double.isFinite(value.getAsDouble())
          && value.getAsBigDecimal().stripTrailingZeros().scale() <= 0;
      default -> true;
    };
  }

  /** Whether a value is one of an enum's, comparing numbers by value. */
  private static boolean inEnum(JsonArray values, JsonElement value) {
    for (JsonElement allowed : values) {
      if (allowed.isJsonPrimitive() && allowed.getAsJsonPrimitive().isNumber() && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) {
        if (allowed.getAsBigDecimal().compareTo(value.getAsBigDecimal()) == 0) return true;
      } else if (allowed.equals(value)) return true;
    }
    return false;
  }

  /** Throws {@code sdk/invalid-argument} naming each transform option the CDN would refuse. */
  private static void assertTransformOptions(JsonElement options) {
    TransformProblems problems = checkTransformOptions(options);
    if (problems.isEmpty()) return;
    List<String> parts = new ArrayList<>();
    List<String> unknown = problems.unknownKeys(), invalid = problems.invalidKeys();
    if (!unknown.isEmpty()) parts.add("unknown option" + (unknown.size() > 1 ? "s " : " ") + String.join(", ", unknown));
    if (!invalid.isEmpty()) parts.add("invalid value" + (invalid.size() > 1 ? "s for " : " for ") + String.join(", ", invalid));
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("unknownKeys", List.copyOf(unknown));
    details.put("invalidKeys", List.copyOf(invalid));
    throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Transform options are invalid: " + String.join("; ", parts)
        + ". Pass the options themselves, such as new ImageTransformOptions().width(640).format(\"webp\").", details, null);
  }

  /** A CDN selector as the CDN reads it: an optional lens and the transform options, each null when absent. */
  record TransformSelector(String lens, JsonObject options) {}

  private static final Pattern SELECTOR_LENS = Pattern.compile("^[a-z0-9-]{1,50}$");
  private static final Pattern SELECTOR_NUMBER = Pattern.compile("^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$");

  /**
   * Reads a CDN selector, the path after the resource as sent (still percent-encoded), as the CDN
   * does: an optional first {@code @lens}, then {@code key=value} options with dotted keys for
   * nested ones (a bare key is {@code true}). Values are numbers, {@code true}, {@code false}, hex
   * colours ({@code #} added) for colour options, or text. Throws {@link IllegalArgumentException}
   * on anything the CDN refuses as {@code transform/invalid}. Used by the mock CDN.
   */
  static TransformSelector parseTransformSelector(String selector) {
    if (selector.isEmpty()) return new TransformSelector(null, null);
    IllegalArgumentException fail = new IllegalArgumentException("Invalid transform selector \"" + selector + "\"");
    if (selector.contains("/")) throw fail;
    List<String> entries = new ArrayList<>(List.of(selector.split(",", -1)));
    String lens = null;
    if (entries.get(0).startsWith("@")) {
      lens = decodeSelectorText(entries.remove(0).substring(1), fail);
      if (!SELECTOR_LENS.matcher(lens).matches()) throw fail;
    }
    if (entries.isEmpty()) return new TransformSelector(lens, null);
    JsonObject options = new JsonObject();
    for (String entry : entries) {
      if (entry.isEmpty() || entry.startsWith("@")) throw fail;
      int separator = entry.indexOf('=');
      String key = separator == -1 ? entry : entry.substring(0, separator);
      String[] parts = key.split("\\.", -1);
      for (String part : parts) if (!TRANSFORM_OPTION_NAME.matcher(part).matches()) throw fail;
      JsonElement value = new JsonPrimitive(true);
      if (separator != -1) {
        String text = decodeSelectorText(entry.substring(separator + 1), fail);
        if (text.isEmpty()) throw fail;
        if (TRANSFORM_COLOUR_KEYS.contains(key) && HEX_COLOUR.matcher("#" + text).matches()) value = new JsonPrimitive("#" + text.toLowerCase(Locale.ROOT));
        else if (SELECTOR_NUMBER.matcher(text).matches()) value = new JsonPrimitive(new java.math.BigDecimal(text));
        else if (text.equals("true") || text.equals("false")) value = new JsonPrimitive(text.equals("true"));
        else value = new JsonPrimitive(text);
      }
      JsonObject target = options;
      for (int i = 0; i < parts.length - 1; i++) {
        JsonElement next = target.get(parts[i]);
        if (next != null && !next.isJsonObject()) throw fail;
        if (next == null) target.add(parts[i], next = new JsonObject());
        target = next.getAsJsonObject();
      }
      if (target.has(parts[parts.length - 1])) throw fail;
      target.add(parts[parts.length - 1], value);
    }
    return new TransformSelector(lens, options);
  }

  /** Percent-decodes selector text as {@code decodeURIComponent} does, refusing malformed escapes. */
  private static String decodeSelectorText(String text, IllegalArgumentException fail) {
    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < text.length(); ) {
      char c = text.charAt(i);
      if (c != '%') {
        if (bytes.size() > 0) { out.append(utf8(bytes.toByteArray(), fail)); bytes.reset(); }
        out.append(c);
        i++;
        continue;
      }
      if (i + 2 >= text.length()) throw fail;
      int high = Character.digit(text.charAt(i + 1), 16), low = Character.digit(text.charAt(i + 2), 16);
      if (high < 0 || low < 0) throw fail;
      bytes.write(high << 4 | low);
      i += 3;
    }
    if (bytes.size() > 0) out.append(utf8(bytes.toByteArray(), fail));
    return out.toString();
  }

  private static String utf8(byte[] bytes, IllegalArgumentException fail) {
    try {
      return StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
          .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
    } catch (java.nio.charset.CharacterCodingException malformed) {
      throw fail;
    }
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

  private static boolean retryableStatus(int status) { return status == 429 || status == 500 || status == 502 || status == 503 || status == 504; }

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
    return execute(call, null);
  }

  private Reply execute(Call call, java.util.function.LongSupplier remainingBudget) {
    for (int attempt = 0; ; attempt++) {
      Duration attemptTimeout = call.timeout();
      if (remainingBudget != null) {
        Duration budget = Duration.ofNanos(decisionTimeLeft(remainingBudget));
        if (attemptTimeout == null || budget.compareTo(attemptTimeout) < 0) attemptTimeout = budget;
      }
      Call current = new Call(call.method(), call.url(), call.headers(), call.body(), attemptTimeout, call.retryable());
      Transport.Response response;
      byte[] body;
      try {
        long started = System.nanoTime();
        response = send(current);
        try (response) {
          // A redirect is an HTTP failure like any other: repeating the request redirects again.
          if (isRedirect(response.status()))
            throw new ApiException(ErrorCodes.SDK_HTTP_ERROR, "Unexpected redirect (HTTP " + response.status() + ")", null, response.status(), response.headers(), null);
          if (declaredLength(response) > maxResponseBytes) throw tooLarge(response);
          body = Timeouts.readAll(response.body(), maxResponseBytes, remaining(current.timeout(), started));
        } catch (IOException failure) {
          throw transportError(failure);
        }
      } catch (TransportException failure) {
        if (canRetry(call, attempt) && !Thread.currentThread().isInterrupted()) {
          pauseWithinBudget(retryDelay(attempt, ThreadLocalRandom.current().nextDouble()), remainingBudget);
          continue;
        }
        throw failure;
      }
      if (remainingBudget != null) decisionTimeLeft(remainingBudget);
      if (body == null) throw tooLarge(response);
      Reply reply = parse(response, body);
      if (reply.status() >= 200 && reply.status() < 300) return reply;
      ApiException error = error(reply);
      if (canRetry(call, attempt) && error.isRetryable()) {
        Duration wait = error.getRetryAfter().isPresent() ? error.getRetryAfter().get() : retryDelay(attempt, ThreadLocalRandom.current().nextDouble());
        if (wait.compareTo(RETRY_AFTER_MAX) <= 0) {
          pauseWithinBudget(wait, remainingBudget);
          continue;
        }
      }
      throw error;
    }
  }

  private static long decisionTimeLeft(java.util.function.LongSupplier remainingBudget) {
    long left = remainingBudget.getAsLong();
    if (left <= 0) throw new RequestTimeoutException("Decision deadline expired", null);
    return left;
  }

  private void pauseWithinBudget(Duration delay, java.util.function.LongSupplier remainingBudget) {
    if (remainingBudget != null) {
      Duration left = Duration.ofNanos(decisionTimeLeft(remainingBudget));
      if (left.compareTo(delay) < 0) delay = left;
    }
    pause(delay);
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
   * The error for a non-2xx reply: the API's code, message, details and request ID (the {@code
   * X-Request-Id} header, else the body's {@code requestId}), or {@link ErrorCodes#SDK_HTTP_ERROR} when the body carries no code.
   */
  private static ApiException error(Reply reply) {
    String code = errorCode(reply.json());
    if (code == null) return new ApiException(ErrorCodes.SDK_HTTP_ERROR, "HTTP " + reply.status(), null, reply.status(), reply.headers(), null);
    JsonObject failure = reply.json().getAsJsonObject();
    Map<String, Object> details = new LinkedHashMap<>();
    if (failure.has("details") && failure.get("details").isJsonObject())
      details.putAll(Json.GSON.fromJson(failure.get("details"), new TypeToken<Map<String, Object>>() {}.getType()));
    String requestId = failure.get("requestId") instanceof JsonPrimitive id && id.isString() ? id.getAsString() : null;
    String message = failure.get("message") instanceof JsonPrimitive text && text.isString() ? text.getAsString() : code;
    return new ApiException(code, message, details, reply.status(), reply.headers(), requestId, null);
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

  /** A MIME type lower-cased, without parameters and trimmed, as the API compares upload types. */
  private static String normalizeUploadMimeType(String type) {
    String lower = type.toLowerCase(Locale.ROOT);
    String mime = lower.split(";", -1)[0].strip();
    return mime.isEmpty() ? lower.strip() : mime;
  }

  /**
   * Whether the API accepts an upload of this MIME type: an image, audio, video, text, document or
   * website type, not a container such as {@code application/octet-stream}. It refuses any other
   * type with {@code upload/unsupported-type}.
   */
  static boolean isAcceptedUploadMimeType(String type) {
    String mime = normalizeUploadMimeType(type);
    if (UploadMimeTypes.REJECTED.contains(mime)) return false;
    return UploadMimeTypes.PREFIXES.stream().anyMatch(mime::startsWith) || UploadMimeTypes.SUFFIXES.stream().anyMatch(mime::endsWith)
        || UploadMimeTypes.TYPES.contains(mime);
  }

  /** The API's message for an upload type it refuses. */
  static String rejectedUploadMimeTypeMessage(String type) {
    return normalizeUploadMimeType(type) + " is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens"
        + " can store and process, such as image/png, image/jpeg, application/pdf, or text/plain.";
  }

  private static void checkMimeType(String type) {
    if (!isAcceptedUploadMimeType(type))
      throw new CalmLensException(ErrorCodes.UNSUPPORTED_UPLOAD_TYPE, rejectedUploadMimeTypeMessage(type), Map.of("mimeType", type, "source", "calmlens"), null);
  }

  /**
   * Refuses, before anything is sent, a multipart part under 5 MiB that is not the last and, for
   * images, a first part over 20 MiB. A stream of unknown length is left to the API.
   */
  private void checkPartSize(long size, boolean last, boolean firstImagePart) {
    if (deferUploadChecks || size < 0) return;
    if (firstImagePart && size > MULTIPART_IMAGE_LIMIT_BYTES) throw multipartImageTooLarge();
    if (!last && size < MULTIPART_MIN_PART_BYTES)
      throw payloadError("Multipart upload parts must be at least 5MiB except the final part.");
  }

  /**
   * Refuses, before anything is sent, content whose known size is over the API's limit for its
   * type. In one request, images can be up to 10 MiB (larger ones are uploaded in parts), audio and
   * video up to 50 MiB and other files up to 5,000 MiB. Sent in parts ({@code inParts}), audio and
   * video can be up to 2 GiB; the API holds free uploads, made before billing is set up, to 50 MiB
   * itself. Images in parts are checked apart. A stream of unknown length is left to the API.
   */
  private void checkUploadSize(long size, String mime, boolean inParts) {
    if (deferUploadChecks || size < 0) return;
    long limit;
    String message;
    if (mime.startsWith("image/")) {
      limit = 10L * 1024 * 1024;
      message = "Images uploaded in one request can be at most 10 MiB; upload larger images in parts";
    } else if (mime.startsWith("audio/") || mime.startsWith("video/")) {
      limit = (inParts ? 2048L : 50L) * 1024 * 1024;
      message = "Audio and video files can be at most 50 MiB in one request, or 2 GiB in parts";
    } else {
      limit = 5000L * 1024 * 1024;
      message = "Files can be at most 5,000 MiB";
    }
    if (size > limit) throw uploadTooLarge(limit, message);
  }

  /** Images sent in parts total at most 20 MiB. */
  private static final long MULTIPART_IMAGE_LIMIT_BYTES = 20L * 1024 * 1024;

  /** {@code upload/too-large} for the plan's limit, with the details the API sends. */
  private static CalmLensException uploadTooLarge(long limitBytes, String message) {
    return new CalmLensException(ErrorCodes.UPLOAD_TOO_LARGE, message, Map.of("limitBytes", limitBytes, "source", "plan"), null);
  }

  private static CalmLensException multipartImageTooLarge() {
    return uploadTooLarge(MULTIPART_IMAGE_LIMIT_BYTES, "Multipart image uploads cannot exceed 20 MiB.");
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

  /**
   * Sends an upload: text keeps the API deadline, binary content uses the upload deadline. A null
   * {@code mode} is a JSON body, without {@code X-CalmLens-Upload}.
   */
  private Reply upload(String path, JsonObject query, Transport.Body body, String contentType, String mode, String key, boolean text) {
    Map<String, String> headers = baseHeaders("application/json");
    if (contentType != null) headers.put("Content-Type", contentType);
    if (mode != null) headers.put("X-CalmLens-Upload", mode);
    headers.put("Idempotency-Key", idempotencyKey(key));
    return execute(new Call("POST", baseUrl + path + query(query), headers, body, text ? timeout : uploadTimeout, true));
  }

  /** Uploads an asset; {@code wait} says whether the API waits for the decision before answering. */
  private Models.Asset submit(Models.SubmitAsset options, boolean wait, String key) {
    JsonObject o = Models.encode(options);
    if (List.of("content", "part", "url").stream().noneMatch(k -> o.has(k) && !o.get(k).isJsonNull()))
      throw payloadError("Either file content, URL, or multipart part is required");
    if (str(o, "name", "").isEmpty()) throw payloadError("Asset name is required");
    if (List.of("content", "part", "url").stream().filter(k -> o.has(k) && !o.get(k).isJsonNull()).count() != 1)
      throw payloadError("Supply exactly one of content, part, or url");
    if (options.contextValue() != null) {
      // Only the posts CalmLens uses are sent, which keeps the upload's options small.
      List<Models.ModerationContextItem> items = Models.selectModerationContextItems(options.contextValue().items());
      o.add("context", Json.GSON.toJsonTree(new Models.ModerationContext(items)));
    }
    JsonObject query = new JsonObject();
    query.addProperty("wait", wait);
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
    boolean text = encoded.has("plainText") && !encoded.get("plainText").isJsonNull();
    String mime = type.strip().toLowerCase(Locale.ROOT);
    // Content the client can read again is sent in parts when it is larger than one part.
    boolean split = !multipart && !text && body.replayable() && body.length() > partSizeBytes;
    if (split) {
      if (key != null && key.length() > MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH)
        throw argument("An idempotency key can be at most " + MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH + " characters for an upload sent in parts");
      if (!mime.startsWith("image/")) checkUploadSize(body.length(), mime, true);
      else if (!deferUploadChecks && body.length() > MULTIPART_IMAGE_LIMIT_BYTES) throw multipartImageTooLarge();
    } else if (multipart) {
      checkPartSize(body.length(), flag(encoded, "isFinal"), mime.startsWith("image/"));
      // A declared whole-file size over the limit for parts can never finish.
      if (!mime.startsWith("image/") && o.has("totalSizeInBytes") && !o.get("totalSizeInBytes").isJsonNull())
        checkUploadSize(o.get("totalSizeInBytes").getAsLong(), mime, true);
    } else checkUploadSize(body.length(), mime, false);
    // The asset's fields go in the body, never the query, which proxies and servers log.
    JsonObject fields = UploadForm.fields(o);
    if (text) {
      JsonObject json = fields.deepCopy();
      JsonObject plain = new JsonObject();
      plain.add("plainText", encoded.get("plainText"));
      plain.addProperty("type", type);
      if (multipart) {
        if (encoded.has("partNumber") && !encoded.get("partNumber").isJsonNull()) plain.add("partNumber", encoded.get("partNumber"));
        plain.addProperty("isFinal", flag(encoded, "isFinal"));
        json.add("part", plain);
        for (String k : List.of("sizeInBytes", "totalSizeInBytes"))
          if (o.has(k) && !o.get(k).isJsonNull()) json.add(k, o.get(k));
      } else json.add("content", plain);
      Transport.Body jsonBody = Transport.Body.ofBytes(Json.write(json).getBytes(StandardCharsets.UTF_8));
      return decode(upload(project("assets"), query, jsonBody, "application/json", null, key, true), Models.Asset.class);
    }
    query.addProperty("contentType", type);
    if (split) return uploadInParts(fields, query, body, type, key);
    if (body.length() >= 0) query.addProperty("sizeInBytes", body.length());
    if (multipart) {
      query.addProperty("partNumber", 1);
      query.addProperty("isFinal", flag(encoded, "isFinal"));
      if (o.has("totalSizeInBytes") && !o.get("totalSizeInBytes").isJsonNull()) query.add("totalSizeInBytes", o.get("totalSizeInBytes"));
    }
    UploadForm.Built form = UploadForm.build(fields, type, body);
    return decode(upload(project("assets"), query, form.body(), form.contentType(), multipart ? "part" : "content", key, false), Models.Asset.class);
  }

  /**
   * Uploads {@code body} as a multipart upload of {@code partSizeBytes} parts and returns the final
   * part's asset. Part 1 carries the upload's fields and {@code key}; part {@code n} after it
   * carries {@code <key>:part-<n>}, so each is retried on its own and repeating the call with the
   * same key replays the parts the API already has and sends the rest.
   */
  private Models.Asset uploadInParts(JsonObject fields, JsonObject query, Transport.Body body, String type, String key) {
    String base = idempotencyKey(key);
    long total = body.length();
    long count = (total + partSizeBytes - 1) / partSizeBytes;
    Transport.Body first = body.slice(0, partSizeBytes);
    query.addProperty("sizeInBytes", first.length());
    query.addProperty("partNumber", 1);
    query.addProperty("isFinal", false);
    query.addProperty("totalSizeInBytes", total);
    UploadForm.Built form = UploadForm.build(fields, type, first);
    Models.Asset asset = decode(upload(project("assets"), query, form.body(), form.contentType(), "part", base, false), Models.Asset.class);
    String path = "/assets/" + id(asset.id()) + "/part";
    for (long number = 2; number <= count; ) {
      boolean last = number == count;
      long offset = (number - 1) * partSizeBytes;
      Transport.Body part = body.slice(offset, Math.min(partSizeBytes, total - offset));
      JsonObject partQuery = new JsonObject();
      partQuery.addProperty("partNumber", number);
      partQuery.addProperty("isFinal", last);
      partQuery.addProperty("sizeInBytes", part.length());
      try {
        asset = decode(upload(path, partQuery, part, null, "part", base + ":part-" + number, false), Models.Asset.class);
      } catch (ApiException error) {
        Object expected = error.getDetails().get("expectedPartNumber");
        if (ErrorCodes.INVALID_UPLOAD_PART_NUMBER.equals(error.getCode()) && expected instanceof Number n
            && n.doubleValue() == Math.rint(n.doubleValue()) && n.longValue() > number && n.longValue() <= count) {
          // The parts before the expected one arrived, but their responses were lost.
          number = n.longValue();
          continue;
        }
        // The final part completed the upload, but its response was lost.
        if (last && ErrorCodes.UPLOAD_NOT_OPEN.equals(error.getCode())) return assets.retrieve(new Models.AssetId(asset.id()));
        throw error;
      }
      number++;
    }
    return asset;
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
    if (o.has("wait")) query.add("wait", o.get("wait"));
    query.add("partNumber", part.get("partNumber"));
    query.addProperty("isFinal", flag(part, "isFinal"));
    if (body.length() >= 0) query.addProperty("sizeInBytes", body.length());
    boolean text = part.has("plainText") && !part.get("plainText").isJsonNull();
    return decode(upload(path, query, body, null, "part", key, text), Models.Asset.class);
  }

  /**
   * Every item of a cursor list from the options' cursor on: {@code list} fetches the page for a
   * cursor (null for the options' own), and pages follow {@code nextCursor} while {@code hasMore}.
   */
  private static <T> AutoPager<T> pages(JsonObject options, java.util.function.Function<String, ? extends Models.CursorPage<T>> list) {
    String first = options.has("cursor") && !options.get("cursor").isJsonNull() ? options.get("cursor").getAsString() : null;
    return new AutoPager<>(token -> {
      Models.CursorPage<T> page = list.apply(token);
      boolean more = page.hasMore() && page.nextCursor() != null && !page.items().isEmpty();
      return new AutoPager.Chunk<>(page.items(), more ? page.nextCursor() : null, more);
    }, first, false);
  }

  /** A GET of one cursor page at {@code path} with {@code query}, the cursor set when not null. */
  private <P> P page(String path, JsonObject query, String cursor, Class<P> type) {
    JsonObject sent = query.deepCopy();
    if (cursor != null) sent.addProperty("cursor", cursor);
    return decode(json("GET", path, sent, null), type);
  }

  /** Assets: uploads, moderation, listing and management. */
  public final class Assets {
    private Assets() {}

    /**
     * Uploads an asset and returns without waiting for its decision ({@code wait=false}): its
     * {@code classification.status} is {@code queued} ({@code uploading} for the first part of a
     * multipart upload). The upload carries an {@code Idempotency-Key}, so it is retried safely.
     *
     * <p>Content larger than {@link Builder#partSizeBytes(long)} (bytes, base64 or a file) is sent
     * as a multipart upload in parts of that size, each retried on its own; calling again with the
     * same idempotency key (at most 240 characters) resumes an interrupted upload. The same applies
     * to {@code classify}.
     *
     * @param options name and content, part or url
     * @return the new asset
     */
    public Models.Asset create(Models.SubmitAsset options) { return submit(options, false, null); }

    /**
     * @param options name and content, part or url
     * @param requestOptions idempotency key, deadlines and retries for this call
     * @return the new asset
     */
    public Models.Asset create(Models.SubmitAsset options, RequestOptions requestOptions) { return with(requestOptions).submit(options, false, key(requestOptions)); }

    /**
     * Uploads bytes and returns without waiting for their decision.
     *
     * @param name asset name
     * @param bytes content
     * @param mimeType MIME type, such as {@code image/png}
     * @return the new asset
     */
    public Models.Asset create(String name, byte[] bytes, String mimeType) { return create(new Models.SubmitAsset(name, Models.Content.bytes(bytes, mimeType))); }

    /**
     * Uploads an asset and waits for its moderation decision ({@code wait=true}).
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
      return with(requestOptions).submit(options, true, key(requestOptions));
    }

    /** @param options search query @return matches, best first */
    public Models.AssetSearchResponse search(Models.SearchAssets options) {
      return decode(json("GET", project("assets/search"), Models.encode(options), null), Models.AssetSearchResponse.class);
    }

    /**
     * Lists one page of the project's assets, newest first unless {@code sort} says otherwise. Pass
     * {@code filter("folderId==fldr_...")} for one folder's assets.
     *
     * @param options page, filter and sort
     * @return one page of assets
     */
    public Models.AssetPage list(Models.ListAssets options) {
      return decode(json("GET", project("assets"), Models.encode(options), null), Models.AssetPage.class);
    }

    /**
     * Iterates over every matching asset, page by page, from the supplied cursor.
     *
     * @param options page size, filter and sort
     * @return a lazy iterable
     */
    public AutoPager<Models.Asset> iterate(Models.ListAssets options) {
      JsonObject o = Models.encode(options);
      return pages(o, cursor -> page(project("assets"), o, cursor, Models.AssetPage.class));
    }

    /** @param options the asset @return the asset */
    public Models.Asset retrieve(Models.AssetId options) {
      return decode(json("GET", "/assets/" + id(str(Models.encode(options), "assetId", null)), null, null), Models.Asset.class);
    }

    /**
     * Retrieves the asset until it is settled, its {@code classification.status} {@code completed}
     * (with its decision in {@code classification.moderation.status}) or {@code failed}, and
     * returns it. A {@code queued} or {@code processing} asset is still waiting, even when a
     * reviewer has already decided it. It waits 0.5 seconds before the second check and 1.5 times
     * longer each time after that, up to 2 seconds, never past the timeout (60 seconds by default).
     * Webhooks report decisions without polling.
     *
     * @param options the asset and timeout
     * @return the settled asset
     * @throws CalmLensException {@link ErrorCodes#SDK_TIMEOUT} when the timeout passes before the
     *     asset is settled, with {@code assetId} and the last {@code classificationStatus} and {@code
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
      long budget = limitNanos;
      java.util.function.LongSupplier timeLeft = () -> budget - (nanoTime.getAsLong() - started);
      String path = baseUrl + "/assets/" + id(assetId);
      Call lookup = new Call("GET", path, baseHeaders("application/json"), null, timeout, true);
      Models.Asset last = null;
      long delay = DECISION_POLL_FIRST_DELAY.toNanos();
      for (;;) {
        if (Thread.currentThread().isInterrupted())
          throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for a decision");
        Models.Asset asset;
        try {
          asset = decode(execute(lookup, limit.isZero() ? null : timeLeft), Models.Asset.class);
        } catch (RequestTimeoutException failure) {
          if (limit.isZero() || timeLeft.getAsLong() > 0) throw failure;
          break;
        }
        long remaining = timeLeft.getAsLong();
        if (!limit.isZero() && remaining <= 0) break;
        if (isSettled(asset)) return asset;
        last = asset;
        if (remaining <= 0) break;
        try {
          sleeper.sleep(Duration.ofNanos(Math.min(delay, remaining)));
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw new CalmLensException(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for a decision", interrupted);
        }
        delay = Math.min(DECISION_POLL_MAX_DELAY.toNanos(), Math.round(delay * DECISION_POLL_DELAY_FACTOR));
      }
      Map<String, Object> details = new LinkedHashMap<>();
      details.put("assetId", assetId);
      details.put("classificationStatus", last == null ? null : last.classification().status().value());
      details.put("moderationStatus", last == null ? null : last.classification().moderation().status().value());
      throw new CalmLensException(ErrorCodes.SDK_TIMEOUT, "Asset " + assetId + " did not settle within " + limit, details, null);
    }

    /** Whether the asset is settled: its {@code classification.status} is {@code completed} or {@code failed}. */
    private static boolean isSettled(Models.Asset asset) {
      Models.AssetClassificationStatus status = asset.classification().status();
      return Models.AssetClassificationStatus.COMPLETED.equals(status) || Models.AssetClassificationStatus.FAILED.equals(status);
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
     * Records a reviewer's decision: the moderation status becomes {@code decision}, a manual review
     * with the note is added to {@code classification.moderation.manualReviews}, and an
     * {@code asset.<status>} event is recorded. An asset still pending moderation can only be blocked
     * or purged; purging deletes the stored content and needs the {@code assets:delete} permission.
     *
     * @param options the asset, decision and note
     * @return the asset
     */
    public Models.Asset decide(Models.DecideAsset options) {
      JsonObject o = Models.encode(options);
      return decode(json("POST", "/assets/" + id(str(o, "assetId", null)) + "/decision", null, without(o, "assetId")), Models.Asset.class);
    }

    /**
     * Completes the policy evidence behind a decided asset's moderation decision: the report's
     * {@code classification.moderation.explanationComplete} becomes {@code true} and every action stays as
     * decided. With {@code rerun} the asset is moderated again with the project's current policy,
     * and an {@code asset.rerun-requested} event is recorded; use it when the policy changed since
     * the decision ({@code asset/policy-changed}). The asset returns unchanged: it keeps its
     * decision until the re-run's is stored, reported by {@code asset.classified} and {@code
     * asset.<status>} events, and a failed re-run keeps it. A reviewed asset fails with {@code
     * asset/reviewed}, and one whose content is gone with {@code asset/content-unavailable}.
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
    public Models.Asset removeContent(Models.AssetId options) {
      return decode(json("DELETE", "/assets/" + id(str(Models.encode(options), "assetId", null)) + "/content", null, null), Models.Asset.class);
    }

    /**
     * Permanently deletes the asset record, its report and its stored content. An asset extracted
     * from another (one with a {@code parentId}) fails with {@code asset/child-not-deletable}:
     * delete its parent instead.
     *
     * @param options the asset
     */
    public void delete(Models.AssetId options) {
      success(json("DELETE", "/assets/" + id(str(Models.encode(options), "assetId", null)), null, null));
    }

    /**
     * Deletes up to 500 assets ({@link Models.AssetBatchOperation#DELETE}) or removes their stored
     * content ({@link Models.AssetBatchOperation#REMOVE_CONTENT}) in one request. Every asset must
     * exist in the project and the key needs {@code assets:delete} for its folder, and a deletion
     * can't name an asset extracted from another ({@code asset/child-not-deletable}), or nothing is
     * queued. The work runs in the background and records {@code asset.deleted} or
     * {@code asset.content-removed} for each asset, with a {@code batch-id} fact naming the
     * response's {@code batchId}; assets under a safety hold are skipped. Not retried: it carries
     * no {@code Idempotency-Key}.
     *
     * @param options the asset IDs and the operation
     * @return the batch's ID, status and asset count
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

    /**
     * Lists one page of an audio or video asset's findings timeline, in time order.
     * {@code classification.moderation.timeline.segmentCount} says how many segments there are.
     *
     * @param options the asset and page
     * @return one page of timeline segments
     */
    public Models.AssetTimelinePage listTimeline(Models.ListTimeline options) {
      JsonObject o = Models.encode(options);
      JsonObject query = new JsonObject();
      without(o, "assetId").entrySet().forEach(entry -> query.add(entry.getKey(), entry.getValue()));
      return decode(json("GET", project("assets/" + id(str(o, "assetId", null)) + "/timeline"), query, null), Models.AssetTimelinePage.class);
    }

    /** @param options the parent asset, page size and sort @return a lazy iterable over every child */
    public AutoPager<Models.Asset> iterateChildren(Models.ListChildren options) {
      JsonObject o = Models.encode(options);
      String path = "/assets/" + id(str(o, "assetId", null)) + "/children";
      JsonObject query = without(o, "assetId");
      return pages(query, cursor -> page(path, query, cursor, Models.AssetPage.class));
    }

    /**
     * Iterates over every segment of an audio or video asset's findings timeline, in time order.
     *
     * @param options the asset and page size
     * @return a lazy iterable over every segment
     */
    public AutoPager<Models.MediaClassificationSegment> iterateTimeline(Models.ListTimeline options) {
      JsonObject o = Models.encode(options);
      String path = project("assets/" + id(str(o, "assetId", null)) + "/timeline");
      JsonObject query = without(o, "assetId");
      return pages(query, cursor -> page(path, query, cursor, Models.AssetTimelinePage.class));
    }

    /**
     * Sends a later part of a multipart upload. Whether the final part waits for the decision was
     * chosen when the upload started; {@link Models.UploadPart#wait(Boolean)} overrides it.
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
        throw argument("Text to classify must be a non-empty string");
      return assets.classify(options.toSubmitAsset(), requestOptions);
    }
  }

  /** {@code client.uploadTokens}: tokens that let a browser upload through an upload preset. */
  public final class UploadTokens {
    private UploadTokens() {}

    /**
     * Signs a single-use upload token with this client's API key. Makes no request.
     *
     * @param options the preset, optional external ID and lifetime ({@code expiresIn}, 1 to 3600 seconds, default 600)
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
    int ttl = options.expiresInValue() == null ? DEFAULT_UPLOAD_TOKEN_EXPIRES_IN_SECONDS : options.expiresInValue();
    if (ttl < 1 || ttl > 3600) throw argument("expiresIn must be a whole number from 1 to 3600");
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

    /**
     * Lists one page of child folders (the project root without {@code parentId}), searches folder
     * names, or resolves the paths of {@code ids}. Pass the page's {@code nextCursor} as {@code cursor}
     * for the next page.
     *
     * @param options parent, cursor, page size, sort and search
     * @return one folder page
     */
    public Models.FolderPage list(Models.ListFolders options) {
      Reply reply = json("GET", project("folders"), Models.encode(options), null);
      JsonObject page = object(reply);
      if (!page.has("items") || !page.get("items").isJsonArray() || !page.has("ancestors") || !page.get("ancestors").isJsonArray() || !page.has("hasMore") || !page.get("hasMore").isJsonPrimitive() || !page.get("hasMore").getAsJsonPrimitive().isBoolean())
        throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Expected a folder page", null, reply.status(), reply.headers(), null);
      return decode(reply, Models.FolderPage.class);
    }

    /**
     * Iterates over every child folder of {@code parentId} (or the project root), fetching pages as
     * needed.
     *
     * @param options parent, page size, sort and search
     * @return a lazy iterable over every folder
     */
    public AutoPager<Models.Folder> iterate(Models.ListFolders options) {
      JsonObject o = Models.encode(options);
      return pages(o, cursor -> page(project("folders"), o, cursor, Models.FolderPage.class));
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

    /** @param options cursor, page size and sort @return one page of the project's hash lists, newest first unless {@code sort} says otherwise */
    public Models.HashListPage list(Models.ListHashLists options) {
      return decode(json("GET", project("hash-lists"), Models.encode(options), null), Models.HashListPage.class);
    }

    /** @return the first page of the project's hash lists */
    public Models.HashListPage list() { return list(new Models.ListHashLists()); }

    /** @param options page size and sort @return a lazy iterable over every hash list */
    public AutoPager<Models.HashList> iterate(Models.ListHashLists options) {
      JsonObject o = Models.encode(options);
      return pages(o, cursor -> page(project("hash-lists"), o, cursor, Models.HashListPage.class));
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

    /** @param options the hash list, cursor, page size and sort @return one page of entries, newest first unless {@code sort} says otherwise */
    public Models.HashListEntryPage listEntries(Models.ListHashListEntries options) {
      JsonObject o = Models.encode(options);
      return decode(json("GET", "/hash-lists/" + id(str(o, "hashListId", null)) + "/entries", without(o, "hashListId"), null), Models.HashListEntryPage.class);
    }

    /** @param options the hash list, page size and sort @return a lazy iterable over every entry of the list */
    public AutoPager<Models.HashListEntry> iterateEntries(Models.ListHashListEntries options) {
      JsonObject o = Models.encode(options);
      String path = "/hash-lists/" + id(str(o, "hashListId", null)) + "/entries";
      JsonObject query = without(o, "hashListId");
      return pages(query, cursor -> page(path, query, cursor, Models.HashListEntryPage.class));
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

  /**
   * Moderation policies belong to the organisation and its projects share them. Every change sends
   * the policy's {@code revision}, so a policy changed since is refused with {@code
   * policy/revision-conflict}. Through a project's key you can change only policies no other
   * project uses.
   */
  public final class Policies {
    private Policies() {}

    private String policyPath(JsonObject o) { return "/policies/" + id(str(o, "policyId", null)); }

    /**
     * Lists one page of the organisation's policies, oldest first unless {@code sort} says
     * otherwise. {@link #retrieveAssigned()} says which one the project uses.
     *
     * @param options cursor, page size and sort
     * @return one page of policies
     */
    public Models.PolicyPage list(Models.ListPolicies options) {
      return decode(json("GET", "/policies", Models.encode(options), null), Models.PolicyPage.class);
    }

    /** @return the first page of the organisation's policies, oldest first */
    public Models.PolicyPage list() { return list(new Models.ListPolicies()); }

    /** @param options page size and sort @return a lazy iterable over every policy of the organisation */
    public AutoPager<Models.Policy> iterate(Models.ListPolicies options) {
      JsonObject o = Models.encode(options);
      return pages(o, cursor -> page("/policies", o, cursor, Models.PolicyPage.class));
    }

    /** @param options the policy @return the policy */
    public Models.Policy retrieve(Models.PolicyId options) {
      return decode(json("GET", policyPath(Models.encode(options)), null, null), Models.Policy.class);
    }

    /**
     * Creates a policy from {@code settings}, or a copy of a built-in preset with {@code presetId}.
     * It moderates nothing until it is assigned to a project or named on an upload preset.
     *
     * @param options settings and a name, or a preset
     * @return the new policy
     */
    public Models.Policy create(Models.CreatePolicy options) {
      return decode(json("POST", "/policies", null, Models.encode(options)), Models.Policy.class);
    }

    /**
     * Changes the name, description or settings; later moderation uses them. Saving a {@code live}
     * policy pins it under the same ID.
     *
     * @param options the policy, its revision and the fields to change
     * @return the saved policy
     */
    public Models.Policy update(Models.UpdatePolicy options) {
      JsonObject o = Models.encode(options);
      return decode(json("PATCH", policyPath(o), null, without(o, "policyId")), Models.Policy.class);
    }

    /**
     * Restores the settings of the preset release a {@code pinned} or {@code copy} policy is at,
     * discarding its edits.
     *
     * @param options the policy, its revision and the {@code preset.version} you reviewed
     * @return the saved policy
     */
    public Models.Policy reset(Models.ResetPolicy options) {
      JsonObject o = Models.encode(options);
      return decode(json("POST", policyPath(o) + "/reset", null, without(o, "policyId")), Models.Policy.class);
    }

    /**
     * Moves a {@code pinned} or {@code copy} policy whose settings are unchanged from its preset
     * release to the latest release of the preset.
     *
     * @param options the policy, its revision and the {@code preset.latestVersion} you reviewed
     * @return the saved policy
     */
    public Models.Policy upgrade(Models.UpgradePolicy options) {
      JsonObject o = Models.encode(options);
      return decode(json("POST", policyPath(o) + "/upgrade", null, without(o, "policyId")), Models.Policy.class);
    }

    /**
     * Switches automatic updates on ({@code live}) or off ({@code pinned}) for the organisation's
     * own preset policy.
     *
     * @param options the policy, whether it follows the preset, its revision and the preset version
     * @return the saved policy
     */
    public Models.Policy setAutomaticUpdates(Models.SetPolicyAutomaticUpdates options) {
      JsonObject o = Models.encode(options);
      return decode(json("PUT", policyPath(o) + "/automatic-updates", null, without(o, "policyId")), Models.Policy.class);
    }

    /** Deletes a policy that no project or upload preset uses. @param options the policy */
    public void delete(Models.PolicyId options) {
      success(json("DELETE", policyPath(Models.encode(options)), null, null));
    }

    /** @return the policy the project moderates with */
    public Models.Policy retrieveAssigned() {
      return decode(json("GET", project("policy"), null, null), Models.Policy.class);
    }

    /** Chooses the policy the project moderates with. @param options the policy @return the policy */
    public Models.Policy assign(Models.PolicyId options) {
      return decode(json("PUT", project("policy"), null, Models.encode(options)), Models.Policy.class);
    }
  }

  /**
   * The project's upload presets: the rules for uploads from browsers and apps. {@link #ensure}
   * creates or replaces presets by key, for deploys that declare them in code; send each preset's
   * {@code revision} to refuse a change made since you read it.
   */
  public final class UploadPresets {
    private UploadPresets() {}

    /** @param options cursor, page size and sort @return one page of the project's upload presets, oldest first unless {@code sort} says otherwise */
    public Models.UploadPresetPage list(Models.ListUploadPresets options) {
      return decode(json("GET", project("upload-presets"), Models.encode(options), null), Models.UploadPresetPage.class);
    }

    /** @return the first page of the project's upload presets, oldest first */
    public Models.UploadPresetPage list() { return list(new Models.ListUploadPresets()); }

    /** @param options page size and sort @return a lazy iterable over every upload preset of the project */
    public AutoPager<Models.UploadPreset> iterate(Models.ListUploadPresets options) {
      JsonObject o = Models.encode(options);
      return pages(o, cursor -> page(project("upload-presets"), o, cursor, Models.UploadPresetPage.class));
    }

    /**
     * Creates each preset, or replaces it with the definition sent, by key. Every preset is checked
     * before any is saved; an unchanged preset keeps its revision.
     *
     * @param options the preset definitions
     * @return the stored presets, in the order sent
     */
    public Models.EnsureUploadPresetsResponse ensure(Models.EnsureUploadPresets options) {
      return decode(json("PUT", project("upload-presets"), null, Models.encode(options)), Models.EnsureUploadPresetsResponse.class);
    }

    /** Deletes an upload preset; assets already uploaded through it stay. @param options the upload preset */
    public void delete(Models.UploadPresetId options) {
      success(json("DELETE", "/upload-presets/" + id(str(Models.encode(options), "uploadPresetId", null)), null, null));
    }
  }

  /**
   * The project's settings, with defaults filled in. {@link #update} replaces them: settings left
   * out return to their defaults. Send the {@code revision} you read to refuse a change made since.
   */
  public final class ProjectSettings {
    private ProjectSettings() {}

    /** @return the project's settings and their revision */
    public Models.ProjectSettingsResource get() {
      return decode(json("GET", project("settings"), null, null), Models.ProjectSettingsResource.class);
    }

    /** @param options the complete settings and, optionally, the revision you read @return the saved settings */
    public Models.ProjectSettingsResource update(Models.UpdateProjectSettings options) {
      return decode(json("PUT", project("settings"), null, Models.encode(options)), Models.ProjectSettingsResource.class);
    }
  }

  /**
   * The project's metadata fields. They share the project settings' {@code revision}; {@link
   * #ensure} creates or replaces fields by ID and keeps the others.
   */
  public final class MetadataFields {
    private MetadataFields() {}

    /** @return the project's metadata fields and their revision */
    public Models.MetadataFieldsResource list() {
      return decode(json("GET", project("metadata-fields"), null, null), Models.MetadataFieldsResource.class);
    }

    /** @param options the fields to create or replace and, optionally, the revision you read @return every field after the change */
    public Models.MetadataFieldsResource ensure(Models.EnsureMetadataFields options) {
      return decode(json("PUT", project("metadata-fields"), null, Models.encode(options)), Models.MetadataFieldsResource.class);
    }

    /** Deletes a field definition; assets keep their values. @param options the field and, optionally, the revision you read */
    public void delete(Models.DeleteMetadataField options) {
      JsonObject o = Models.encode(options);
      success(json("DELETE", project("metadata-fields/" + id(str(o, "fieldId", null))), without(o, "fieldId"), null));
    }
  }

  /** The events feed. Prefer webhooks in production. */
  public final class Events {
    private Events() {}

    /** The query for {@code options}: the API takes {@code types} as one comma-separated value. */
    private JsonObject eventsQuery(Models.ListEvents options) {
      JsonObject query = Models.encode(options);
      query.remove("types");
      List<String> types = options.typesValue();
      if (types != null && !types.isEmpty()) query.addProperty("types", String.join(",", types));
      return query;
    }

    /**
     * Lists events after a cursor. Without {@code cursor} it returns no events and a
     * {@code nextCursor} for the current time. {@code types} and {@code assetId} narrow the feed to
     * some event types or one asset's events; pass the same filters with each {@code cursor}.
     *
     * @param options cursor, page size and filters
     * @return one page of events
     */
    public Models.EventsPage list(Models.ListEvents options) {
      return decode(json("GET", project("events"), eventsQuery(options), null), Models.EventsPage.class);
    }

    /**
     * Yields pages of events after {@code cursor} until no more are waiting, like the JavaScript
     * SDK's {@code events.pages}. Save each page's {@code nextCursor()} after handling it to resume
     * later. Without {@code cursor}, it yields one empty page whose cursor is "now". Each page keeps
     * the filters of {@code options}.
     *
     * @param options cursor, page size and filters
     * @return a lazy iterable of pages
     */
    public AutoPager<Models.EventsPage> pages(Models.ListEvents options) {
      JsonObject o = eventsQuery(options);
      return new AutoPager<>(token -> {
        JsonObject query = o.deepCopy();
        if (token != null) query.addProperty("cursor", token);
        Models.EventsPage page = decode(json("GET", project("events"), query, null), Models.EventsPage.class);
        if (page.nextCursor() == null || page.nextCursor().isEmpty())
          throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "Events page has no nextCursor", null, 200, Map.of(), null);
        return new AutoPager.Chunk<>(List.of(page), page.nextCursor(), page.hasMore());
      }, str(o, "cursor", null), true);
    }
  }


  /**
   * The asset segment of an asset URL: the path-encoded asset ID, or {@code ext:} and the
   * URL-encoded external ID. Exactly one of them must be given.
   */
  private static String assetSegment(JsonObject o) {
    boolean byId = o.has("assetId") && !o.get("assetId").isJsonNull();
    boolean byExternalId = o.has("externalId") && !o.get("externalId").isJsonNull();
    if (byId == byExternalId) throw argument("Pass either assetId or externalId");
    if (byId) return id(o.get("assetId").getAsString());
    String externalId = o.get("externalId").getAsString();
    if (externalId.isEmpty()) throw argument("externalId is required");
    return EXTERNAL_ID_SEGMENT_PREFIX + encodeComponent(externalId);
  }

  /**
   * The {@code ?viewerClaims=} query of a URL with these claims, or an empty string for the
   * defaults: no region and no age confirmation are left out, so default URLs stay cacheable. The
   * claims are an object of only a viewer country {@code region} and a boolean {@code ageConfirmed}.
   */
  private static String viewerClaimsQuery(JsonElement claims) {
    if (claims == null || claims.isJsonNull()) return "";
    if (!claims.isJsonObject()) throw argument("viewerClaims must be an object");
    JsonObject given = claims.getAsJsonObject();
    for (String key : given.keySet())
      if (!key.equals("region") && !key.equals("ageConfirmed")) throw argument("viewerClaims has only region and ageConfirmed, not " + key);
    JsonElement region = given.get("region"), ageConfirmed = given.get("ageConfirmed");
    JsonObject sent = new JsonObject();
    if (region != null && !region.isJsonNull()) {
      if (!(region.isJsonPrimitive() && region.getAsJsonPrimitive().isString() && VIEWER_COUNTRIES.contains(region.getAsString())))
        throw argument("viewerClaims.region must be an ISO 3166-1 alpha-2 country code, such as DE");
      sent.add("region", region);
    }
    if (ageConfirmed != null && !ageConfirmed.isJsonNull()) {
      if (!(ageConfirmed.isJsonPrimitive() && ageConfirmed.getAsJsonPrimitive().isBoolean())) throw argument("viewerClaims.ageConfirmed must be a boolean");
      if (ageConfirmed.getAsBoolean()) sent.addProperty("ageConfirmed", true);
    }
    return sent.isEmpty() ? "" : "?viewerClaims=" + encodeComponent(Json.write(sent));
  }

  /**
   * Appends a resource, its {@code @lens} and transform selector, and the viewer claims to an asset
   * URL, public or signed. Without a resource the URL stays the asset URL, which takes no selector.
   */
  private static String appendAssetLocation(String assetUrl, JsonObject o, Object transform) {
    String resource = str(o, "resource", null);
    String lens = str(o, "lens", null);
    boolean selected = lens != null || transform != null;
    String url = assetUrl;
    if (resource == null) {
      if (selected) throw argument("A lens or transform needs a resource, such as rendered");
    } else {
      String path = CDN_RESOURCE_PATHS.get(resource);
      if (path == null) throw argument("Resource must be one of " + String.join(", ", CDN_RESOURCES));
      if (selected && !SELECTABLE_CDN_RESOURCES.contains(resource)) throw argument("The " + resource + " resource takes no lens or transform");
      url += "/" + path;
      List<String> selector = new ArrayList<>();
      if (lens != null) selector.add("@" + id(lens));
      if (transform instanceof String text) { if (!text.isEmpty()) selector.add(transformPath(text)); }
      // Serialized options are already path-safe: unreserved characters, escapes, "=", "," and ".".
      else if (transform != null) selector.add(transformSelector(transform));
      if (!selector.isEmpty()) url += "/" + String.join(",", selector);
    }
    return url + viewerClaimsQuery(o.get("viewerClaims"));
  }

  /**
   * CDN URLs, signed asset URLs, asset display info and downloads.
   *
   * <p>Every asset has one URL, {@code {cdnBaseUrl}/assets/{projectId}/{asset}}, and each resource
   * is a path beneath it ({@link #CDN_RESOURCES}). The asset segment is the asset ID or {@code
   * ext:} and the URL-encoded external ID for a public asset, or a signed grant for a private one:
   * use {@link #signAssetUrl} if the asset is private, {@link #getAssetUrl} otherwise, and add
   * viewer claims to either.
   */
  public final class Cdn {
    private Cdn() {}

    private String assetUrl(JsonObject o, Object transform) {
      String base = cdnBaseUrl + "/assets/" + id(str(o, "projectId", projectId)) + "/" + assetSegment(o);
      return appendAssetLocation(base, o, transform);
    }

    /**
     * Builds an asset's CDN URL without sending a request: the asset URL, which every resource is a
     * path beneath, or a resource URL when {@code resource} is set, with its lens or transform and
     * the viewer claims. Name the asset by exactly one of {@code assetId} and {@code externalId};
     * {@code projectId} defaults to the client's. Use it for public assets; private ones need
     * {@link #signAssetUrl}. Lenses and transforms apply to {@code preview}, and to {@code
     * rendered} when it is an image (the CDN refuses them on rendered PDFs, video and audio with
     * {@code transform/invalid}); the SDK refuses them without a resource and on the other
     * resources. Viewer claims are assertions from your app; CalmLens doesn't verify them.
     *
     * @param options the asset, resource, selector and viewer claims
     * @return the URL
     * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for invalid options
     */
    public String getAssetUrl(Models.CdnRequest options) {
      return assetUrl(Models.encode(options), options.transformValue());
    }

    /**
     * Signs a private asset's URL on your server, so browsers and apps can load it without an API
     * key until it expires. Every resource is a path beneath it, as beneath a public asset URL; the
     * {@code original} only when signed with {@code original(true)}. With a {@code resource}, it
     * returns that resource's URL beneath the grant, with the lens, transform and viewer claims
     * appended as {@link #getAssetUrl} appends them. The options are checked before anything is
     * sent; the lifetime defaults to {@link #DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS}.
     *
     * @param options the asset, lifetime, original access and the location beneath the grant
     * @return the signed URL and its expiry
     * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for invalid options
     */
    public Models.SignedAssetUrl signAssetUrl(Models.SignAssetUrlOptions options) {
      JsonObject o = Models.encode(options);
      Object transform = options.transformValue();
      assetSegment(o);
      long expiresIn = DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS;
      if (o.has("expiresIn")) {
        expiresIn = o.get("expiresIn").getAsLong();
        if (expiresIn < 1 || expiresIn > MAX_SIGNED_URL_EXPIRES_IN_SECONDS) throw argument("expiresIn must be a whole number of seconds from 1 to 86400");
      }
      // The location is appended to the signed URL: check it before signing.
      appendAssetLocation("", o, transform);
      JsonObject body = new JsonObject();
      if (o.has("assetId")) body.add("assetId", o.get("assetId"));
      else body.add("externalId", o.get("externalId"));
      body.addProperty("expiresIn", expiresIn);
      body.addProperty("original", flag(o, "original"));
      String path = "/projects/" + id(str(o, "projectId", projectId)) + "/signed-asset-urls";
      Models.SignedAssetUrl signed = decode(json("POST", path, null, body), Models.SignedAssetUrl.class);
      if (signed.url() == null || signed.url().isEmpty())
        throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "The API returned no signed asset URL", null, 200, Map.of(), null);
      return new Models.SignedAssetUrl(appendAssetLocation(signed.url(), o, transform), signed.expiresAt());
    }

    /**
     * Fetches the display info of an asset URL, public or signed ({@code {url}/info}), for the
     * viewer claims the URL carries.
     *
     * @param url an asset URL from {@link #getAssetUrl} or {@link #signAssetUrl}, without a resource
     * @return the asset's type, size, rendered file, preview and stream, and whether the viewer can see it
     * @see #getAssetInfo(String, Models.ViewerClaims)
     */
    public Models.AssetInfo getAssetInfo(String url) { return getAssetInfo(url, null); }

    /**
     * Fetches the display info of an asset URL, public or signed ({@code {url}/info}): its type,
     * size, rendered file, preview and stream, and whether the viewer its claims describe can see
     * it. It sends no API key, as a browser would, and is retried like API reads. A refusal throws
     * {@link ApiException} with the CDN's code, such as {@link ErrorCodes#SIGNED_URL_EXPIRED} or
     * {@code asset/not-available}.
     *
     * @param url an asset URL from {@link #getAssetUrl} or {@link #signAssetUrl}, without a resource
     * @param viewerClaims the viewer's claims, replacing those the URL carries; null keeps the URL's
     * @return the display info
     * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} when the URL isn't absolute
     *     or its claims are invalid
     */
    public Models.AssetInfo getAssetInfo(String url, Models.ViewerClaims viewerClaims) {
      URI parsed;
      try {
        parsed = url == null ? null : new URI(url);
      } catch (java.net.URISyntaxException invalid) {
        parsed = null;
      }
      if (parsed == null || !parsed.isAbsolute() || parsed.getHost() == null) throw argument("url must be an absolute asset URL");
      String[] parts = url.split("#", 2)[0].split("\\?", 2);
      String base = parts[0].replaceAll("/+$", "");
      JsonElement claims = viewerClaims == null ? null : Json.GSON.toJsonTree(viewerClaims);
      if (claims == null && parts.length == 2)
        for (String pair : parts[1].split("&")) {
          String[] param = pair.split("=", 2);
          if (!URLDecoder.decode(param[0], StandardCharsets.UTF_8).equals("viewerClaims")) continue;
          try {
            claims = JsonParser.parseString(URLDecoder.decode(param.length == 2 ? param[1] : "", StandardCharsets.UTF_8));
          } catch (JsonParseException | IllegalArgumentException invalid) {
            throw argument("The asset URL's viewerClaims are not JSON");
          }
        }
      Map<String, String> headers = new LinkedHashMap<>();
      headers.put("User-Agent", userAgent);
      headers.put("Accept", "application/json");
      Reply reply = execute(new Call("GET", base + "/info" + viewerClaimsQuery(claims), headers, null, timeout, true));
      Models.AssetInfo info;
      try {
        info = reply.json() != null && reply.json().isJsonObject() ? Json.GSON.fromJson(reply.json(), Models.AssetInfo.class) : null;
      } catch (JsonParseException | IllegalStateException | IllegalArgumentException invalid) {
        info = null;
      }
      if (info == null || info.id() == null || info.projectId() == null || info.type() == null || info.content() == null || info.availability() == null)
        throw new ApiException(ErrorCodes.SDK_INVALID_RESPONSE, "The CDN returned no asset info", null, reply.status(), reply.headers(), null);
      return info;
    }

    /**
     * Streams an asset from the CDN with the API key. Every status but a redirect is returned
     * (redirects fail with {@link ErrorCodes#SDK_HTTP_ERROR} and are never followed); close the
     * response when done. Transport failures and HTTP 429, 500, 502, 503 and 504 are retried like API
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
      JsonObject o = Models.encode(options);
      if (!o.has("resource")) o.addProperty("resource", "rendered");
      String url = assetUrl(o, options.transformValue());
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
   * The project's lenses: named image transforms the CDN applies at {@code /@<identifier>}. The CDN
   * serves files made with each lens's current definition. {@link #ensureLenses} creates or changes
   * lenses by identifier, for applications that declare theirs in code.
   */
  public final class Lenses {
    private Lenses() {}

    private String lensPath(JsonObject o) { return "/lenses/" + id(str(o, "lensId", null)); }

    /** A lens changed here no longer has the definition {@code ensureLens} cached for it. */
    private void forget(java.util.function.Predicate<Models.Lens> matches) {
      lensCache.ensured.values().removeIf(matches);
    }

    /** @param options cursor, page size and sort @return one page of the project's lenses, newest first unless {@code sort} says otherwise */
    public Models.LensPage list(Models.ListLenses options) {
      return decode(json("GET", project("lenses"), Models.encode(options), null), Models.LensPage.class);
    }

    /** @return the first page of the project's lenses, newest first */
    public Models.LensPage list() { return list(new Models.ListLenses()); }

    /** @param options page size and sort @return a lazy iterable over every lens of the project */
    public AutoPager<Models.Lens> iterate(Models.ListLenses options) {
      JsonObject o = Models.encode(options);
      return pages(o, cursor -> page(project("lenses"), o, cursor, Models.LensPage.class));
    }

    /**
     * Creates a lens; its identifier must be new to the project ({@code lens/identifier-taken}
     * otherwise).
     *
     * @param options the lens definition
     * @return the new lens
     */
    public Models.Lens create(Models.LensDefinition options) {
      Models.Lens lens = decode(json("POST", project("lenses"), null, Models.encode(options)), Models.Lens.class);
      forget(cached -> java.util.Objects.equals(cached.identifier(), lens.identifier()));
      return lens;
    }

    /** @param options the lens @return the lens */
    public Models.Lens retrieve(Models.LensId options) {
      return decode(json("GET", lensPath(Models.encode(options)), null, null), Models.Lens.class);
    }

    /**
     * Changes a lens's name, description, type, transform or whether the CDN serves it.
     *
     * @param options the lens and the fields to change
     * @return the saved lens
     */
    public Models.Lens update(Models.UpdateLens options) {
      JsonObject o = Models.encode(options);
      Models.Lens lens = decode(json("PATCH", lensPath(o), null, without(o, "lensId")), Models.Lens.class);
      forget(cached -> java.util.Objects.equals(cached.id(), lens.id()));
      return lens;
    }

    /** Deletes a lens; URLs that select it stop being served. @param options the lens */
    public void delete(Models.LensId options) {
      JsonObject o = Models.encode(options);
      String lensId = str(o, "lensId", null);
      success(json("DELETE", lensPath(o), null, null));
      forget(cached -> java.util.Objects.equals(cached.id(), lensId));
    }
  }

  /**
   * Creates a named lens, or changes it to this definition. Sending the same definition again
   * returns the lens unchanged, from this client's lens cache once it has seen it.
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
   * Creates or changes lenses by identifier, as {@link #ensureLens} does. Definitions already ensured by this client (or a client derived from
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
      String key = lensCacheKey(value);
      keys.add(key);
      if (!lensCache.ensured.containsKey(key)) missing.putIfAbsent(key, value);
    }
    if (!missing.isEmpty()) {
      String batch = Json.write(Json.GSON.toJsonTree(new java.util.TreeSet<>(missing.keySet())));
      java.util.concurrent.CompletableFuture<Void> mine = new java.util.concurrent.CompletableFuture<>();
      java.util.concurrent.CompletableFuture<Void> running = lensCache.pending.putIfAbsent(batch, mine);
      if (running == null) {
        try {
          submitLenses(new ArrayList<>(missing.values()));
          mine.complete(null);
        } catch (RuntimeException failure) {
          mine.completeExceptionally(failure);
          throw failure;
        } finally {
          lensCache.pending.remove(batch, mine);
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
      Models.Lens lens = lensCache.ensured.get(keys.get(i));
      // Another call may have replaced this definition with a changed one meanwhile.
      if (lens == null) throw new CalmLensException(ErrorCodes.SDK_INVALID_RESPONSE,
          "CalmLens did not return lens \"" + str(definitions.get(i).getAsJsonObject(), "identifier", "") + "\"");
      result.add(lens);
    }
    return List.copyOf(result);
  }

  /** A definition's cache key: without {@code active} it is the same as an active lens. */
  private static String lensCacheKey(JsonObject definition) {
    JsonObject filled = definition.deepCopy();
    if (!filled.has("active")) filled.addProperty("active", true);
    return Json.write(canonical(filled));
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
        lensCache.ensured.entrySet().removeIf(cached -> identifier.equals(cached.getValue().identifier()));
        lensCache.ensured.put(lensCacheKey(chunk.get(index)), lens);
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
   * The JSON body of the webhook delivery for an event from {@code events.list}: the event in the
   * same shape. Fields that are not part of that shape are left out.
   *
   * @param event the event
   * @return its delivery payload
   */
  public static Models.WebhookEventPayload toWebhookEventPayload(Models.Event event) {
    if (event.json() == null)
      return new Models.WebhookEventPayload(event.id(), event.projectId(), event.actor(), event.type(), event.severity(), event.title(),
          event.description(), event.assetId(), event.assetSequence(), event.asset(), event.facts(), event.createdAt());
    // From the event as received, so asset and fact fields this SDK version does not model are kept.
    Map<String, Object> json = event.json();
    Map<String, Object> payload = new LinkedHashMap<>();
    for (String key : List.of("id", "projectId", "actor", "type", "severity", "title", "description", "assetId", "assetSequence", "asset"))
      // A delivery's actor is optional: one the event lacks stays out.
      if (!key.equals("actor") || json.containsKey(key)) payload.put(key, json.get(key));
    payload.put("facts", json.containsKey("facts") ? json.get("facts") : List.of());
    payload.put("createdAt", json.get("createdAt"));
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
    return event != null && isTestFacts(event.facts());
  }

  /**
   * @param event an event from {@code events.list}
   * @return whether it is a test send
   */
  public static boolean isTestWebhookEvent(Models.Event event) { return event != null && isTestFacts(event.facts()); }

  /**
   * The value of one of an event's facts, by key, such as {@code flagged-categories} on {@code
   * asset.blocked}, or null when the event doesn't carry it (or carries it with a null value). A
   * key the event repeats gives its first value. The fact's {@code url}, when it has one, is on the
   * fact in {@code facts()}.
   *
   * @param event a parsed delivery
   * @param key the fact key
   * @return the fact's value, or null
   */
  public static Object getEventFact(Models.WebhookEventPayload event, String key) { return event == null ? null : factValue(event.facts(), key); }

  /**
   * @param event an event from {@code events.list}
   * @param key the fact key
   * @return the fact's value, or null
   */
  public static Object getEventFact(Models.Event event, String key) { return event == null ? null : factValue(event.facts(), key); }

  /**
   * An event's facts as values by key, in the event's order, such as {@code {"flagged-categories":
   * ["hate"]}}. A key the event repeats keeps its first value, as {@link
   * #getEventFact(Models.WebhookEventPayload, String)} reads it; a null value is kept.
   *
   * @param event a parsed delivery
   * @return the values by key, unmodifiable
   */
  public static Map<String, Object> getEventFacts(Models.WebhookEventPayload event) { return factValues(event == null ? null : event.facts()); }

  /**
   * @param event an event from {@code events.list}
   * @return the values by key, unmodifiable
   */
  public static Map<String, Object> getEventFacts(Models.Event event) { return factValues(event == null ? null : event.facts()); }

  private static Object factValue(List<Models.EventFact> facts, String key) {
    if (facts != null) for (Models.EventFact fact : facts) if (fact != null && Objects.equals(fact.key(), key)) return fact.value();
    return null;
  }

  private static Map<String, Object> factValues(List<Models.EventFact> facts) {
    Map<String, Object> values = new LinkedHashMap<>();
    if (facts != null) for (Models.EventFact fact : facts) if (fact != null && fact.key() != null && !values.containsKey(fact.key())) values.put(fact.key(), fact.value());
    return Collections.unmodifiableMap(values);
  }

  /**
   * Whether to apply an event after {@code lastSequence}, the highest {@code assetSequence} you have
   * applied for its asset (null when none). Deliveries can arrive out of order: an event about an
   * asset is newer only with a higher {@code assetSequence}, so a retried or repeated delivery of an
   * earlier one returns false. Events that aren't about an asset have no sequence and are always
   * new. Store the highest {@code assetSequence} applied per {@code assetId} and ignore events this
   * returns false for.
   *
   * @param event a parsed delivery
   * @param lastSequence the highest {@code assetSequence} applied for the event's asset, or null
   * @return whether the event is newer than what you have applied
   */
  public static boolean isNewerAssetEvent(Models.WebhookEventPayload event, Long lastSequence) {
    return isNewerSequence(event.assetSequence(), lastSequence);
  }

  /**
   * @param event an event from {@code events.list}
   * @param lastSequence the highest {@code assetSequence} applied for the event's asset, or null
   * @return whether the event is newer than what you have applied
   */
  public static boolean isNewerAssetEvent(Models.Event event, Long lastSequence) {
    return isNewerSequence(event.assetSequence(), lastSequence);
  }

  private static boolean isNewerSequence(Long sequence, Long lastSequence) {
    return sequence == null || lastSequence == null || sequence > lastSequence;
  }

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
   * {@code type} and {@code projectId} and a numeric {@code createdAt}; the other known fields, when
   * present, have the API's types. Unknown fields are kept in {@code json()}.
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
        || !(event.get("createdAt") instanceof JsonPrimitive createdAt && createdAt.isNumber()))
      return false;
    if (!optionalString(event, "severity", false) || !optionalString(event, "title", false)
        || !optionalString(event, "description", true) || !optionalString(event, "assetId", true)) return false;
    JsonElement sequence = event.get("assetSequence");
    if (sequence != null && !sequence.isJsonNull() && !(sequence instanceof JsonPrimitive number && number.isNumber())) return false;
    JsonElement asset = event.get("asset");
    if (asset != null && !asset.isJsonNull() && !(asset instanceof JsonObject snapshot && isString(snapshot.get("id")))) return false;
    JsonElement facts = event.get("facts");
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
