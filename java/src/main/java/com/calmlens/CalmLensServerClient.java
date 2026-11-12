package com.calmlens;

import com.calmlens.exception.*;
import com.calmlens.internal.ClientAccess.TransformProblems;
import com.calmlens.internal.ClientAccess.TransformSelector;
import com.calmlens.internal.Json;
import com.calmlens.internal.Sleeper;
import com.calmlens.internal.Timeouts;
import com.calmlens.internal.TransformSchema;
import com.calmlens.internal.UploadForm;
import com.calmlens.internal.UploadMimeTypes;
import com.calmlens.models.*;
import com.calmlens.params.*;
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
import org.jspecify.annotations.Nullable;

/**
 * Synchronous, thread-safe CalmLens client. Create one per API key and reuse it; close it when your
 * application shuts down.
 *
 * <pre>{@code
 * try (var client = CalmLensServerClient.fromEnv()) {
 *   Asset asset = client.text().classify("Hello world");
 *   if (asset.getClassification().getModeration().getDecision().orElse(null) == AssetModerationDecision.ALLOWED) publish();
 * }
 * }</pre>
 *
 * <p>Every method takes a {@link RequestOptions} as its last argument for one call's deadlines,
 * retries, idempotency key and headers. Failures are {@link CalmLensException}s, one subclass per
 * kind of failure. Reads ({@code GET}) and uploads, which carry an
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
   * ({@link CdnService#getAssetInfo(String)}).
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
  /** Headers the SDK sets on API requests, which {@link RequestOptions} can't set either. */
  private static final Set<String> SDK_HEADERS = Set.of("accept", "content-type", "idempotency-key", "user-agent", "x-calmlens-upload");
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

  private final AssetService assets = new AssetService();
  private final TextService text = new TextService();
  private final FolderService folders = new FolderService();
  private final HashListService hashLists = new HashListService();
  private final PolicyService policies = new PolicyService();
  private final LensService lenses = new LensService();
  private final UploadPresetService uploadPresets = new UploadPresetService();
  private final ProjectSettingsService projectSettings = new ProjectSettingsService();
  private final MetadataFieldService metadataFields = new MetadataFieldService();
  private final UploadTokenService uploadTokens = new UploadTokenService();
  private final EventService events = new EventService();
  private final CdnService cdn = new CdnService();

  /** @return asset uploads, moderation, listing and management */
  public AssetService assets() { return assets; }
  /** @return text moderation */
  public TextService text() { return text; }
  /** @return folders */
  public FolderService folders() { return folders; }
  /** @return hash lists that image uploads are compared with */
  public HashListService hashLists() { return hashLists; }
  /** @return moderation policies, shared by the project's organisation */
  public PolicyService policies() { return policies; }
  /** @return the project's lenses */
  public LensService lenses() { return lenses; }
  /** @return the project's upload presets */
  public UploadPresetService uploadPresets() { return uploadPresets; }
  /** @return the project's settings */
  public ProjectSettingsService projectSettings() { return projectSettings; }
  /** @return the project's metadata fields */
  public MetadataFieldService metadataFields() { return metadataFields; }
  /** @return upload token signing, done locally */
  public UploadTokenService uploadTokens() { return uploadTokens; }
  /** @return the events feed */
  public EventService events() { return events; }
  /** @return CDN URLs and downloads */
  public CdnService cdn() { return cdn; }

  /**
   * This client's asynchronous form: the same operations, each returning a {@link
   * java.util.concurrent.CompletableFuture}. It shares this client's connection, settings and lens
   * cache, and closing this client stops it.
   *
   * @return the asynchronous client
   */
  public CalmLensServerClientAsync async() { return new CalmLensServerClientAsync(this, asyncExecutor.get()); }

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
  /** The executor of {@link #async()} calls: the builder's, or a pool made on first use and shut down on close. */
  private final AsyncExecutor asyncExecutor;

  /** The async executor, made lazily so clients that never call {@link #async()} start no threads. */
  private static final class AsyncExecutor {
    private final java.util.concurrent.@Nullable ExecutorService given;
    private java.util.concurrent.@Nullable ExecutorService owned;
    private boolean closed;

    AsyncExecutor(java.util.concurrent.@Nullable ExecutorService given) { this.given = given; }

    synchronized java.util.concurrent.Executor get() {
      if (given != null) return given;
      if (closed) throw CalmLensException.of(ErrorCodes.SDK_CLIENT_CLOSED, "The client is closed");
      if (owned == null) {
        java.util.concurrent.atomic.AtomicInteger count = new java.util.concurrent.atomic.AtomicInteger();
        owned = java.util.concurrent.Executors.newCachedThreadPool(task -> {
          Thread thread = new Thread(task, "calmlens-async-" + count.incrementAndGet());
          thread.setDaemon(true);
          return thread;
        });
      }
      return owned;
    }

    synchronized void close() {
      closed = true;
      if (owned != null) owned.shutdown();
    }
  }
  /** Headers added to every request: a derived client's {@link RequestOptions#getHeaders()}. */
  private final Map<String, String> extraHeaders;
  /** Query parameters and body fields added to every request: a derived client's extras. */
  private final Map<String, Object> extraQuery, extraBody;
  /** The operation a derived client makes, for the request listener and logs. */
  private final @Nullable String operation;
  private final @Nullable RequestListener listener;
  private final boolean responseValidation;
  private final System.Logger logger;
  private final System.Logger.Level logLevel;
  /** Leaves multipart size checks to the API; set by the mock so its API answers them in the API's order. */
  private boolean deferUploadChecks;

  static {
    com.calmlens.internal.ClientAccess.Holder.install(new com.calmlens.internal.ClientAccess() {
      @Override public CalmLensServerClient build(Builder builder, Transport transport, Sleeper sleeper, LongSupplier nanoTime,
          int defaultMaxRetries, boolean deferUploadChecks) {
        CalmLensServerClient client = new CalmLensServerClient(builder, transport, sleeper, nanoTime, defaultMaxRetries);
        client.deferUploadChecks = deferUploadChecks;
        return client;
      }

      @Override public SignedUploadToken signUploadToken(String apiKey, UploadTokenSignParams params, long now, String nonce) {
        return CalmLensServerClient.signUploadToken(apiKey, params, now, nonce);
      }

      @Override public CalmLensException transportError(Throwable failure) { return CalmLensServerClient.transportError(failure); }

      @Override public CdnResponse cdnResponse(Transport.Response response, InputStream body) { return new CdnResponse(response, body); }

      @Override public boolean isAcceptedUploadMimeType(String mimeType) { return CalmLensServerClient.isAcceptedUploadMimeType(mimeType); }

      @Override public String rejectedUploadMimeTypeMessage(String mimeType) { return CalmLensServerClient.rejectedUploadMimeTypeMessage(mimeType); }

      @Override public String encodeComponent(String value) { return CalmLensServerClient.encodeComponent(value); }

      @Override public TransformSelector parseTransformSelector(String selector) { return CalmLensServerClient.parseTransformSelector(selector); }

      @Override public TransformProblems checkTransformOptions(JsonElement options) { return CalmLensServerClient.checkTransformOptions(options); }
    });
  }

  /** Lenses ensured by a client and the clients derived from it, and the requests in flight. */
  private static final class LensCache {
    final Map<String, Lens> ensured = new ConcurrentHashMap<>();
    final Map<String, java.util.concurrent.CompletableFuture<Void>> pending = new ConcurrentHashMap<>();
  }

  /**
   * A client for the production API with default options. Prefer {@link #builder()} or {@link #fromEnv()}.
   *
   * @param apiKey a project API key
   * @param projectId the project ID
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_CONFIG} for a missing key or project, or
   *     a key that can't be sent as a header
   */
  public CalmLensServerClient(String apiKey, String projectId) { this(builder().apiKey(apiKey).projectId(projectId), null, null, null, DEFAULT_MAX_RETRIES); }

  /** A client like {@code base} with other deadlines, retries or headers, sharing its transport, state and lens cache. */
  private CalmLensServerClient(CalmLensServerClient base, Duration timeout, @Nullable Duration uploadTimeout, int maxRetries, Map<String, String> extraHeaders,
      Map<String, Object> extraQuery, Map<String, Object> extraBody, @Nullable String operation) {
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
    this.asyncExecutor = base.asyncExecutor;
    this.deferUploadChecks = base.deferUploadChecks;
    this.extraHeaders = extraHeaders;
    this.extraQuery = extraQuery;
    this.extraBody = extraBody;
    this.operation = operation;
    this.listener = base.listener;
    this.responseValidation = base.responseValidation;
    this.logger = base.logger;
    this.logLevel = base.logLevel;
  }

  private CalmLensServerClient(Builder options, @Nullable Transport override, @Nullable Sleeper sleeper, @Nullable LongSupplier nanoTime, int defaultMaxRetries) {
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
    this.asyncExecutor = new AsyncExecutor(options.asyncExecutor);
    this.extraHeaders = Map.of();
    this.extraQuery = Map.of();
    this.extraBody = Map.of();
    this.operation = null;
    this.listener = options.listener;
    this.responseValidation = options.responseValidation;
    this.logger = options.logger != null ? options.logger : System.getLogger("com.calmlens");
    this.logLevel = logLevel(options.logLevel != null ? options.logLevel : System.getenv(LOG_ENV));
    this.baseUrl = baseUrl("baseUrl", options.baseUrl);
    this.cdnBaseUrl = baseUrl("cdnBaseUrl", options.cdnBaseUrl);
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.timeout = options.timeout;
    this.uploadTimeout = options.uploadTimeout;
    this.maxRetries = retries;
    this.maxResponseBytes = options.maxResponseBytes;
    this.partSizeBytes = options.partSizeBytes;
    this.userAgent = "calmlens-java/" + VERSION + " (java/" + Runtime.version() + ")"
        + (options.appName == null ? "" : " " + options.appName + (options.appVersion == null ? "" : "/" + options.appVersion)
            + (options.appUrl == null ? "" : " (" + options.appUrl + ")"));
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

  private static CalmLensException config(String message) { return CalmLensException.of(ErrorCodes.SDK_INVALID_CONFIG, message); }

  /** The most assets one {@code assets.batch} request takes. */
  public static final int ASSET_BATCH_MAX_ASSETS = 500;

  /** Refuses a batch the API would reject for its size, an ID or the operation. */
  static void validateBatch(@Nullable AssetBatchParams options) {
    if (options == null) throw argument("Batch params are required");
    java.util.List<String> ids = options.getAssetIds().orElse(null);
    if (ids == null || ids.isEmpty() || ids.size() > ASSET_BATCH_MAX_ASSETS)
      throw argument("assetIds must list 1 to " + ASSET_BATCH_MAX_ASSETS + " asset IDs");
    for (String id : ids) if (id == null || id.isEmpty()) throw argument("Every asset ID must be a non-empty string");
    if (options.getOperation().isEmpty() || options.getOperation().get() == AssetBatchOperation.UNKNOWN)
      throw argument("operation must be one of delete, remove-content");
  }

  private static CalmLensException argument(String message) { return CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, message); }

  private static CalmLensException payloadError(String message) { return CalmLensException.of(ErrorCodes.INVALID_UPLOAD_PAYLOAD, message); }

  private static String baseUrl(String option, String value) {
    URI uri;
    try { uri = value == null ? null : new URI(value); }
    catch (URISyntaxException cause) { throw CalmLensException.of(ErrorCodes.SDK_INVALID_CONFIG, option + " must be an absolute http(s) URL", cause); }
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

  /** The environment variable that sets the log level: {@code off}, {@code info} or {@code debug}. */
  public static final String LOG_ENV = "CALMLENS_LOG";

  /** The environment variable {@link #fromEnv()} reads the API key from. */
  public static final String API_KEY_ENV = "CALMLENS_API_KEY";
  /** The environment variable {@link #fromEnv()} reads the project ID from. */
  public static final String PROJECT_ID_ENV = "CALMLENS_PROJECT_ID";
  /** The environment variable {@link #fromEnv()} reads the API base URL from. */
  public static final String BASE_URL_ENV = "CALMLENS_BASE_URL";

  /**
   * A builder with production defaults and no credentials: set {@link Builder#apiKey(String)} and
   * {@link Builder#projectId(String)}, or call {@link Builder#fromEnv()}, before {@link
   * Builder#build()}.
   *
   * @return the builder
   */
  public static Builder builder() { return new Builder(); }

  /**
   * A client configured from the environment: see {@link Builder#fromEnv()}.
   *
   * @return the client
   * @throws ConfigurationException when the API key or project ID is missing
   */
  public static CalmLensServerClient fromEnv() { return builder().fromEnv().build(); }

  /** Client options. Every option is validated by {@link #build()}. */
  public static final class Builder {
    private @Nullable String apiKey, projectId;
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
    private @Nullable String appName, appVersion, appUrl, logLevel;
    private @Nullable RequestListener listener;
    private System.Logger logger;
    private java.util.concurrent.@Nullable ExecutorService asyncExecutor;
    private boolean responseValidation;

    private Builder() {}

    /**
     * Names your integration in the {@code User-Agent}, as {@code name/version (url)}, so CalmLens
     * can tell plugins and platforms apart.
     *
     * @param name your app or plugin's name
     * @param version its version, or null
     * @param url its website, or null
     * @return this builder
     */
    public Builder appInfo(String name, @Nullable String version, @Nullable String url) {
      appName = name;
      appVersion = version;
      appUrl = url;
      return this;
    }

    /**
     * Where the client logs retries and failures ({@code info}) and every request ({@code debug}),
     * through {@code System.Logger}, which routes to SLF4J, Log4j or {@code java.util.logging}. It
     * never logs the API key, bodies, query strings or signed URLs. {@code com.calmlens} by default.
     *
     * @param value the logger
     * @return this builder
     */
    public Builder logger(System.Logger value) { logger = value; return this; }

    /**
     * How much the client logs: {@code off}, {@code info} or {@code debug}; the {@value #LOG_ENV}
     * environment variable, else {@code off}, by default.
     *
     * @param value the level
     * @return this builder
     */
    public Builder logLevel(String value) { logLevel = value; return this; }

    /**
     * @param value receives every request attempt: its operation, method, path, attempt, status,
     *     request ID, duration and the delay before a retry
     * @return this builder
     */
    public Builder requestListener(RequestListener value) { listener = value; return this; }

    /**
     * The threads that run {@link CalmLensServerClient#async()} calls; an unbounded pool of daemon
     * threads, shut down by {@link CalmLensServerClient#close()}, by default. One you supply is not
     * shut down.
     *
     * @param value the executor
     * @return this builder
     */
    public Builder asyncExecutor(java.util.concurrent.ExecutorService value) { asyncExecutor = value; return this; }

    /**
     * Checks every response model for the fields the API always sends as soon as it is read, so a
     * malformed response fails at once with {@code sdk/invalid-response} rather than when a getter
     * reads the missing field. Off by default.
     *
     * @param value whether to check responses
     * @return this builder
     */
    public Builder responseValidation(boolean value) { responseValidation = value; return this; }

    /** @param value a project API key @return this builder */
    public Builder apiKey(String value) { apiKey = value; return this; }

    /** @param value the project ID @return this builder */
    public Builder projectId(String value) { projectId = value; return this; }

    /**
     * Reads the API key, project ID and API base URL from the {@code calmlens.apiKey}, {@code
     * calmlens.projectId} and {@code calmlens.baseUrl} system properties, or else the {@value
     * #API_KEY_ENV}, {@value #PROJECT_ID_ENV} and {@value #BASE_URL_ENV} environment variables. A
     * property set, even to an empty string, takes the variable's place. A setting neither has
     * keeps its current value.
     *
     * @return this builder
     */
    public Builder fromEnv() {
      String key = setting("calmlens.apiKey", API_KEY_ENV), project = setting("calmlens.projectId", PROJECT_ID_ENV),
          base = setting("calmlens.baseUrl", BASE_URL_ENV);
      if (key != null) apiKey = key;
      if (project != null) projectId = project;
      if (base != null) baseUrl = base;
      return this;
    }

    /** The system property, which overrides the variable even when empty (unset), or else the variable. */
    private static @Nullable String setting(String property, String variable) {
      String value = System.getProperty(property);
      if (value == null) value = System.getenv(variable);
      return value == null || value.isEmpty() ? null : value;
    }

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
     * RequestOptions.Builder#setUploadTimeout(Duration)}.
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
    asyncExecutor.close();
    // HttpClient implements AutoCloseable from Java 21; on Java 17 it is released by garbage collection.
    if (ownedHttpClient instanceof AutoCloseable closeable) {
      try { closeable.close(); } catch (Exception ignored) { /* already closing */ }
    }
  }

  @Override public String toString() {
    return "CalmLensServerClient[projectId=" + projectId + ", baseUrl=" + baseUrl + ", cdnBaseUrl=" + cdnBaseUrl + "]";
  }

  /**
   * A client whose calls use other deadlines, retries or headers, sharing this client's
   * credentials, connection and lens cache. This client is unchanged, and closing either closes
   * both.
   *
   * <pre>{@code
   * var patient = client.withRequestOptions(RequestOptions.builder().setTimeout(Duration.ofMinutes(5)).setMaxRetries(5).build());
   * }</pre>
   *
   * @param options {@code timeout}, {@code uploadTimeout}, {@code maxRetries} and headers; an
   *     idempotency key belongs to one call, so it is refused here
   * @return the derived client
   * @throws InvalidArgumentException for invalid options
   */
  public CalmLensServerClient withRequestOptions(RequestOptions options) {
    if (options == null) throw argument("Request options are required");
    if (options.getIdempotencyKey().isPresent()) throw argument("An idempotency key applies to one call; pass it to that call");
    return with(options);
  }

  /** This client, or a derived one with the overrides in {@code options}. */
  private CalmLensServerClient with(@Nullable RequestOptions options) { return with(options, operation); }

  /** A client for one operation: this one's settings, the overrides in {@code options} and {@code name} for logs and listeners. */
  private CalmLensServerClient with(@Nullable RequestOptions options, @Nullable String operationName) {
    if ((options == null || options.getTimeout().isEmpty() && options.getUploadTimeout().isEmpty() && options.getMaxRetries().isEmpty()
        && options.getHeaders().isEmpty() && options.getExtraQuery().isEmpty() && options.getExtraBody().isEmpty())
        && Objects.equals(operationName, operation)) return this;
    if (options == null) options = RequestOptions.none();
    Duration callTimeout = options.getTimeout().orElse(timeout);
    Duration callUploadTimeout = options.getUploadTimeout().orElse(uploadTimeout);
    int retries = options.getMaxRetries().orElse(maxRetries);
    if (callTimeout.isZero() || callTimeout.isNegative()) throw argument("timeout must be a positive duration");
    if (callUploadTimeout != null && (callUploadTimeout.isZero() || callUploadTimeout.isNegative())) throw argument("uploadTimeout must be a positive duration");
    if (retries < 0 || retries > 10) throw argument("maxRetries must be between 0 and 10");
    Map<String, String> headers = new LinkedHashMap<>(extraHeaders);
    options.getHeaders().forEach((name, value) -> {
      if (name != null && SDK_HEADERS.contains(name.toLowerCase(Locale.ROOT))) throw argument("Header " + name + " cannot be set");
      header(headers, name, value);
    });
    Map<String, Object> query = new LinkedHashMap<>(extraQuery), fields = new LinkedHashMap<>(extraBody);
    query.putAll(options.getExtraQuery());
    fields.putAll(options.getExtraBody());
    return new CalmLensServerClient(this, callTimeout, callUploadTimeout, retries, Collections.unmodifiableMap(headers),
        Collections.unmodifiableMap(query), Collections.unmodifiableMap(fields), operationName);
  }

  private static @Nullable String key(@Nullable RequestOptions options) { return options == null ? null : options.getIdempotencyKey().orElse(null); }

  /** @return the project this client works in */
  public String getProjectId() { return projectId; }

  /** @return the API base URL */
  public String getBaseUrl() { return baseUrl; }

  /** @return the CDN base URL */
  public String getCdnBaseUrl() { return cdnBaseUrl; }

  /** @return the deadline of each API request attempt */
  public Duration getTimeout() { return timeout; }

  /** @return the deadline of each binary upload attempt; empty for none */
  public java.util.Optional<Duration> getUploadTimeout() { return java.util.Optional.ofNullable(uploadTimeout); }

  /** @return how many times a failed read or idempotent upload is retried */
  public int getMaxRetries() { return maxRetries; }

  /** @return the largest API response body the client reads */
  public long getMaxResponseBytes() { return maxResponseBytes; }

  /** @return the size of each part of a large upload */
  public long getPartSizeBytes() { return partSizeBytes; }

  /**
   * Sends a request to an API path the SDK has no method for yet, with this client's API key,
   * retries and error handling: a {@code GET} or {@code HEAD}, or a request with an idempotency key,
   * is retried like the SDK's own calls. Non-2xx responses throw the same exceptions.
   *
   * @param method the HTTP method, such as {@code GET}
   * @param path the path beneath the API base URL, such as {@code /projects/project-1/assets}
   * @return the response
   */
  public RawResponse request(String method, String path) { return request(method, path, null, null, null); }

  /**
   * @param method the HTTP method, such as {@code POST}
   * @param path the path beneath the API base URL
   * @param query query parameters, or null; strings are sent as they are, anything else as JSON
   * @param body a JSON body: a {@code JsonElement}, params, a map or list, or null for none
   * @param requestOptions deadlines, retries, headers and an idempotency key, or null
   * @return the response
   * @see #request(String, String)
   */
  public RawResponse request(String method, String path, @Nullable Map<String, ?> query, @Nullable Object body,
      @Nullable RequestOptions requestOptions) {
    CalmLensServerClient c = with(requestOptions, null);
    if (method == null || !HEADER_NAME.matcher(method).matches()) throw argument("method must be an HTTP method");
    if (path == null || !path.startsWith("/") || path.startsWith("//")) throw argument("path must start with a single /");
    String verb = method.toUpperCase(Locale.ROOT);
    JsonObject queryJson = query == null ? null : Json.WRITE.toJsonTree(query).getAsJsonObject();
    queryJson = withExtras(queryJson, c.extraQuery);
    JsonElement json = body == null ? null : body instanceof JsonElement element ? element : Json.WRITE.toJsonTree(body);
    if (!c.extraBody.isEmpty() && (json == null || json.isJsonObject())) json = withExtras(json == null ? null : json.getAsJsonObject(), c.extraBody);
    Map<String, String> headers = c.baseHeaders("application/json");
    Transport.Body payload = null;
    if (json != null) {
      headers.put("Content-Type", "application/json");
      payload = Transport.Body.ofBytes(Json.write(json).getBytes(StandardCharsets.UTF_8));
    }
    String idempotency = key(requestOptions);
    if (idempotency != null) headers.put("Idempotency-Key", idempotencyKey(idempotency));
    boolean retryable = verb.equals("GET") || verb.equals("HEAD") || idempotency != null;
    Reply reply = c.execute(new Call(verb, baseUrl + path + query(queryJson), headers, payload, c.timeout, retryable));
    return new RawResponse(new ApiResponse(reply.status(), reply.headers(), reply.idempotencyKey()), reply.json() == null ? JsonNull.INSTANCE : reply.json());
  }

  /** Params as a JSON object: empty for null params. */
  private static JsonObject encode(@Nullable Object params) {
    if (params == null) return new JsonObject();
    JsonElement tree = Json.GSON.toJsonTree(params);
    if (!tree.isJsonObject()) throw argument("Params must be an object");
    return tree.getAsJsonObject();
  }

  /** Refuses null params where an operation needs them. */
  private static <T> T required(@Nullable T params) {
    if (params == null) throw argument("Params are required");
    return params;
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
    if (transform instanceof ImageTransformOptions options) return serializeTransform(options);
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
  static String serializeTransform(ImageTransformOptions transform) {
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
    throw CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, "Transform options are invalid: " + String.join("; ", parts)
        + ". Pass the options themselves, such as new ImageTransformOptions().width(640).format(\"webp\").", details, 0, null, null, null, null);
  }

  /** A CDN selector as the CDN reads it: an optional lens and the transform options, each null when absent. */

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
  private static Map<?, ?> transformOptions(ImageTransformOptions options) {
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
  private record Reply(int status, Map<String, List<String>> headers, byte[] body, JsonElement json, @Nullable String idempotencyKey) {
    Reply(int status, Map<String, List<String>> headers, byte[] body, JsonElement json) { this(status, headers, body, json, null); }
  }

  private void ensureOpen() {
    if (closed.get()) throw CalmLensException.of(ErrorCodes.SDK_CLIENT_CLOSED, "The client is closed");
  }

  /** The API key and User-Agent, and {@code accept} unless it is null, after the call's extra headers. */
  private Map<String, String> baseHeaders(@Nullable String accept) {
    Map<String, String> headers = new LinkedHashMap<>(extraHeaders);
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
      throw CalmLensException.of(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting to retry", interrupted);
    }
  }

  private Transport.Response send(Call call) {
    ensureOpen();
    try {
      Transport.Response response = transport.send(new Transport.Request(call.method(), URI.create(call.url()), call.headers(), call.body(), call.timeout()));
      if (response == null) throw CalmLensException.of(ErrorCodes.SDK_TRANSPORT_ERROR, "Transport returned no response", null);
      return response;
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw CalmLensException.of(ErrorCodes.SDK_CANCELLED, "Request interrupted", interrupted);
    } catch (CalmLensException failure) {
      throw failure;
    } catch (IOException | RuntimeException failure) {
      if (Thread.currentThread().isInterrupted())
        throw CalmLensException.of(ErrorCodes.SDK_CANCELLED, "Request interrupted", failure);
      throw transportError(failure);
    }
  }

  /**
   * The exception for a failure of the transport: a {@link TimeoutException} when it timed out,
   * else a {@link ConnectionException}.
   *
   * @param failure what the transport threw
   * @return the exception, not thrown
   */
  static CalmLensException transportError(Throwable failure) {
    Throwable classify = failure instanceof UncheckedIOException unchecked && unchecked.getCause() != null ? unchecked.getCause() : failure;
    String message = failure.getMessage() == null ? failure.getClass().getName() : failure.getMessage();
    boolean timedOut = classify instanceof HttpTimeoutException || classify instanceof SocketTimeoutException;
    return timedOut ? CalmLensException.of(ErrorCodes.SDK_TIMEOUT, message, failure) : CalmLensException.of(ErrorCodes.SDK_TRANSPORT_ERROR, message, failure);
  }

  private static boolean retryableStatus(int status) { return status == 429 || status == 500 || status == 502 || status == 503 || status == 504; }

  private static boolean isRedirect(int status) { return status >= 300 && status < 400; }

  /** The declared {@code Content-Length}, or -1. */
  private static long declaredLength(Transport.Response response) {
    String value = response.header("content-length");
    try { return value == null ? -1 : Long.parseLong(value.strip()); } catch (NumberFormatException invalid) { return -1; }
  }

  private CalmLensException tooLarge(Transport.Response response) {
    return CalmLensException.of(ErrorCodes.SDK_RESPONSE_TOO_LARGE, "Response body exceeds " + maxResponseBytes + " bytes", null, response.status(), response.headers(), null, null, null);
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
      long started = System.nanoTime();
      try {
        response = send(current);
        try (response) {
          // A redirect is an HTTP failure like any other: repeating the request redirects again.
          if (isRedirect(response.status()))
            throw CalmLensException.of(ErrorCodes.SDK_HTTP_ERROR, "Unexpected redirect (HTTP " + response.status() + ")", null, response.status(), response.headers(), null, null, null);
          if (declaredLength(response) > maxResponseBytes) throw tooLarge(response);
          body = Timeouts.readAll(response.body(), maxResponseBytes, remaining(current.timeout(), started));
        } catch (IOException failure) {
          throw transportError(failure);
        }
      } catch (ConnectionException | TimeoutException failure) {
        if (canRetry(call, attempt) && !Thread.currentThread().isInterrupted()) {
          Duration wait = retryDelay(attempt, ThreadLocalRandom.current().nextDouble());
          report(call, attempt, started, 0, null, failure, wait);
          pauseWithinBudget(wait, remainingBudget);
          continue;
        }
        report(call, attempt, started, 0, null, failure, null);
        throw failure;
      } catch (CalmLensException failure) {
        report(call, attempt, started, failure.getStatus(), failure.getHeaders(), failure, null);
        throw failure;
      }
      if (remainingBudget != null) decisionTimeLeft(remainingBudget);
      if (body == null) throw tooLarge(response);
      Reply reply = parse(response, body);
      if (reply.status() >= 200 && reply.status() < 300) {
        report(call, attempt, started, reply.status(), reply.headers(), null, null);
        return new Reply(reply.status(), reply.headers(), reply.body(), reply.json(), call.headers().get("Idempotency-Key"));
      }
      CalmLensException error = error(reply);
      if (canRetry(call, attempt) && error.isRetryable()) {
        Duration wait = error.getRetryAfter().isPresent() ? error.getRetryAfter().get() : retryDelay(attempt, ThreadLocalRandom.current().nextDouble());
        if (wait.compareTo(RETRY_AFTER_MAX) <= 0) {
          report(call, attempt, started, reply.status(), reply.headers(), error, wait);
          pauseWithinBudget(wait, remainingBudget);
          continue;
        }
      }
      report(call, attempt, started, reply.status(), reply.headers(), error, null);
      throw error;
    }
  }

  private static long decisionTimeLeft(java.util.function.LongSupplier remainingBudget) {
    long left = remainingBudget.getAsLong();
    if (left <= 0) throw CalmLensException.of(ErrorCodes.SDK_TIMEOUT, "Decision deadline expired", null);
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
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "Invalid JSON response (HTTP " + response.status() + ")", null, response.status(), response.headers(), null, null, invalid);
    return new Reply(response.status(), response.headers(), body, json);
  }

  /**
   * The error for a non-2xx reply: the API's code, message, details and request ID (the {@code
   * X-Request-Id} header, else the body's {@code requestId}), or {@link ErrorCodes#SDK_HTTP_ERROR} when the body carries no code.
   */
  private static CalmLensException error(Reply reply) {
    String code = errorCode(reply.json());
    // The body is kept, capped, so a proxy's HTML error page isn't lost.
    String raw = reply.body() == null ? null : new String(reply.body(), 0, Math.min(reply.body().length, CalmLensException.MAX_BODY_CHARS * 4), StandardCharsets.UTF_8);
    if (code == null) return CalmLensException.of(ErrorCodes.SDK_HTTP_ERROR, "HTTP " + reply.status(), null, reply.status(), reply.headers(), null, raw, null);
    JsonObject failure = reply.json().getAsJsonObject();
    Map<String, Object> details = new LinkedHashMap<>();
    if (failure.has("details") && failure.get("details").isJsonObject())
      details.putAll(Json.GSON.fromJson(failure.get("details"), new TypeToken<Map<String, Object>>() {}.getType()));
    String requestId = failure.get("requestId") instanceof JsonPrimitive id && id.isString() ? id.getAsString() : null;
    String message = failure.get("message") instanceof JsonPrimitive text && text.isString() ? text.getAsString() : code;
    return CalmLensException.of(code, message, details, reply.status(), reply.headers(), requestId, raw, null);
  }

  /** The JSON body of a successful reply. */
  private static JsonElement success(Reply reply) { return reply.json(); }


  private Reply json(String method, String path, @Nullable JsonObject query, @Nullable JsonElement body) {
    query = withExtras(query, extraQuery);
    if (!extraBody.isEmpty() && (body == null || body.isJsonObject())) body = withExtras(body == null ? null : body.getAsJsonObject(), extraBody);
    Map<String, String> headers = baseHeaders("application/json");
    Transport.Body payload = null;
    if (body != null) {
      headers.put("Content-Type", "application/json");
      payload = Transport.Body.ofBytes(Json.write(body).getBytes(StandardCharsets.UTF_8));
    }
    boolean retryable = method.equals("GET") || method.equals("HEAD");
    return execute(new Call(method, baseUrl + path + query(query), headers, payload, timeout, retryable));
  }

  /** {@code object} with {@code extras} added, replacing fields of the same name; null when both are empty. */
  private static @Nullable JsonObject withExtras(@Nullable JsonObject object, Map<String, Object> extras) {
    if (extras.isEmpty()) return object;
    JsonObject merged = object == null ? new JsonObject() : object.deepCopy();
    extras.forEach((key, value) -> merged.add(key, value == null ? JsonNull.INSTANCE : Json.WRITE.toJsonTree(value)));
    return merged;
  }

  private static System.Logger.Level logLevel(@Nullable String value) {
    if (value == null) return System.Logger.Level.OFF;
    switch (value.strip().toLowerCase(Locale.ROOT)) {
      case "debug": return System.Logger.Level.DEBUG;
      case "info": return System.Logger.Level.INFO;
      case "off": case "": return System.Logger.Level.OFF;
      default: throw config(LOG_ENV + " must be off, info or debug");
    }
  }

  /** The path of a request URL for logs and listeners: no query, and signed grants redacted. */
  private static String loggedPath(String url) {
    String path = URI.create(url).getRawPath();
    return path == null ? "" : path.replaceAll("/sig_[^/]*", "/sig_[redacted]");
  }

  /** Reports one attempt to the listener and the log. */
  private void report(Call call, int attempt, long started, int status, @Nullable Map<String, List<String>> headers,
      @Nullable CalmLensException failure, @Nullable Duration delay) {
    if (listener == null && logLevel == System.Logger.Level.OFF) return;
    List<String> ids = headers == null ? null : headers.entrySet().stream().filter(e -> "x-request-id".equalsIgnoreCase(e.getKey()))
        .map(Map.Entry::getValue).findFirst().orElse(null);
    String requestId = ids == null || ids.isEmpty() ? null : ids.get(0);
    RequestEvent event = new RequestEvent(operation, call.method(), loggedPath(call.url()), attempt + 1, delay, status, requestId,
        failure == null ? null : failure.getCode(), Duration.ofNanos(System.nanoTime() - started));
    if (listener != null) {
      try { listener.onAttempt(event); } catch (RuntimeException ignored) { /* a listener can't fail the call */ }
    }
    boolean notable = failure != null || delay != null;
    System.Logger.Level level = notable ? System.Logger.Level.INFO : System.Logger.Level.DEBUG;
    if (logLevel != System.Logger.Level.OFF && level.getSeverity() >= logLevel.getSeverity() && logger.isLoggable(level))
      logger.log(level, "calmlens " + event);
  }

  private <T> T decode(Reply reply, Class<T> type) {
    JsonElement value = success(reply);
    try {
      T result = value == null || value.isJsonNull() || (!type.isArray() && !value.isJsonObject()) || (type.isArray() && !value.isJsonArray())
          ? null : Json.GSON.fromJson(value, type);
      if (result == null) throw new JsonParseException("Expected a JSON " + (type.isArray() ? "array" : "object"));
      if (result instanceof CalmLensObject model) {
        Json.setLastResponse(model, new ApiResponse(reply.status(), reply.headers(), reply.idempotencyKey()));
        if (responseValidation) model.validate();
      }
      if (responseValidation && result instanceof Object[] items) for (Object item : items) if (item instanceof CalmLensObject model) model.validate();
      // An asset's ID, upload and classification status and moderation decision are always sent;
      // the decision is null until decided. Without them it isn't an asset.
      if (result instanceof Asset asset && (asset.getId().isEmpty() || asset.getUpload().getStatus() == null
          || asset.getClassification().getStatus() == null || !asset.getClassification().getModeration().hasField("decision")
          || asset.getContent().getStatus() == null))
        throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "The response's AssetModeration has no decision", Map.of("field", "decision"), 0, null, null, null, null);
      return result;
    } catch (InvalidResponseException invalid) {
      // A body that isn't the operation's model: the response was read, but it isn't what was asked for.
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, invalid.getMessage().replaceFirst("^\\[calmlens\\] ", ""), null,
          reply.status(), Map.of(), null, null, invalid);
    } catch (JsonParseException | IllegalStateException | IllegalArgumentException | NullPointerException | UnsupportedOperationException cause) {
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "Invalid response model: " + cause.getMessage(), null, reply.status(), reply.headers(), null, null, cause);
    }
  }

  private static JsonObject object(Reply reply) {
    JsonElement value = success(reply);
    if (value == null || !value.isJsonObject())
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "Expected a JSON object response", null, reply.status(), reply.headers(), null, null, null);
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
      throw CalmLensException.of(ErrorCodes.UNSUPPORTED_UPLOAD_TYPE, rejectedUploadMimeTypeMessage(type), Map.of("mimeType", type, "source", "calmlens"), 0, null, null, null, null);
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
    return CalmLensException.of(ErrorCodes.UPLOAD_TOO_LARGE, message, Map.of("limitBytes", limitBytes, "source", "plan"), 0, null, null, null, null);
  }

  private static CalmLensException multipartImageTooLarge() {
    return uploadTooLarge(MULTIPART_IMAGE_LIMIT_BYTES, "Multipart image uploads cannot exceed 20 MiB.");
  }

  /** The request body for upload content: exactly one source, sent without copying files or streams. */
  private static Transport.Body payload(@Nullable Content content, JsonObject encoded, boolean multipart) {
    byte[] given = content == null ? null : content.getData().orElse(null);
    java.nio.file.Path file = content == null ? null : content.getFile().orElse(null);
    InputStream stream = content == null ? null : content.getStream().orElse(null);
    List<String> sources = new ArrayList<>();
    for (String key : List.of("plainText", "base64", "bytes")) if (encoded.has(key) && !encoded.get(key).isJsonNull()) sources.add(key);
    if (given != null) sources.add("data");
    if (file != null) sources.add("file");
    if (stream != null) sources.add("stream");
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
          catch (ArithmeticException | NumberFormatException | UnsupportedOperationException e) { throw CalmLensException.of(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Expected integer bytes", e); }
          if (b < 0 || b > 255) throw payloadError("Expected bytes between 0 and 255");
          data[i] = (byte) b;
        }
        body = Transport.Body.ofBytes(data);
      }
      case "base64" -> {
        String text = encoded.get("base64").getAsString().replaceFirst("^.*;base64,", "").replaceAll("\\s", "");
        if (multipart && text.length() % 4 != 0) throw payloadError("Split bytes before base64-encoding each part");
        try { body = Transport.Body.ofBytes(Base64.getDecoder().decode(text)); }
        catch (IllegalArgumentException e) { throw CalmLensException.of(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Invalid base64", e); }
      }
      case "data" -> body = Transport.Body.ofBytes(given);
      case "file" -> {
        try {
          if (!Files.isRegularFile(file)) throw argument("Content file must be a readable regular file");
          body = Transport.Body.ofFile(file, Files.size(file));
        } catch (IOException e) { throw CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, "Content file cannot be read", e); }
      }
      // A stream without a declared size is sent chunked, without sizeInBytes.
      default -> body = Transport.Body.ofStream(stream, declared == null ? -1 : declared);
    }
    if (declared != null && body.length() >= 0 && declared != body.length()) throw payloadError("sizeInBytes must match the payload byte length");
    return body;
  }

  /**
   * Sends an upload: text keeps the API deadline, binary content uses the upload deadline. A null
   * {@code mode} is a JSON body, without {@code X-CalmLens-Upload}.
   */
  private Reply upload(String path, JsonObject query, Transport.Body body, @Nullable String contentType, @Nullable String mode, @Nullable String key, boolean text) {
    query = withExtras(query, extraQuery);
    Map<String, String> headers = baseHeaders("application/json");
    if (contentType != null) headers.put("Content-Type", contentType);
    if (mode != null) headers.put("X-CalmLens-Upload", mode);
    headers.put("Idempotency-Key", idempotencyKey(key));
    return execute(new Call("POST", baseUrl + path + query(query), headers, body, text ? timeout : uploadTimeout, true));
  }

  /** Uploads an asset; {@code wait} says whether the API waits for the decision before answering. */
  private Asset submit(@Nullable AssetCreateParams options, boolean wait, @Nullable String key) {
    if (options == null) throw payloadError("Either file content, URL, or multipart part is required");
    JsonObject o = encode(options);
    if (List.of("content", "part", "url").stream().noneMatch(k -> o.has(k) && !o.get(k).isJsonNull()))
      throw payloadError("Either file content, URL, or multipart part is required");
    if (str(o, "name", "").isEmpty()) throw payloadError("Asset name is required");
    if (List.of("content", "part", "url").stream().filter(k -> o.has(k) && !o.get(k).isJsonNull()).count() != 1)
      throw payloadError("Supply exactly one of content, part, or url");
    if (options.getContext().isPresent()) {
      // Only the posts CalmLens uses are sent, which keeps the upload's options small.
      List<ModerationContextItemParams> items = ModerationContextParams.selectItems(options.getContext().get().getItems().orElse(null));
      o.add("context", Json.GSON.toJsonTree(ModerationContextParams.of(items)));
    }
    JsonObject query = new JsonObject();
    query.addProperty("wait", wait);
    if (o.has("url")) {
      Map<String, String> headers = baseHeaders("application/json");
      headers.put("Content-Type", "application/json");
      headers.put("Idempotency-Key", idempotencyKey(key));
      Transport.Body body = Transport.Body.ofBytes(Json.write(withExtras(o, extraBody)).getBytes(StandardCharsets.UTF_8));
      return decode(execute(new Call("POST", baseUrl + project("assets") + query(withExtras(query, extraQuery)), headers, body, timeout, true)), Asset.class);
    }
    boolean multipart = o.has("part");
    Content content = (multipart ? options.getPart() : options.getContent()).orElse(null);
    JsonObject encoded = o.getAsJsonObject(multipart ? "part" : "content");
    if (multipart && encoded.has("partNumber") && encoded.get("partNumber").getAsLong() > 1)
      throw CalmLensException.of(ErrorCodes.USE_UPLOAD_PART, "Use uploadPart for multipart upload parts after the first part");
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
    JsonObject fields = withExtras(UploadForm.fields(o), extraBody);
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
      return decode(upload(project("assets"), query, jsonBody, "application/json", null, key, true), Asset.class);
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
    return decode(upload(project("assets"), query, form.body(), form.contentType(), multipart ? "part" : "content", key, false), Asset.class);
  }

  /**
   * Uploads {@code body} as a multipart upload of {@code partSizeBytes} parts and returns the final
   * part's asset. Part 1 carries the upload's fields and {@code key}; part {@code n} after it
   * carries {@code <key>:part-<n>}, so each is retried on its own and repeating the call with the
   * same key replays the parts the API already has and sends the rest.
   */
  private Asset uploadInParts(JsonObject fields, JsonObject query, Transport.Body body, String type, String key) {
    String base = idempotencyKey(key);
    long total = body.length();
    long count = (total + partSizeBytes - 1) / partSizeBytes;
    Transport.Body first = body.slice(0, partSizeBytes);
    query.addProperty("sizeInBytes", first.length());
    query.addProperty("partNumber", 1);
    query.addProperty("isFinal", false);
    query.addProperty("totalSizeInBytes", total);
    UploadForm.Built form = UploadForm.build(fields, type, first);
    Asset asset = decode(upload(project("assets"), query, form.body(), form.contentType(), "part", base, false), Asset.class);
    String path = "/assets/" + id(asset.getId()) + "/part";
    for (long number = 2; number <= count; ) {
      boolean last = number == count;
      long offset = (number - 1) * partSizeBytes;
      Transport.Body part = body.slice(offset, Math.min(partSizeBytes, total - offset));
      JsonObject partQuery = new JsonObject();
      partQuery.addProperty("partNumber", number);
      partQuery.addProperty("isFinal", last);
      partQuery.addProperty("sizeInBytes", part.length());
      try {
        asset = decode(upload(path, partQuery, part, null, "part", base + ":part-" + number, false), Asset.class);
      } catch (CalmLensException error) {
        if (error.isLocal()) throw error;
        Object expected = error.getDetails().get("expectedPartNumber");
        if (ErrorCodes.INVALID_UPLOAD_PART_NUMBER.equals(error.getCode()) && expected instanceof Number n
            && n.doubleValue() == Math.rint(n.doubleValue()) && n.longValue() > number && n.longValue() <= count) {
          // The parts before the expected one arrived, but their responses were lost.
          number = n.longValue();
          continue;
        }
        // The final part completed the upload, but its response was lost.
        if (last && ErrorCodes.UPLOAD_NOT_OPEN.equals(error.getCode())) return assets.retrieve(asset.getId());
        throw error;
      }
      number++;
    }
    return asset;
  }

  // ------------------------------------------------------------------ Resources

  /** A later part of a multipart upload, sent without a {@code Content-Type}, as the API reads it. */
  private Asset sendPart(String assetId, @Nullable AssetUploadPartParams options, @Nullable String key) {
    String path = "/assets/" + id(assetId) + "/part";
    if (options == null || options.getPart().isEmpty()) throw argument("Part params are required");
    JsonObject o = encode(options);
    JsonObject part = o.getAsJsonObject("part");
    if (!part.has("partNumber") || part.get("partNumber").getAsLong() < 1)
      throw CalmLensException.of(ErrorCodes.INVALID_UPLOAD_PART_NUMBER, "partNumber must be a positive integer");
    Transport.Body body = payload(options.getPart().get(), part, true);
    checkPartSize(body.length(), flag(part, "isFinal"), false);
    JsonObject query = new JsonObject();
    if (o.has("wait")) query.add("wait", o.get("wait"));
    query.add("partNumber", part.get("partNumber"));
    query.addProperty("isFinal", flag(part, "isFinal"));
    if (body.length() >= 0) query.addProperty("sizeInBytes", body.length());
    boolean text = part.has("plainText") && !part.get("plainText").isJsonNull();
    return decode(upload(path, query, body, null, "part", key, text), Asset.class);
  }

  /** Polls an asset until it is settled; see {@link AssetService#waitForDecision(String, Duration, RequestOptions)}. */
  private Asset awaitDecision(String assetId, @Nullable Duration timeout) {
    id(assetId);
    Duration limit = timeout == null ? DEFAULT_DECISION_TIMEOUT : timeout;
    if (limit.isNegative()) throw argument("timeout must not be negative");
    long limitNanos;
    try { limitNanos = limit.toNanos(); } catch (ArithmeticException tooLong) { limitNanos = Long.MAX_VALUE; }
    long started = nanoTime.getAsLong();
    long budget = limitNanos;
    java.util.function.LongSupplier timeLeft = () -> budget - (nanoTime.getAsLong() - started);
    String path = baseUrl + "/assets/" + id(assetId);
    Call lookup = new Call("GET", path, baseHeaders("application/json"), null, this.timeout, true);
    Asset last = null;
    long delay = DECISION_POLL_FIRST_DELAY.toNanos();
    for (;;) {
      if (Thread.currentThread().isInterrupted())
        throw CalmLensException.of(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for a decision");
      Asset asset;
      try {
        asset = decode(execute(lookup, limit.isZero() ? null : timeLeft), Asset.class);
      } catch (TimeoutException failure) {
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
        throw CalmLensException.of(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for a decision", interrupted);
      }
      delay = Math.min(DECISION_POLL_MAX_DELAY.toNanos(), Math.round(delay * DECISION_POLL_DELAY_FACTOR));
    }
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("assetId", assetId);
    details.put("classificationStatus", last == null ? null : last.getClassification().getStatus().getValue());
    details.put("moderationDecision", last == null ? null : last.getClassification().getModeration().getDecision().map(AssetModerationDecision::getValue).orElse(null));
    throw CalmLensException.of(ErrorCodes.SDK_TIMEOUT, "Asset " + assetId + " did not settle within " + limit, details, 0, null, null, null, null);
  }

  /** Whether the asset is settled: its {@code classification.status} is {@code completed} or {@code failed}. */
  private static boolean isSettled(Asset asset) {
    AssetClassificationStatus status = asset.getClassification().getStatus();
    return status == AssetClassificationStatus.COMPLETED || status == AssetClassificationStatus.FAILED;
  }

  /**
   * Every item of a cursor list from the options' cursor on: {@code list} fetches the page for a
   * cursor (null for the options' own), and pages follow {@code nextCursor} while {@code hasMore}.
   */
  private static <T> AutoPager<T> pages(JsonObject options, java.util.function.Function<String, ? extends CursorPage<T>> list) {
    String first = options.has("cursor") && !options.get("cursor").isJsonNull() ? options.get("cursor").getAsString() : null;
    return new AutoPager<>(token -> {
      CursorPage<T> page = list.apply(token);
      String next = page.getNextCursor().orElse(null);
      boolean more = page.getHasMore() && next != null && !page.getItems().isEmpty();
      return new AutoPager.Chunk<>(page.getItems(), more ? next : null, more);
    }, first, false);
  }

  /** A GET of one cursor page at {@code path} with {@code query}, the cursor set when not null. */
  private <P> P page(String path, JsonObject query, String cursor, Class<P> type) {
    JsonObject sent = query.deepCopy();
    if (cursor != null) sent.addProperty("cursor", cursor);
    return decode(json("GET", path, sent, null), type);
  }




  /**
   * Signs an upload token at {@code now} (epoch milliseconds) with {@code nonce}. The claims are
   * written as JavaScript's {@code JSON.stringify} writes them, which the API verifies byte for byte.
   */
  static SignedUploadToken signUploadToken(String apiKey, @Nullable UploadTokenSignParams options, long now, String nonce) {
    if (options == null) throw argument("Params are required");
    String presetId = options.getUploadPresetId().orElse(null);
    id(presetId);
    int ttl = options.getExpiresIn().orElse(DEFAULT_UPLOAD_TOKEN_EXPIRES_IN_SECONDS);
    if (ttl < 1 || ttl > 3600) throw argument("expiresIn must be a whole number from 1 to 3600");
    String externalId = options.getExternalId().orElse(null);
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
      JsonObject token = new JsonObject();
      token.addProperty("token", "clut_" + body + "." + signature);
      token.addProperty("expiresAt", expiresAt);
      return Json.GSON.fromJson(token, SignedUploadToken.class);
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


  // ------------------------------------------------------------------ Lenses





  /** Assets: uploads, moderation, listing and management. Reached through {@link CalmLensServerClient#assets()}. */
  public final class AssetService {
    private AssetService() {}

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
     * @param params name and content, part or url
     * @return the new asset
     */
    public Asset create(AssetCreateParams params) { return create(params, null); }

    /**
     * @param params name and content, part or url
     * @param requestOptions idempotency key, deadlines, retries and headers for this call
     * @return the new asset
     */
    public Asset create(AssetCreateParams params, @Nullable RequestOptions requestOptions) {
      return with(requestOptions, "assets.create").submit(params, false, key(requestOptions));
    }

    /**
     * Uploads bytes and returns without waiting for their decision.
     *
     * @param name asset name
     * @param bytes content
     * @param mimeType MIME type, such as {@code image/png}
     * @return the new asset
     */
    public Asset create(String name, byte[] bytes, String mimeType) {
      return create(AssetCreateParams.builder().setName(name).setContent(Content.bytes(bytes, mimeType)).build());
    }

    /**
     * Uploads an asset and waits for its moderation decision ({@code wait=true}).
     *
     * @param params name and content, part or url
     * @return the classified asset
     */
    public Asset classify(AssetCreateParams params) { return classify(params, null); }

    /**
     * @param params name and content, part or url
     * @param requestOptions idempotency key, deadlines, retries and headers for this call
     * @return the classified asset
     */
    public Asset classify(AssetCreateParams params, @Nullable RequestOptions requestOptions) {
      if (params != null && params.getContent().flatMap(Content::getPlainText).map(String::isBlank).orElse(false))
        throw payloadError("Text to classify must be a non-empty string");
      return with(requestOptions, "assets.classify").submit(params, true, key(requestOptions));
    }

    /** @param params search query @return matches, best first */
    public AssetSearchResponse search(AssetSearchParams params) { return search(params, null); }

    /**
     * @param params search query
     * @param requestOptions deadlines, retries and headers for this call
     * @return matches, best first
     */
    public AssetSearchResponse search(AssetSearchParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.search");
      return c.decode(c.json("GET", project("assets/search"), encode(required(params)), null), AssetSearchResponse.class);
    }

    /** @return the first page of the project's assets, newest first */
    public AssetPage list() { return list(null, null); }

    /**
     * Lists one page of the project's assets, newest first unless {@code sort} says otherwise. Pass
     * {@code setFilter("folderId==fldr_...")} for one folder's assets.
     *
     * @param params page, filter and sort, or null for the first page
     * @return one page of assets
     */
    public AssetPage list(@Nullable AssetListParams params) { return list(params, null); }

    /**
     * @param params page, filter and sort, or null for the first page
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of assets
     */
    public AssetPage list(@Nullable AssetListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.list");
      return c.decode(c.json("GET", project("assets"), encode(params), null), AssetPage.class);
    }

    /**
     * Iterates over every matching asset, page by page, from the supplied cursor.
     *
     * @param params page size, filter and sort, or null for every asset
     * @return a lazy iterable
     */
    public AutoPager<Asset> iterate(@Nullable AssetListParams params) { return iterate(params, null); }

    /**
     * @param params page size, filter and sort, or null for every asset
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable
     */
    public AutoPager<Asset> iterate(@Nullable AssetListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.iterate");
      JsonObject o = encode(params);
      return pages(o, cursor -> c.page(project("assets"), o, cursor, AssetPage.class));
    }

    /** @param assetId the asset @return the asset */
    public Asset retrieve(String assetId) { return retrieve(assetId, null); }

    /**
     * @param assetId the asset
     * @param requestOptions deadlines, retries and headers for this call
     * @return the asset
     */
    public Asset retrieve(String assetId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.retrieve");
      return c.decode(c.json("GET", "/assets/" + id(assetId), null, null), Asset.class);
    }

    /**
     * Retrieves the asset until it is settled, waiting up to {@link #DEFAULT_DECISION_TIMEOUT}.
     *
     * @param assetId the asset
     * @return the settled asset
     * @see #waitForDecision(String, Duration, RequestOptions)
     */
    public Asset waitForDecision(String assetId) { return waitForDecision(assetId, null, null); }

    /**
     * Retrieves the asset until it is settled.
     *
     * @param assetId the asset
     * @param timeout how long to wait; {@link #DEFAULT_DECISION_TIMEOUT} when null, and zero checks once
     * @return the settled asset
     * @see #waitForDecision(String, Duration, RequestOptions)
     */
    public Asset waitForDecision(String assetId, @Nullable Duration timeout) { return waitForDecision(assetId, timeout, null); }

    /**
     * Retrieves the asset until it is settled, its {@code classification.status} {@code completed}
     * (with its decision in {@code classification.moderation.decision}) or {@code failed}, and
     * returns it. A {@code queued} or {@code processing} asset is still waiting, even when a
     * reviewer has already decided it. It waits 0.5 seconds before the second check and 1.5 times
     * longer each time after that, up to 2 seconds, never past the timeout (60 seconds by default).
     * Webhooks report decisions without polling.
     *
     * @param assetId the asset
     * @param timeout how long to wait; {@link #DEFAULT_DECISION_TIMEOUT} when null, and zero checks once
     * @param requestOptions deadlines, retries and headers for each check
     * @return the settled asset
     * @throws com.calmlens.exception.TimeoutException when the timeout passes before the asset is
     *     settled, with {@code assetId} and the last {@code classificationStatus} and {@code
     *     moderationDecision} in its details
     * @throws com.calmlens.exception.CancelledException when the thread is interrupted (the
     *     interrupt flag is kept)
     */
    public Asset waitForDecision(String assetId, @Nullable Duration timeout, @Nullable RequestOptions requestOptions) {
      return with(requestOptions, "assets.waitForDecision").awaitDecision(assetId, timeout);
    }

    /** @param assetId the asset @param params the fields to change @return the updated asset */
    public Asset update(String assetId, AssetUpdateParams params) { return update(assetId, params, null); }

    /**
     * @param assetId the asset
     * @param params the fields to change
     * @param requestOptions deadlines, retries and headers for this call
     * @return the updated asset
     */
    public Asset update(String assetId, AssetUpdateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.update");
      return c.decode(c.json("PATCH", "/assets/" + id(assetId), null, encode(required(params))), Asset.class);
    }

    /**
     * Processes an asset whose {@code classification.status} is {@code failed} again; its
     * moderation decision returns to null. Its content must still be held.
     *
     * @param assetId the asset
     * @return the asset, processing again
     */
    public Asset retry(String assetId) { return retry(assetId, null); }

    /**
     * @param assetId the asset
     * @param requestOptions deadlines, retries and headers for this call
     * @return the asset, processing again
     */
    public Asset retry(String assetId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.retry");
      return c.decode(c.json("POST", "/assets/" + id(assetId) + "/retry", null, null), Asset.class);
    }

    /**
     * Records a reviewer's decision: the moderation decision becomes {@code decision}, a manual
     * review with the note is added to {@code classification.moderation.manualReviews}, and an
     * {@code asset.<status>} event is recorded. An asset still pending moderation can only be
     * blocked or purged; purging deletes the stored content and needs the {@code assets:delete}
     * permission.
     *
     * @param assetId the asset
     * @param params the decision and note
     * @return the asset
     */
    public Asset decide(String assetId, AssetDecideParams params) { return decide(assetId, params, null); }

    /**
     * @param assetId the asset
     * @param params the decision and note
     * @param requestOptions deadlines, retries and headers for this call
     * @return the asset
     */
    public Asset decide(String assetId, AssetDecideParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.decide");
      return c.decode(c.json("POST", "/assets/" + id(assetId) + "/decision", null, encode(required(params))), Asset.class);
    }

    /**
     * Completes the policy evidence behind a decided asset's moderation decision.
     *
     * @param assetId the asset
     * @return the asset
     * @see #explain(String, AssetExplainParams, RequestOptions)
     */
    public Asset explain(String assetId) { return explain(assetId, null, null); }

    /**
     * Completes the policy evidence behind a decided asset's moderation decision.
     *
     * @param assetId the asset
     * @param params whether to moderate it again, or null
     * @return the asset
     * @see #explain(String, AssetExplainParams, RequestOptions)
     */
    public Asset explain(String assetId, @Nullable AssetExplainParams params) { return explain(assetId, params, null); }

    /**
     * Completes the policy evidence behind a decided asset's moderation decision: the report's
     * {@code classification.moderation.explanationComplete} becomes {@code true} and every action
     * stays as decided. With {@code rerun} the asset is moderated again with the project's current
     * policy, and an {@code asset.rerun-requested} event is recorded; use it when the policy
     * changed since the decision ({@code asset/policy-changed}). The asset returns unchanged: it
     * keeps its decision until the re-run's is stored, reported by {@code asset.classified} and
     * {@code asset.<status>} events, and a failed re-run keeps it. A reviewed asset fails with
     * {@code asset/reviewed}, and one whose content is gone with {@code asset/content-unavailable}.
     *
     * @param assetId the asset
     * @param params whether to moderate it again, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return the asset
     */
    public Asset explain(String assetId, @Nullable AssetExplainParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.explain");
      JsonObject body = encode(params);
      if (body.has("rerun") && !body.get("rerun").isJsonNull() && !body.get("rerun").getAsBoolean()) body.remove("rerun");
      return c.decode(c.json("POST", "/assets/" + id(assetId) + "/explain", null, body), Asset.class);
    }

    /**
     * Removes the asset's stored content (the CDN stops serving it); the record and report stay,
     * with {@code content.status} {@code removed} and {@code content.removalReason} {@code requested}.
     *
     * @param assetId the asset
     * @return the asset
     */
    public Asset removeContent(String assetId) { return removeContent(assetId, null); }

    /**
     * @param assetId the asset
     * @param requestOptions deadlines, retries and headers for this call
     * @return the asset
     */
    public Asset removeContent(String assetId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.removeContent");
      return c.decode(c.json("DELETE", "/assets/" + id(assetId) + "/content", null, null), Asset.class);
    }

    /**
     * Permanently deletes the asset record, its report and its stored content. An asset extracted
     * from another (one with a {@code parentId}) fails with {@code asset/child-not-deletable}:
     * delete its parent instead.
     *
     * @param assetId the asset
     */
    public void delete(String assetId) { delete(assetId, null); }

    /**
     * @param assetId the asset
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void delete(String assetId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.delete");
      success(c.json("DELETE", "/assets/" + id(assetId), null, null));
    }

    /**
     * Deletes up to 500 assets ({@link AssetBatchOperation#DELETE}) or removes their stored content
     * ({@link AssetBatchOperation#REMOVE_CONTENT}) in one request. Every asset must exist in the
     * project and the key needs {@code assets:delete} for its folder, and a deletion can't name an
     * asset extracted from another ({@code asset/child-not-deletable}), or nothing is queued. The
     * work runs in the background and records {@code asset.deleted} or {@code asset.content-removed}
     * for each asset, with a {@code batch-id} fact naming the response's {@code batchId}; assets
     * under a safety hold are skipped. Not retried: it carries no {@code Idempotency-Key}.
     *
     * @param params the asset IDs and the operation
     * @return the batch's ID, status and asset count
     */
    public BatchAssetsResponse batch(AssetBatchParams params) { return batch(params, null); }

    /**
     * @param params the asset IDs and the operation
     * @param requestOptions deadlines, retries and headers for this call
     * @return the batch's ID, status and asset count
     */
    public BatchAssetsResponse batch(AssetBatchParams params, @Nullable RequestOptions requestOptions) {
      validateBatch(params);
      CalmLensServerClient c = with(requestOptions, "assets.batch");
      return c.decode(c.json("POST", project("assets/batch"), null, encode(params)), BatchAssetsResponse.class);
    }

    /** @param assetId the asset @param params the target folder, or cleared for the root @return the moved asset */
    public Asset move(String assetId, AssetMoveParams params) { return move(assetId, params, null); }

    /**
     * @param assetId the asset
     * @param params the target folder, or cleared for the root
     * @param requestOptions deadlines, retries and headers for this call
     * @return the moved asset
     */
    public Asset move(String assetId, AssetMoveParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.move");
      return c.decode(c.json("POST", "/assets/" + id(assetId) + "/move", null, encode(required(params))), Asset.class);
    }

    /** @param assetId the parent asset @return the first page of its child assets */
    public AssetPage listChildren(String assetId) { return listChildren(assetId, null, null); }

    /** @param assetId the parent asset @param params the page, or null @return one page of child assets, such as images extracted from documents */
    public AssetPage listChildren(String assetId, @Nullable AssetListChildrenParams params) { return listChildren(assetId, params, null); }

    /**
     * @param assetId the parent asset
     * @param params the page, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of child assets
     */
    public AssetPage listChildren(String assetId, @Nullable AssetListChildrenParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.listChildren");
      return c.decode(c.json("GET", "/assets/" + id(assetId) + "/children", encode(params), null), AssetPage.class);
    }

    /** @param assetId the parent asset @param params page size and sort, or null @return a lazy iterable over every child */
    public AutoPager<Asset> iterateChildren(String assetId, @Nullable AssetListChildrenParams params) { return iterateChildren(assetId, params, null); }

    /**
     * @param assetId the parent asset
     * @param params page size and sort, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every child
     */
    public AutoPager<Asset> iterateChildren(String assetId, @Nullable AssetListChildrenParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.iterateChildren");
      String path = "/assets/" + id(assetId) + "/children";
      JsonObject query = encode(params);
      return pages(query, cursor -> c.page(path, query, cursor, AssetPage.class));
    }

    /**
     * Lists one page of an audio or video asset's findings timeline, in time order.
     * {@code classification.moderation.timeline.segmentCount} says how many segments there are.
     *
     * @param assetId the asset
     * @param params the page, or null
     * @return one page of timeline segments
     */
    public AssetTimelinePage listTimeline(String assetId, @Nullable AssetListTimelineParams params) { return listTimeline(assetId, params, null); }

    /**
     * @param assetId the asset
     * @param params the page, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of timeline segments
     */
    public AssetTimelinePage listTimeline(String assetId, @Nullable AssetListTimelineParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.listTimeline");
      return c.decode(c.json("GET", project("assets/" + id(assetId) + "/timeline"), encode(params), null), AssetTimelinePage.class);
    }

    /**
     * Iterates over every segment of an audio or video asset's findings timeline, in time order.
     *
     * @param assetId the asset
     * @param params page size, or null
     * @return a lazy iterable over every segment
     */
    public AutoPager<MediaClassificationSegment> iterateTimeline(String assetId, @Nullable AssetListTimelineParams params) {
      return iterateTimeline(assetId, params, null);
    }

    /**
     * @param assetId the asset
     * @param params page size, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every segment
     */
    public AutoPager<MediaClassificationSegment> iterateTimeline(String assetId, @Nullable AssetListTimelineParams params,
        @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "assets.iterateTimeline");
      String path = project("assets/" + id(assetId) + "/timeline");
      JsonObject query = encode(params);
      return pages(query, cursor -> c.page(path, query, cursor, AssetTimelinePage.class));
    }

    /**
     * Sends a later part of a multipart upload. Whether the final part waits for the decision was
     * chosen when the upload started; {@link AssetUploadPartParams.Builder#setWait(Boolean)} overrides it.
     *
     * @param assetId the uploading asset
     * @param params the part
     * @return the asset; its {@code classification.status} is {@code uploading} until the final part
     */
    public Asset uploadPart(String assetId, AssetUploadPartParams params) { return uploadPart(assetId, params, null); }

    /**
     * @param assetId the uploading asset
     * @param params the part
     * @param requestOptions idempotency key, deadlines, retries and headers for this call
     * @return the asset
     */
    public Asset uploadPart(String assetId, AssetUploadPartParams params, @Nullable RequestOptions requestOptions) {
      return with(requestOptions, "assets.uploadPart").sendPart(assetId, params, key(requestOptions));
    }
  }

  /** Text moderation. Reached through {@link CalmLensServerClient#text()}. */
  public final class TextService {
    private TextService() {}

    /**
     * Moderates text and waits for the decision.
     *
     * @param text the text
     * @return the classified text asset
     */
    public Asset classify(String text) { return classify(TextClassifyParams.builder().setText(text).build(), null); }

    /** @param params the text, name and metadata @return the classified text asset */
    public Asset classify(TextClassifyParams params) { return classify(params, null); }

    /**
     * @param params the text, name and metadata
     * @param requestOptions idempotency key, deadlines, retries and headers for this call
     * @return the classified text asset
     */
    public Asset classify(TextClassifyParams params, @Nullable RequestOptions requestOptions) {
      if (params == null || params.getText().map(String::isBlank).orElse(true)) throw argument("Text to classify must be a non-empty string");
      JsonObject o = encode(params);
      String text = o.remove("text").getAsString();
      if (!o.has("name")) o.addProperty("name", "text");
      o.add("content", Json.GSON.toJsonTree(Content.text(text)));
      AssetCreateParams upload = Json.GSON.fromJson(o, AssetCreateParams.class);
      return assets.classify(upload, requestOptions);
    }
  }

  /** Tokens that let a browser upload through an upload preset. Reached through {@link CalmLensServerClient#uploadTokens()}. */
  public final class UploadTokenService {
    private UploadTokenService() {}

    /**
     * Signs a single-use upload token with this client's API key. Makes no request.
     *
     * @param params the preset, optional external ID and lifetime ({@code expiresIn}, 1 to 3600 seconds, default 600)
     * @return the token and when it expires
     */
    public SignedUploadToken sign(UploadTokenSignParams params) {
      return signUploadToken(apiKey, params, System.currentTimeMillis(), UUID.randomUUID().toString());
    }
  }

  /** Folders. Reached through {@link CalmLensServerClient#folders()}. */
  public final class FolderService {
    private FolderService() {}

    /** @return the first page of folders at the project root */
    public FolderPage list() { return list(null, null); }

    /**
     * Lists one page of child folders (the project root without {@code parentId}), or searches
     * folder names. Pass the page's {@code nextCursor} as {@code cursor} for the next page.
     *
     * @param params parent, cursor, page size, sort and search, or null
     * @return one folder page
     */
    public FolderPage list(@Nullable FolderListParams params) { return list(params, null); }

    /**
     * @param params parent, cursor, page size, sort and search, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one folder page
     */
    public FolderPage list(@Nullable FolderListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "folders.list");
      return c.decode(c.json("GET", project("folders"), encode(params), null), FolderPage.class);
    }

    /**
     * Iterates over every child folder of {@code parentId} (or the project root), fetching pages as
     * needed.
     *
     * @param params parent, page size, sort and search, or null
     * @return a lazy iterable over every folder
     */
    public AutoPager<Folder> iterate(@Nullable FolderListParams params) { return iterate(params, null); }

    /**
     * @param params parent, page size, sort and search, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every folder
     */
    public AutoPager<Folder> iterate(@Nullable FolderListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "folders.iterate");
      JsonObject o = encode(params);
      return pages(o, cursor -> c.page(project("folders"), o, cursor, FolderPage.class));
    }

    /** @param folderId the folder @return the folder */
    public Folder retrieve(String folderId) { return retrieve(folderId, null); }

    /**
     * @param folderId the folder
     * @param requestOptions deadlines, retries and headers for this call
     * @return the folder
     */
    public Folder retrieve(String folderId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "folders.retrieve");
      return c.decode(c.json("GET", "/folders/" + id(folderId), null, null), Folder.class);
    }

    /** @param params name and parent @return the new folder */
    public Folder create(FolderCreateParams params) { return create(params, null); }

    /**
     * @param params name and parent
     * @param requestOptions deadlines, retries and headers for this call
     * @return the new folder
     */
    public Folder create(FolderCreateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "folders.create");
      return c.decode(c.json("POST", project("folders"), null, encode(required(params))), Folder.class);
    }

    /** @param folderId the folder @param params the fields to change @return the folder */
    public Folder update(String folderId, FolderUpdateParams params) { return update(folderId, params, null); }

    /**
     * @param folderId the folder
     * @param params the fields to change
     * @param requestOptions deadlines, retries and headers for this call
     * @return the folder
     */
    public Folder update(String folderId, FolderUpdateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "folders.update");
      return c.decode(c.json("PATCH", "/folders/" + id(folderId), null, encode(required(params))), Folder.class);
    }

    /** @param folderId the folder @param params the new parent, or cleared for the root @return the folder */
    public Folder move(String folderId, FolderMoveParams params) { return move(folderId, params, null); }

    /**
     * @param folderId the folder
     * @param params the new parent, or cleared for the root
     * @param requestOptions deadlines, retries and headers for this call
     * @return the folder
     */
    public Folder move(String folderId, FolderMoveParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "folders.move");
      return c.decode(c.json("POST", "/folders/" + id(folderId) + "/move", null, encode(required(params))), Folder.class);
    }

    /** Deletes an empty folder. @param folderId the folder */
    public void delete(String folderId) { delete(folderId, null); }

    /**
     * Deletes an empty folder.
     *
     * @param folderId the folder
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void delete(String folderId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "folders.delete");
      success(c.json("DELETE", "/folders/" + id(folderId), null, null));
    }
  }

  /**
   * Hash lists: PDQ perceptual hashes that image uploads are compared with. A {@code flag} list
   * reports matches in {@code classification.moderation.raw.hashMatches}; a {@code block} list also
   * blocks close matches. Reached through {@link CalmLensServerClient#hashLists()}.
   */
  public final class HashListService {
    private HashListService() {}

    /** @return the first page of the project's hash lists */
    public HashListPage list() { return list(null, null); }

    /** @param params cursor, page size and sort, or null @return one page of the project's hash lists, newest first unless {@code sort} says otherwise */
    public HashListPage list(@Nullable HashListListParams params) { return list(params, null); }

    /**
     * @param params cursor, page size and sort, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of hash lists
     */
    public HashListPage list(@Nullable HashListListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.list");
      return c.decode(c.json("GET", project("hash-lists"), encode(params), null), HashListPage.class);
    }

    /** @param params page size and sort, or null @return a lazy iterable over every hash list */
    public AutoPager<HashList> iterate(@Nullable HashListListParams params) { return iterate(params, null); }

    /**
     * @param params page size and sort, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every hash list
     */
    public AutoPager<HashList> iterate(@Nullable HashListListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.iterate");
      JsonObject o = encode(params);
      return pages(o, cursor -> c.page(project("hash-lists"), o, cursor, HashListPage.class));
    }

    /** @param hashListId the hash list @return the hash list */
    public HashList retrieve(String hashListId) { return retrieve(hashListId, null); }

    /**
     * @param hashListId the hash list
     * @param requestOptions deadlines, retries and headers for this call
     * @return the hash list
     */
    public HashList retrieve(String hashListId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.retrieve");
      return c.decode(c.json("GET", "/hash-lists/" + id(hashListId), null, null), HashList.class);
    }

    /** @param params name, action and description @return the new hash list */
    public HashList create(HashListCreateParams params) { return create(params, null); }

    /**
     * @param params name, action and description
     * @param requestOptions deadlines, retries and headers for this call
     * @return the new hash list
     */
    public HashList create(HashListCreateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.create");
      return c.decode(c.json("POST", project("hash-lists"), null, encode(required(params))), HashList.class);
    }

    /**
     * Renames a list or changes its action; the new action applies to later uploads.
     *
     * @param hashListId the hash list
     * @param params the fields to change
     * @return the hash list
     */
    public HashList update(String hashListId, HashListUpdateParams params) { return update(hashListId, params, null); }

    /**
     * @param hashListId the hash list
     * @param params the fields to change
     * @param requestOptions deadlines, retries and headers for this call
     * @return the hash list
     */
    public HashList update(String hashListId, HashListUpdateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.update");
      return c.decode(c.json("PATCH", "/hash-lists/" + id(hashListId), null, encode(required(params))), HashList.class);
    }

    /** Deletes the list and every entry in it. @param hashListId the hash list */
    public void delete(String hashListId) { delete(hashListId, null); }

    /**
     * Deletes the list and every entry in it.
     *
     * @param hashListId the hash list
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void delete(String hashListId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.delete");
      success(c.json("DELETE", "/hash-lists/" + id(hashListId), null, null));
    }

    /** @param hashListId the hash list @param params cursor, page size and sort, or null @return one page of entries, newest first unless {@code sort} says otherwise */
    public HashListEntryPage listEntries(String hashListId, @Nullable HashListListEntriesParams params) { return listEntries(hashListId, params, null); }

    /**
     * @param hashListId the hash list
     * @param params cursor, page size and sort, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of entries
     */
    public HashListEntryPage listEntries(String hashListId, @Nullable HashListListEntriesParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.listEntries");
      return c.decode(c.json("GET", "/hash-lists/" + id(hashListId) + "/entries", encode(params), null), HashListEntryPage.class);
    }

    /** @param hashListId the hash list @param params page size and sort, or null @return a lazy iterable over every entry of the list */
    public AutoPager<HashListEntry> iterateEntries(String hashListId, @Nullable HashListListEntriesParams params) {
      return iterateEntries(hashListId, params, null);
    }

    /**
     * @param hashListId the hash list
     * @param params page size and sort, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every entry of the list
     */
    public AutoPager<HashListEntry> iterateEntries(String hashListId, @Nullable HashListListEntriesParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.iterateEntries");
      String path = "/hash-lists/" + id(hashListId) + "/entries";
      JsonObject query = encode(params);
      return pages(query, cursor -> c.page(path, query, cursor, HashListEntryPage.class));
    }

    /**
     * Adds a hash, or an image asset's perceptual hash; a hash the list already holds returns its
     * existing entry.
     *
     * @param hashListId the hash list
     * @param params either a hash or an asset
     * @return the entry
     */
    public HashListEntry addEntry(String hashListId, HashListAddEntryParams params) { return addEntry(hashListId, params, null); }

    /**
     * @param hashListId the hash list
     * @param params either a hash or an asset
     * @param requestOptions deadlines, retries and headers for this call
     * @return the entry
     */
    public HashListEntry addEntry(String hashListId, HashListAddEntryParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.addEntry");
      return c.decode(c.json("POST", "/hash-lists/" + id(hashListId) + "/entries", null, encode(required(params))), HashListEntry.class);
    }

    /** Removes a hash from its list; later uploads no longer match it. @param entryId the entry */
    public void removeEntry(String entryId) { removeEntry(entryId, null); }

    /**
     * Removes a hash from its list; later uploads no longer match it.
     *
     * @param entryId the entry
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void removeEntry(String entryId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "hashLists.removeEntry");
      success(c.json("DELETE", "/hash-list-entries/" + id(entryId), null, null));
    }
  }

  /**
   * Moderation policies belong to the organisation and its projects share them. Every change sends
   * the policy's {@code revision}, so a policy changed since is refused with {@code
   * policy/revision-conflict}. Through a project's key you can change only policies no other
   * project uses. Reached through {@link CalmLensServerClient#policies()}.
   */
  public final class PolicyService {
    private PolicyService() {}

    /** @return the first page of the organisation's policies, oldest first */
    public PolicyPage list() { return list(null, null); }

    /**
     * Lists one page of the organisation's policies, oldest first unless {@code sort} says
     * otherwise. {@link #retrieveAssigned()} says which one the project uses.
     *
     * @param params cursor, page size and sort, or null
     * @return one page of policies
     */
    public PolicyPage list(@Nullable PolicyListParams params) { return list(params, null); }

    /**
     * @param params cursor, page size and sort, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of policies
     */
    public PolicyPage list(@Nullable PolicyListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.list");
      return c.decode(c.json("GET", "/policies", encode(params), null), PolicyPage.class);
    }

    /** @param params page size and sort, or null @return a lazy iterable over every policy of the organisation */
    public AutoPager<Policy> iterate(@Nullable PolicyListParams params) { return iterate(params, null); }

    /**
     * @param params page size and sort, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every policy of the organisation
     */
    public AutoPager<Policy> iterate(@Nullable PolicyListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.iterate");
      JsonObject o = encode(params);
      return pages(o, cursor -> c.page("/policies", o, cursor, PolicyPage.class));
    }

    /** @param policyId the policy @return the policy */
    public Policy retrieve(String policyId) { return retrieve(policyId, null); }

    /**
     * @param policyId the policy
     * @param requestOptions deadlines, retries and headers for this call
     * @return the policy
     */
    public Policy retrieve(String policyId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.retrieve");
      return c.decode(c.json("GET", "/policies/" + id(policyId), null, null), Policy.class);
    }

    /**
     * Creates a policy from {@code settings}, or a copy of a built-in preset with {@code presetId}.
     * It moderates nothing until it is assigned to a project or named on an upload preset.
     *
     * @param params settings and a name, or a preset
     * @return the new policy
     */
    public Policy create(PolicyCreateParams params) { return create(params, null); }

    /**
     * @param params settings and a name, or a preset
     * @param requestOptions deadlines, retries and headers for this call
     * @return the new policy
     */
    public Policy create(PolicyCreateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.create");
      return c.decode(c.json("POST", "/policies", null, encode(required(params))), Policy.class);
    }

    /**
     * Changes the name, description or settings; later moderation uses them. Saving a {@code live}
     * policy pins it under the same ID.
     *
     * @param policyId the policy
     * @param params its revision and the fields to change
     * @return the saved policy
     */
    public Policy update(String policyId, PolicyUpdateParams params) { return update(policyId, params, null); }

    /**
     * @param policyId the policy
     * @param params its revision and the fields to change
     * @param requestOptions deadlines, retries and headers for this call
     * @return the saved policy
     */
    public Policy update(String policyId, PolicyUpdateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.update");
      return c.decode(c.json("PATCH", "/policies/" + id(policyId), null, encode(required(params))), Policy.class);
    }

    /**
     * Restores the settings of the preset release a {@code pinned} or {@code copy} policy is at,
     * discarding its edits.
     *
     * @param policyId the policy
     * @param params its revision and the {@code preset.version} you reviewed
     * @return the saved policy
     */
    public Policy reset(String policyId, PolicyResetParams params) { return reset(policyId, params, null); }

    /**
     * @param policyId the policy
     * @param params its revision and the {@code preset.version} you reviewed
     * @param requestOptions deadlines, retries and headers for this call
     * @return the saved policy
     */
    public Policy reset(String policyId, PolicyResetParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.reset");
      return c.decode(c.json("POST", "/policies/" + id(policyId) + "/reset", null, encode(required(params))), Policy.class);
    }

    /**
     * Moves a {@code pinned} or {@code copy} policy whose settings are unchanged from its preset
     * release to the latest release of the preset.
     *
     * @param policyId the policy
     * @param params its revision and the {@code preset.latestVersion} you reviewed
     * @return the saved policy
     */
    public Policy upgrade(String policyId, PolicyUpgradeParams params) { return upgrade(policyId, params, null); }

    /**
     * @param policyId the policy
     * @param params its revision and the {@code preset.latestVersion} you reviewed
     * @param requestOptions deadlines, retries and headers for this call
     * @return the saved policy
     */
    public Policy upgrade(String policyId, PolicyUpgradeParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.upgrade");
      return c.decode(c.json("POST", "/policies/" + id(policyId) + "/upgrade", null, encode(required(params))), Policy.class);
    }

    /**
     * Switches automatic updates on ({@code live}) or off ({@code pinned}) for the organisation's
     * own preset policy.
     *
     * @param policyId the policy
     * @param params whether it follows the preset, its revision and the preset version
     * @return the saved policy
     */
    public Policy setAutomaticUpdates(String policyId, PolicySetAutomaticUpdatesParams params) { return setAutomaticUpdates(policyId, params, null); }

    /**
     * @param policyId the policy
     * @param params whether it follows the preset, its revision and the preset version
     * @param requestOptions deadlines, retries and headers for this call
     * @return the saved policy
     */
    public Policy setAutomaticUpdates(String policyId, PolicySetAutomaticUpdatesParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.setAutomaticUpdates");
      return c.decode(c.json("PUT", "/policies/" + id(policyId) + "/automatic-updates", null, encode(required(params))), Policy.class);
    }

    /** Deletes a policy that no project or upload preset uses. @param policyId the policy */
    public void delete(String policyId) { delete(policyId, null); }

    /**
     * Deletes a policy that no project or upload preset uses.
     *
     * @param policyId the policy
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void delete(String policyId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.delete");
      success(c.json("DELETE", "/policies/" + id(policyId), null, null));
    }

    /** @return the policy the project moderates with */
    public Policy retrieveAssigned() { return retrieveAssigned(null); }

    /**
     * @param requestOptions deadlines, retries and headers for this call
     * @return the policy the project moderates with
     */
    public Policy retrieveAssigned(@Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.retrieveAssigned");
      return c.decode(c.json("GET", project("policy"), null, null), Policy.class);
    }

    /** Chooses the policy the project moderates with. @param policyId the policy @return the policy */
    public Policy assign(String policyId) { return assign(policyId, null); }

    /**
     * Chooses the policy the project moderates with.
     *
     * @param policyId the policy
     * @param requestOptions deadlines, retries and headers for this call
     * @return the policy
     */
    public Policy assign(String policyId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "policies.assign");
      JsonObject body = new JsonObject();
      body.addProperty("policyId", policyId);
      return c.decode(c.json("PUT", project("policy"), null, body), Policy.class);
    }
  }

  /**
   * The project's upload presets: the rules for uploads from browsers and apps. {@link #ensure}
   * creates or replaces presets by key, for deploys that declare them in code; send each preset's
   * {@code revision} to refuse a change made since you read it. Reached through {@link
   * CalmLensServerClient#uploadPresets()}.
   */
  public final class UploadPresetService {
    private UploadPresetService() {}

    /** @return the first page of the project's upload presets, oldest first */
    public UploadPresetPage list() { return list(null, null); }

    /** @param params cursor, page size and sort, or null @return one page of the project's upload presets, oldest first unless {@code sort} says otherwise */
    public UploadPresetPage list(@Nullable UploadPresetListParams params) { return list(params, null); }

    /**
     * @param params cursor, page size and sort, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of upload presets
     */
    public UploadPresetPage list(@Nullable UploadPresetListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "uploadPresets.list");
      return c.decode(c.json("GET", project("upload-presets"), encode(params), null), UploadPresetPage.class);
    }

    /** @param params page size and sort, or null @return a lazy iterable over every upload preset of the project */
    public AutoPager<UploadPreset> iterate(@Nullable UploadPresetListParams params) { return iterate(params, null); }

    /**
     * @param params page size and sort, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every upload preset of the project
     */
    public AutoPager<UploadPreset> iterate(@Nullable UploadPresetListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "uploadPresets.iterate");
      JsonObject o = encode(params);
      return pages(o, cursor -> c.page(project("upload-presets"), o, cursor, UploadPresetPage.class));
    }

    /**
     * Creates each preset, or replaces it with the definition sent, by key. Every preset is checked
     * before any is saved; an unchanged preset keeps its revision.
     *
     * @param uploadPresets the preset definitions
     * @return the stored presets, in the order sent
     */
    public EnsureUploadPresetsResponse ensure(List<UploadPresetParams> uploadPresets) { return ensure(uploadPresets, null); }

    /**
     * @param uploadPresets the preset definitions
     * @param requestOptions deadlines, retries and headers for this call
     * @return the stored presets, in the order sent
     */
    public EnsureUploadPresetsResponse ensure(List<UploadPresetParams> uploadPresets, @Nullable RequestOptions requestOptions) {
      if (uploadPresets == null) throw argument("uploadPresets is required");
      CalmLensServerClient c = with(requestOptions, "uploadPresets.ensure");
      JsonObject body = new JsonObject();
      body.add("uploadPresets", Json.GSON.toJsonTree(uploadPresets));
      return c.decode(c.json("PUT", project("upload-presets"), null, body), EnsureUploadPresetsResponse.class);
    }

    /** Deletes an upload preset; assets already uploaded through it stay. @param uploadPresetId the upload preset */
    public void delete(String uploadPresetId) { delete(uploadPresetId, null); }

    /**
     * Deletes an upload preset; assets already uploaded through it stay.
     *
     * @param uploadPresetId the upload preset
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void delete(String uploadPresetId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "uploadPresets.delete");
      success(c.json("DELETE", "/upload-presets/" + id(uploadPresetId), null, null));
    }
  }

  /**
   * The project's settings, with defaults filled in. {@link #update} replaces them: settings left
   * out return to their defaults. Send the {@code revision} you read to refuse a change made since.
   * Reached through {@link CalmLensServerClient#projectSettings()}.
   */
  public final class ProjectSettingsService {
    private ProjectSettingsService() {}

    /** @return the project's settings and their revision */
    public ProjectSettingsResource get() { return get(null); }

    /**
     * @param requestOptions deadlines, retries and headers for this call
     * @return the project's settings and their revision
     */
    public ProjectSettingsResource get(@Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "projectSettings.get");
      return c.decode(c.json("GET", project("settings"), null, null), ProjectSettingsResource.class);
    }

    /** @param params the complete settings and, optionally, the revision you read @return the saved settings */
    public ProjectSettingsResource update(ProjectSettingsUpdateParams params) { return update(params, null); }

    /**
     * @param params the complete settings and, optionally, the revision you read
     * @param requestOptions deadlines, retries and headers for this call
     * @return the saved settings
     */
    public ProjectSettingsResource update(ProjectSettingsUpdateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "projectSettings.update");
      return c.decode(c.json("PUT", project("settings"), null, encode(required(params))), ProjectSettingsResource.class);
    }
  }

  /**
   * The project's metadata fields. They share the project settings' {@code revision}; {@link
   * #ensure} creates or replaces fields by ID and keeps the others. Reached through {@link
   * CalmLensServerClient#metadataFields()}.
   */
  public final class MetadataFieldService {
    private MetadataFieldService() {}

    /** @return the project's metadata fields and their revision */
    public MetadataFieldsResource list() { return list(null); }

    /**
     * @param requestOptions deadlines, retries and headers for this call
     * @return the project's metadata fields and their revision
     */
    public MetadataFieldsResource list(@Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "metadataFields.list");
      return c.decode(c.json("GET", project("metadata-fields"), null, null), MetadataFieldsResource.class);
    }

    /** @param params the fields to create or replace and, optionally, the revision you read @return every field after the change */
    public MetadataFieldsResource ensure(MetadataFieldsEnsureParams params) { return ensure(params, null); }

    /**
     * @param params the fields to create or replace and, optionally, the revision you read
     * @param requestOptions deadlines, retries and headers for this call
     * @return every field after the change
     */
    public MetadataFieldsResource ensure(MetadataFieldsEnsureParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "metadataFields.ensure");
      return c.decode(c.json("PUT", project("metadata-fields"), null, encode(required(params))), MetadataFieldsResource.class);
    }

    /** Deletes a field definition; assets keep their values. @param fieldId the field */
    public void delete(String fieldId) { delete(fieldId, null, null); }

    /**
     * Deletes a field definition; assets keep their values.
     *
     * @param fieldId the field
     * @param params the revision you read, or null
     */
    public void delete(String fieldId, @Nullable MetadataFieldsDeleteParams params) { delete(fieldId, params, null); }

    /**
     * @param fieldId the field
     * @param params the revision you read, or null
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void delete(String fieldId, @Nullable MetadataFieldsDeleteParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "metadataFields.delete");
      success(c.json("DELETE", project("metadata-fields/" + id(fieldId)), encode(params), null));
    }
  }

  /** The events feed. Prefer webhooks in production. Reached through {@link CalmLensServerClient#events()}. */
  public final class EventService {
    private EventService() {}

    /** The query for {@code params}: the API takes {@code types} as one comma-separated value. */
    private JsonObject eventsQuery(@Nullable EventListParams params) {
      JsonObject query = encode(params);
      if (query.has("types")) {
        List<String> types = new ArrayList<>();
        query.remove("types").getAsJsonArray().forEach(type -> types.add(type.getAsString()));
        if (!types.isEmpty()) query.addProperty("types", String.join(",", types));
      }
      return query;
    }

    /** @return no events, and a {@code nextCursor} for the current time */
    public EventsPage list() { return list(null, null); }

    /**
     * Lists events after a cursor. Without {@code cursor} it returns no events and a
     * {@code nextCursor} for the current time. {@code types} and {@code assetId} narrow the feed to
     * some event types or one asset's events; pass the same filters with each {@code cursor}.
     *
     * @param params cursor, page size and filters, or null
     * @return one page of events
     */
    public EventsPage list(@Nullable EventListParams params) { return list(params, null); }

    /**
     * @param params cursor, page size and filters, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of events
     */
    public EventsPage list(@Nullable EventListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "events.list");
      return c.decode(c.json("GET", project("events"), eventsQuery(params), null), EventsPage.class);
    }

    /**
     * Yields every event after {@code cursor}, page by page, until no more are waiting. Without
     * {@code cursor} it starts from now, so it yields nothing; use {@link #pages} to keep each
     * page's {@code nextCursor} and resume later.
     *
     * @param params cursor, page size and filters, or null
     * @return a lazy iterable of events
     */
    public AutoPager<Event> iterate(@Nullable EventListParams params) { return iterate(params, null); }

    /**
     * @param params cursor, page size and filters, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable of events
     */
    public AutoPager<Event> iterate(@Nullable EventListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "events.iterate");
      JsonObject o = eventsQuery(params);
      return new AutoPager<>(token -> {
        JsonObject query = o.deepCopy();
        if (token != null) query.addProperty("cursor", token);
        EventsPage page = c.decode(c.json("GET", project("events"), query, null), EventsPage.class);
        String next = page.getNextCursor();
        if (next == null || next.isEmpty())
          throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "Events page has no nextCursor", null, 200, Map.of(), null, null, null);
        return new AutoPager.Chunk<>(page.getItems(), next, page.getHasMore());
      }, str(o, "cursor", null), true);
    }

    /**
     * Yields pages of events after {@code cursor} until no more are waiting. Save each page's
     * {@code getNextCursor()} after handling it to resume later. Without {@code cursor}, it yields
     * one empty page whose cursor is "now". Each page keeps the filters of {@code params}.
     *
     * @param params cursor, page size and filters, or null
     * @return a lazy iterable of pages
     */
    public AutoPager<EventsPage> pages(@Nullable EventListParams params) { return pages(params, null); }

    /**
     * @param params cursor, page size and filters, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable of pages
     */
    public AutoPager<EventsPage> pages(@Nullable EventListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "events.pages");
      JsonObject o = eventsQuery(params);
      return new AutoPager<>(token -> {
        JsonObject query = o.deepCopy();
        if (token != null) query.addProperty("cursor", token);
        EventsPage page = c.decode(c.json("GET", project("events"), query, null), EventsPage.class);
        String next = page.getNextCursor();
        if (next == null || next.isEmpty())
          throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "Events page has no nextCursor", null, 200, Map.of(), null, null, null);
        return new AutoPager.Chunk<>(List.of(page), next, page.getHasMore());
      }, str(o, "cursor", null), true);
    }
  }

  /**
   * CDN URLs, signed asset URLs, asset display info and downloads. Reached through {@link
   * CalmLensServerClient#cdn()}.
   *
   * <p>Every asset has one URL, {@code {cdnBaseUrl}/assets/{projectId}/{asset}}, and each resource
   * is a path beneath it ({@link #CDN_RESOURCES}). The asset segment is the asset ID or {@code
   * ext:} and the URL-encoded external ID for a public asset, or a signed grant for a private one:
   * use {@link #signAssetUrl} if the asset is private, {@link #getAssetUrl} otherwise, and add
   * viewer claims to either.
   */
  public final class CdnService {
    private CdnService() {}

    private String assetUrl(JsonObject o, @Nullable Object transform) {
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
     * @param params the asset, resource, selector and viewer claims
     * @return the URL
     * @throws com.calmlens.exception.InvalidArgumentException for invalid params
     */
    public String getAssetUrl(CdnRequestParams params) {
      return assetUrl(encode(required(params)), params.getTransform().orElse(null));
    }

    /**
     * Signs a private asset's URL on your server, so browsers and apps can load it without an API
     * key until it expires. Every resource is a path beneath it, as beneath a public asset URL; the
     * {@code original} only when signed with {@code setOriginal(true)}. With a {@code resource}, it
     * returns that resource's URL beneath the grant, with the lens, transform and viewer claims
     * appended as {@link #getAssetUrl} appends them. The params are checked before anything is
     * sent; the lifetime defaults to {@link #DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS}.
     *
     * @param params the asset, lifetime, original access and the location beneath the grant
     * @return the signed URL and its expiry
     * @throws com.calmlens.exception.InvalidArgumentException for invalid params
     */
    public SignedAssetUrl signAssetUrl(CdnSignAssetUrlParams params) { return signAssetUrl(params, null); }

    /**
     * @param params the asset, lifetime, original access and the location beneath the grant
     * @param requestOptions deadlines, retries and headers for this call
     * @return the signed URL and its expiry
     */
    public SignedAssetUrl signAssetUrl(CdnSignAssetUrlParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "cdn.signAssetUrl");
      JsonObject o = encode(required(params));
      Object transform = params.getTransform().orElse(null);
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
      Reply reply = c.json("POST", path, null, body);
      SignedAssetUrl signed = c.decode(reply, SignedAssetUrl.class);
      if (signed.getUrl().isEmpty())
        throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "The API returned no signed asset URL", null, 200, Map.of(), null, null, null);
      JsonObject located = object(reply).deepCopy();
      located.addProperty("url", appendAssetLocation(signed.getUrl(), o, transform));
      return Json.GSON.fromJson(located, SignedAssetUrl.class);
    }

    /**
     * Fetches the display info of an asset URL, public or signed ({@code {url}/info}), for the
     * viewer claims the URL carries.
     *
     * @param url an asset URL from {@link #getAssetUrl} or {@link #signAssetUrl}, without a resource
     * @return the asset's type, size, rendered file, preview and stream, and whether the viewer can see it
     * @see #getAssetInfo(String, ViewerClaims, RequestOptions)
     */
    public AssetInfo getAssetInfo(String url) { return getAssetInfo(url, null, null); }

    /**
     * @param url an asset URL from {@link #getAssetUrl} or {@link #signAssetUrl}, without a resource
     * @param viewerClaims the viewer's claims, replacing those the URL carries; null keeps the URL's
     * @return the display info
     * @see #getAssetInfo(String, ViewerClaims, RequestOptions)
     */
    public AssetInfo getAssetInfo(String url, @Nullable ViewerClaims viewerClaims) { return getAssetInfo(url, viewerClaims, null); }

    /**
     * Fetches the display info of an asset URL, public or signed ({@code {url}/info}): its type,
     * size, rendered file, preview and stream, and whether the viewer its claims describe can see
     * it. It sends no API key, as a browser would, and is retried like API reads. A refusal throws
     * an {@link ApiException} with the CDN's code, such as {@link ErrorCodes#SIGNED_URL_EXPIRED} or
     * {@code asset/not-available}.
     *
     * @param url an asset URL from {@link #getAssetUrl} or {@link #signAssetUrl}, without a resource
     * @param viewerClaims the viewer's claims, replacing those the URL carries; null keeps the URL's
     * @param requestOptions deadlines, retries and headers for this call
     * @return the display info
     * @throws com.calmlens.exception.InvalidArgumentException when the URL isn't absolute or its
     *     claims are invalid
     */
    public AssetInfo getAssetInfo(String url, @Nullable ViewerClaims viewerClaims, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "cdn.getAssetInfo");
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
      Map<String, String> headers = new LinkedHashMap<>(c.extraHeaders);
      headers.put("User-Agent", userAgent);
      headers.put("Accept", "application/json");
      Reply reply = c.execute(new Call("GET", base + "/info" + viewerClaimsQuery(claims), headers, null, c.timeout, true));
      try {
        return c.decode(reply, AssetInfo.class);
      } catch (InvalidResponseException invalid) {
        throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "The CDN returned no asset info", null, reply.status(), reply.headers(), null, null, invalid);
      }
    }

    /**
     * Streams an asset from the CDN with the API key. Every status but a redirect is returned
     * (redirects fail with {@link ErrorCodes#SDK_HTTP_ERROR} and are never followed); close the
     * response when done. Transport failures and HTTP 429, 500, 502, 503 and 504 are retried like API
     * reads, and once retries run out the last response is returned.
     *
     * @param params the asset, selector, method and headers
     * @return the streamed response
     */
    public CdnResponse serve(CdnRequestParams params) { return serve(params, null); }

    /**
     * @param params the asset, selector, method and headers
     * @param requestOptions {@code timeout} (the wait for the response headers and between received
     *     bytes), {@code maxRetries} and headers for this call
     * @return the streamed response
     */
    public CdnResponse serve(CdnRequestParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "cdn.serve");
      JsonObject o = encode(required(params));
      if (!o.has("resource")) o.addProperty("resource", "rendered");
      String url = assetUrl(o, params.getTransform().orElse(null));
      // No Accept unless the caller sets one: the CDN answers with the content's own type.
      Map<String, String> headers = c.baseHeaders(null);
      HttpOptions init = params.getInit().orElse(null);
      String method = init == null || init.getMethod().isEmpty() ? "GET" : init.getMethod().get().toUpperCase(Locale.ROOT);
      if (!method.equals("GET") && !method.equals("HEAD")) throw argument("CDN requests use GET or HEAD");
      if (init != null && init.getHeaders().isPresent())
        init.getHeaders().get().forEach((name, value) -> { if (name == null || !name.equalsIgnoreCase("X-Api-Key")) header(headers, name, value); });
      Call call = new Call(method, url, headers, null, c.timeout, true);
      for (int attempt = 0; ; attempt++) {
        Transport.Response response;
        try {
          response = c.send(call);
        } catch (ConnectionException | TimeoutException failure) {
          if (c.canRetry(call, attempt) && !Thread.currentThread().isInterrupted()) { c.pause(retryDelay(attempt, ThreadLocalRandom.current().nextDouble())); continue; }
          throw failure;
        }
        if (isRedirect(response.status())) {
          try { response.close(); } catch (IOException ignored) { /* failing */ }
          throw CalmLensException.of(ErrorCodes.SDK_HTTP_ERROR, "Unexpected redirect (HTTP " + response.status() + ")", null, response.status(), response.headers(), null, null, null);
        }
        if (retryableStatus(response.status()) && c.canRetry(call, attempt)) {
          Duration retryAfter = CalmLensException.retryAfter(response.header("retry-after"));
          Duration wait = retryAfter != null ? retryAfter : retryDelay(attempt, ThreadLocalRandom.current().nextDouble());
          if (wait.compareTo(RETRY_AFTER_MAX) <= 0) {
            try { response.close(); } catch (IOException ignored) { /* retrying */ }
            c.pause(wait);
            continue;
          }
        }
        return new CdnResponse(response, new Timeouts.IdleTimeoutInputStream(response.body(), c.timeout));
      }
    }
  }

  // ------------------------------------------------------------------ Lenses

  /**
   * The project's lenses: named image transforms the CDN applies at {@code /@<identifier>}. The CDN
   * serves files made with each lens's current definition. {@link #ensureLenses} creates or changes
   * lenses by identifier, for applications that declare theirs in code. Reached through {@link
   * CalmLensServerClient#lenses()}.
   */
  public final class LensService {
    private LensService() {}

    /** A lens changed here no longer has the definition {@code ensureLens} cached for it. */
    private void forget(java.util.function.Predicate<Lens> matches) {
      lensCache.ensured.values().removeIf(matches);
    }

    /** @return the first page of the project's lenses, newest first */
    public LensPage list() { return list(null, null); }

    /** @param params cursor, page size and sort, or null @return one page of the project's lenses, newest first unless {@code sort} says otherwise */
    public LensPage list(@Nullable LensListParams params) { return list(params, null); }

    /**
     * @param params cursor, page size and sort, or null
     * @param requestOptions deadlines, retries and headers for this call
     * @return one page of lenses
     */
    public LensPage list(@Nullable LensListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "lenses.list");
      return c.decode(c.json("GET", project("lenses"), encode(params), null), LensPage.class);
    }

    /** @param params page size and sort, or null @return a lazy iterable over every lens of the project */
    public AutoPager<Lens> iterate(@Nullable LensListParams params) { return iterate(params, null); }

    /**
     * @param params page size and sort, or null
     * @param requestOptions deadlines, retries and headers for each page's request
     * @return a lazy iterable over every lens of the project
     */
    public AutoPager<Lens> iterate(@Nullable LensListParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "lenses.iterate");
      JsonObject o = encode(params);
      return pages(o, cursor -> c.page(project("lenses"), o, cursor, LensPage.class));
    }

    /**
     * Creates a lens; its identifier must be new to the project ({@code lens/identifier-taken}
     * otherwise).
     *
     * @param params the lens definition
     * @return the new lens
     */
    public Lens create(LensCreateParams params) { return create(params, null); }

    /**
     * @param params the lens definition
     * @param requestOptions deadlines, retries and headers for this call
     * @return the new lens
     */
    public Lens create(LensCreateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "lenses.create");
      Lens lens = c.decode(c.json("POST", project("lenses"), null, encode(required(params))), Lens.class);
      forget(cached -> cached.getIdentifier().equals(lens.getIdentifier()));
      return lens;
    }

    /** @param lensId the lens @return the lens */
    public Lens retrieve(String lensId) { return retrieve(lensId, null); }

    /**
     * @param lensId the lens
     * @param requestOptions deadlines, retries and headers for this call
     * @return the lens
     */
    public Lens retrieve(String lensId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "lenses.retrieve");
      return c.decode(c.json("GET", "/lenses/" + id(lensId), null, null), Lens.class);
    }

    /**
     * Changes a lens's name, description, type, transform or whether the CDN serves it.
     *
     * @param lensId the lens
     * @param params the fields to change
     * @return the saved lens
     */
    public Lens update(String lensId, LensUpdateParams params) { return update(lensId, params, null); }

    /**
     * @param lensId the lens
     * @param params the fields to change
     * @param requestOptions deadlines, retries and headers for this call
     * @return the saved lens
     */
    public Lens update(String lensId, LensUpdateParams params, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "lenses.update");
      Lens lens = c.decode(c.json("PATCH", "/lenses/" + id(lensId), null, encode(required(params))), Lens.class);
      forget(cached -> cached.getId().equals(lens.getId()));
      return lens;
    }

    /** Deletes a lens; URLs that select it stop being served. @param lensId the lens */
    public void delete(String lensId) { delete(lensId, null); }

    /**
     * Deletes a lens; URLs that select it stop being served.
     *
     * @param lensId the lens
     * @param requestOptions deadlines, retries and headers for this call
     */
    public void delete(String lensId, @Nullable RequestOptions requestOptions) {
      CalmLensServerClient c = with(requestOptions, "lenses.delete");
      success(c.json("DELETE", "/lenses/" + id(lensId), null, null));
      forget(cached -> cached.getId().equals(lensId));
    }
  }

  /**
   * Creates a named lens, or changes it to this definition. Sending the same definition again
   * returns the lens unchanged, from this client's lens cache once it has seen it.
   *
   * @param params the lens definition
   * @return the lens
   */
  public Lens ensureLens(LensCreateParams params) { return ensureLenses(List.of(required(params))).get(0); }

  /** The most lens definitions {@link #ensureLenses} sends in one request. */
  public static final int ENSURE_LENSES_MAX_PER_REQUEST = 100;

  /**
   * Creates or changes lenses by identifier, as {@link #ensureLens} does.
   *
   * @param lenses the lens definitions
   * @return the lenses, in the order given
   * @see #ensureLenses(List, RequestOptions)
   */
  public List<Lens> ensureLenses(List<LensCreateParams> lenses) { return ensureLenses(lenses, null); }

  /**
   * Creates or changes lenses by identifier, as {@link #ensureLens} does. Definitions already
   * ensured by this client (or a client derived from it with {@link #withRequestOptions}) are not
   * sent again, and concurrent calls for the same new definitions share one request. More than
   * {@link #ENSURE_LENSES_MAX_PER_REQUEST} new definitions are sent in consecutive requests, in
   * order.
   *
   * @param lenses the lens definitions
   * @param requestOptions deadlines, retries and headers for each request
   * @return the lenses, in the order given
   */
  public List<Lens> ensureLenses(List<LensCreateParams> lenses, @Nullable RequestOptions requestOptions) {
    CalmLensServerClient c = with(requestOptions, "ensureLenses");
    if (lenses == null || lenses.isEmpty()) throw argument("At least one lens is required");
    JsonArray definitions = Json.GSON.toJsonTree(lenses).getAsJsonArray();
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
          c.submitLenses(new ArrayList<>(missing.values()));
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
          throw CalmLensException.of(ErrorCodes.SDK_CANCELLED, "Interrupted while waiting for lenses", interrupted);
        } catch (java.util.concurrent.ExecutionException failed) {
          if (failed.getCause() instanceof RuntimeException cause) throw cause;
          throw new IllegalStateException(failed.getCause());
        }
      }
    }
    List<Lens> result = new ArrayList<>();
    for (int i = 0; i < keys.size(); i++) {
      Lens lens = lensCache.ensured.get(keys.get(i));
      // Another call may have replaced this definition with a changed one meanwhile.
      if (lens == null) throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "CalmLens did not return lens \"" + str(definitions.get(i).getAsJsonObject(), "identifier", "") + "\"");
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
        throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "Expected " + chunk.size() + " lenses but CalmLens returned " + count);
      Lens[] created = decode(new Reply(reply.status(), reply.headers(), reply.body(), returned), Lens[].class);
      for (int index = 0; index < chunk.size(); index++) {
        Lens lens = created[index];
        String identifier = str(chunk.get(index), "identifier", "");
        if (lens == null || !identifier.equals(lens.getIdentifier()))
          throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "Expected lens \"" + identifier + "\" at position " + index);
        lensCache.ensured.entrySet().removeIf(cached -> identifier.equals(cached.getValue().getIdentifier()));
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
  public static WebhookEventPayload toWebhookEventPayload(Event event) {
    // From the event as received, so asset and fact fields this SDK version does not model are kept.
    JsonObject json = event.getRawJsonObject();
    JsonObject payload = new JsonObject();
    for (String key : List.of("id", "projectId", "actor", "type", "severity", "title", "description", "assetId", "assetSequence", "asset"))
      // A delivery's actor is optional: one the event lacks stays out.
      if (!key.equals("actor") || json.has(key)) payload.add(key, json.has(key) ? json.get(key) : JsonNull.INSTANCE);
    payload.add("facts", json.has("facts") ? json.get("facts") : new JsonArray());
    payload.add("createdAt", json.get("createdAt"));
    return Json.GSON.fromJson(payload, WebhookEventPayload.class);
  }

  /**
   * Whether an event is a test send from the portal or API: its facts include {@code { key: "test",
   * value: true }}. Other values, keys in another case and missing facts are not.
   *
   * @param event a parsed delivery
   * @return whether it is a test send
   */
  public static boolean isTestWebhookEvent(WebhookEventPayload event) {
    return event != null && isTestFacts(event.getFacts());
  }

  /**
   * @param event an event from {@code events.list}
   * @return whether it is a test send
   */
  public static boolean isTestWebhookEvent(Event event) { return event != null && isTestFacts(event.getFacts()); }

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
  public static Object getEventFact(WebhookEventPayload event, String key) { return event == null ? null : factValue(event.getFacts(), key); }

  /**
   * @param event an event from {@code events.list}
   * @param key the fact key
   * @return the fact's value, or null
   */
  public static Object getEventFact(Event event, String key) { return event == null ? null : factValue(event.getFacts(), key); }

  /**
   * An event's facts as values by key, in the event's order, such as {@code {"flagged-categories":
   * ["hate"]}}. A key the event repeats keeps its first value, as {@link
   * #getEventFact(WebhookEventPayload, String)} reads it; a null value is kept.
   *
   * @param event a parsed delivery
   * @return the values by key, unmodifiable
   */
  public static Map<String, Object> getEventFacts(WebhookEventPayload event) { return factValues(event == null ? null : event.getFacts()); }

  /**
   * @param event an event from {@code events.list}
   * @return the values by key, unmodifiable
   */
  public static Map<String, Object> getEventFacts(Event event) { return factValues(event == null ? null : event.getFacts()); }

  private static Object factValue(List<EventFact> facts, String key) {
    if (facts != null) for (EventFact fact : facts) if (fact != null && Objects.equals(fact.getKey(), key)) return fact.getValue();
    return null;
  }

  private static Map<String, Object> factValues(List<EventFact> facts) {
    Map<String, Object> values = new LinkedHashMap<>();
    if (facts != null) for (EventFact fact : facts) if (fact != null && !values.containsKey(fact.getKey())) values.put(fact.getKey(), fact.getValue());
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
  public static boolean isNewerAssetEvent(WebhookEventPayload event, Long lastSequence) {
    return isNewerSequence(event.getAssetSequence().orElse(null), lastSequence);
  }

  /**
   * @param event an event from {@code events.list}
   * @param lastSequence the highest {@code assetSequence} applied for the event's asset, or null
   * @return whether the event is newer than what you have applied
   */
  public static boolean isNewerAssetEvent(Event event, Long lastSequence) {
    return isNewerSequence(event.getAssetSequence().orElse(null), lastSequence);
  }

  private static boolean isNewerSequence(Long sequence, Long lastSequence) {
    return sequence == null || lastSequence == null || sequence > lastSequence;
  }

  private static boolean isTestFacts(List<EventFact> facts) {
    return facts != null && facts.stream().anyMatch(fact -> fact != null && "test".equals(fact.getKey()) && Boolean.TRUE.equals(fact.getValue()));
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
  public static WebhookEventPayload parseWebhookRequest(Map<String, ?> headers, byte[] payload, String secret) {
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
  public static WebhookEventPayload parseWebhookRequest(Map<String, ?> headers, byte[] payload, String secret, long nowSeconds, long toleranceSeconds) {
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
  public static WebhookEventPayload parseWebhookEvent(byte[] payload, String signature, String timestamp, String secret) {
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
  public static WebhookEventPayload parseWebhookEvent(byte[] payload, String signature, String timestamp, String secret, long nowSeconds, long toleranceSeconds) {
    if (!verifyWebhookSignature(payload, signature, timestamp, secret, nowSeconds, toleranceSeconds))
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE, "Webhook signature or timestamp did not verify");
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
  public static WebhookEventPayload parseWebhookEvent(String payload, String signature, String timestamp, String secret) {
    if (payload == null) throw CalmLensException.of(ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE, "Webhook body is required");
    return parseWebhookEvent(payload.getBytes(StandardCharsets.UTF_8), signature, timestamp, secret);
  }

  /**
   * Reads a verified body like the API's receiver schema: a JSON object with string {@code id},
   * {@code type} and {@code projectId} and a numeric {@code createdAt}; the other known fields, when
   * present, have the API's types. Unknown fields are kept in {@code json()}.
   */
  static WebhookEventPayload readWebhookEvent(String payload) {
    JsonElement json;
    try {
      json = payload == null ? null : Json.GSON.fromJson(payload, JsonElement.class);
    } catch (JsonParseException | IllegalStateException cause) {
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not JSON", cause);
    }
    if (json == null || !isWebhookEvent(json))
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not a CalmLens event");
    try {
      return Json.GSON.fromJson(json, WebhookEventPayload.class);
    } catch (JsonParseException | IllegalStateException | IllegalArgumentException cause) {
      throw CalmLensException.of(ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD, "Webhook body is not a CalmLens event", cause);
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
