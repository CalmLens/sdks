package com.calmlens;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * The in-memory API and CDN behind {@link MockCalmLensServerClient}. It answers with the real
 * routes' status codes, JSON error bodies and headers, and keeps assets, folders, events and
 * content in {@link MockCalmLensServerClient.Storage}. Callers hold the mock's lock.
 */
final class MockApi {
  /** An API error to answer with. */
  static final class Failure extends Exception {
    private static final long serialVersionUID = 1L;
    final String code;
    final int status;
    final transient Map<String, Object> details;

    Failure(String code) { this(code, ErrorCodes.httpStatus(code).orElse(400), code); }

    Failure(String code, String message) { this(code, ErrorCodes.httpStatus(code).orElse(400), message); }

    Failure(String code, int status, String message) { this(code, status, message, null); }

    Failure(String code, int status, String message, Map<String, Object> details) {
      super(message);
      this.code = code;
      this.status = status;
      this.details = details;
    }

    /** An API error with details, at its HTTP status. */
    static Failure of(String code, Map<String, Object> details) { return new Failure(code, ErrorCodes.httpStatus(code).orElse(400), code, details); }

    /** A request the API's schema refuses: {@code validation/<issue>}, HTTP 400 and the field as {@code path}. */
    static Failure validation(String code, String path) { return new Failure(code, 400, "Invalid " + path, Map.of("path", path)); }
  }

  private record Saved(String fingerprint, int status, byte[] body) {}

  private static final Set<String> JSON_QUERY = Set.of("metadata", "processingOptions");
  private static final Set<String> INT_QUERY = Set.of("pageSize", "pageIndex", "limit", "partNumber", "sizeInBytes", "totalSizeInBytes");
  private static final Set<String> BOOL_QUERY = Set.of("queue", "isFinal", "searchAll", "resolveOnly");
  private static final Pattern ORDERING = Pattern.compile("ordering\\[(\\d+)]\\[(\\w+)]");
  private static final Pattern IDS = Pattern.compile("ids\\[(\\d+)]");
  /** Like the API: 1 to 255 printable ASCII characters, without a space at either end. */
  private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[\\x21-\\x7e](?:[\\x20-\\x7e]{0,253}[\\x21-\\x7e])?");
  private static final long MIB = 1024 * 1024;
  private static final long MIN_PART_BYTES = 5 * MIB, MIN_MULTIPART_IMAGE_BYTES = 10 * MIB, MAX_IMAGE_BYTES = 20 * MIB;
  private static final int MAX_PAGE_SIZE = 100, MAX_EVENTS_LIMIT = 100, MAX_FOLDER_PAGE_SIZE = 100;
  /**
   * The ThumbHash the mock gives every classified image, standing in for one computed from its
   * pixels. The {@code placeholder} resource serves it as a PNG, like the CDN.
   */
  static final String MOCK_THUMBHASH = "1QcSHQRnh493V4dIh4eXh1h4kJUI";

  final MockCalmLensServerClient.Storage storage = new MockCalmLensServerClient.Storage();
  private final MockCalmLensServerClient.Options options;
  private final String projectId, apiBase, cdnBase;
  private final Map<String, Saved> idempotent = new HashMap<>();
  /** Open multipart uploads by asset ID: their queue choice and declared total size. */
  private final Map<String, JsonObject> uploads = new HashMap<>();
  private final Map<String, JsonObject> lenses = new LinkedHashMap<>();
  /** The key's grants once {@link MockCalmLensServerClient#setApiKeyGrants} replaced them, else null. */
  JsonArray grants;

  MockApi(String projectId, String apiBase, String cdnBase, MockCalmLensServerClient.Options options) {
    this.projectId = projectId;
    this.apiBase = apiBase;
    this.cdnBase = cdnBase;
    this.options = options;
  }

  long now() { return options.now.getAsLong(); }

  String createId() { return options.createId.get(); }

  // ------------------------------------------------------------------ Transport

  /** Whether a request is for the CDN rather than the API. */
  boolean isCdn(String url) { return url.split("\\?", 2)[0].startsWith(cdnBase + "/assets/"); }

  /**
   * The client operations a request can come from, by their JavaScript method paths, for {@code
   * failNextRequest}. A request answers both a method and the helper that calls it, such as {@code
   * assets.retrieve} and {@code assets.waitForDecision}.
   */
  Set<String> operations(MockCalmLensServerClient.Request request) {
    String url = request.url().split("\\?", 2)[0];
    if (isCdn(url)) return Set.of("cdn.serve");
    if (!url.startsWith(apiBase + "/")) return Set.of();
    List<String> parts = segments(url.substring(apiBase.length()));
    String method = request.method();
    if (parts.size() >= 3 && parts.get(0).equals("projects")) {
      String route = method + " " + String.join("/", parts.subList(2, parts.size()));
      return switch (route) {
        case "GET events" -> Set.of("events.list", "events.pages");
        case "PUT lenses" -> Set.of("ensureLens", "ensureLenses");
        case "GET folders" -> Set.of("folders.list");
        case "POST folders" -> Set.of("folders.create");
        case "GET assets/search" -> Set.of("assets.search");
        case "GET assets/page" -> Set.of("assets.list", "assets.iterate");
        case "POST assets/batch" -> Set.of("assets.batch");
        case "POST assets" -> "false".equals(request.query().get("queue")) ? Set.of("assets.classify", "text.classify") : Set.of("assets.create");
        default -> Set.of();
      };
    }
    if (parts.size() < 2) return Set.of();
    String route = parts.get(0) + " " + method + " " + (parts.size() > 2 ? parts.get(2) : "");
    return switch (route) {
      case "assets GET " -> Set.of("assets.retrieve", "assets.waitForDecision");
      case "assets PATCH " -> Set.of("assets.update");
      case "assets DELETE " -> Set.of("assets.delete");
      case "assets GET children" -> Set.of("assets.listChildren", "assets.iterateChildren");
      case "assets DELETE content" -> Set.of("assets.deleteContent");
      case "assets POST retry" -> Set.of("assets.retry");
      case "assets POST explain" -> Set.of("assets.explain");
      case "assets POST move" -> Set.of("assets.move");
      case "assets POST part" -> Set.of("assets.uploadPart");
      case "assets POST signed-url" -> Set.of("assets.createSignedUrl");
      case "folders GET " -> Set.of("folders.retrieve");
      case "folders PATCH " -> Set.of("folders.update");
      case "folders DELETE " -> Set.of("folders.delete");
      case "folders POST move" -> Set.of("folders.move");
      default -> Set.of();
    };
  }

  Transport.Response answer(MockCalmLensServerClient.Request request) throws IOException {
    String url = request.url().split("\\?", 2)[0];
    if (isCdn(url)) {
      List<String> parts = segments(url.substring(cdnBase.length()));
      if (parts.size() >= 4) return cdn(request, parts);
    }
    if (!url.startsWith(apiBase + "/")) throw unsupported(request.method(), request.url());
    List<String> parts = segments(url.substring(apiBase.length()));
    String key = request.header("Idempotency-Key");
    // HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
    if (key != null) key = key.replaceAll("^[ \\t\\r\\n]+|[ \\t\\r\\n]+$", "");
    if (key != null && !IDEMPOTENCY_KEY.matcher(key).matches()) return error(new Failure(ErrorCodes.INVALID_IDEMPOTENCY_KEY));
    String fingerprint = request.method() + " " + request.url() + " " + digest(request.body());
    if (key != null && idempotent.containsKey(key)) {
      Saved saved = idempotent.get(key);
      if (!saved.fingerprint().equals(fingerprint)) return error(new Failure(ErrorCodes.IDEMPOTENCY_KEY_REUSED));
      return respond(saved.status(), "application/json", saved.body(), "Idempotent-Replayed", "true");
    }
    JsonObject body = new JsonObject();
    String type = request.header("Content-Type");
    if (request.body() != null && type != null && type.startsWith("application/json")) {
      JsonElement parsed = JsonParser.parseString(request.bodyText());
      if (parsed.isJsonObject()) body = parsed.getAsJsonObject();
    }
    String upload = Objects.requireNonNullElse(request.header("X-CalmLens-Upload"), "");
    JsonElement result;
    try {
      result = dispatch(request.method(), parts, query(request.query()), body, request.body(), upload);
    } catch (Failure failure) {
      // A failed request frees its key, as the API does.
      return error(failure);
    }
    // Like the API: deletes answer 200 with an empty object, a new folder is 201 Created and a
    // queued batch 202 Accepted.
    byte[] bytes = Json.write(result == null ? new JsonObject() : result).getBytes(StandardCharsets.UTF_8);
    Set<String> operations = operations(request);
    int status = operations.contains("folders.create") ? 201 : operations.contains("assets.batch") ? 202 : 200;
    if (key != null) idempotent.put(key, new Saved(fingerprint, status, bytes));
    return respond(status, "application/json", bytes);
  }

  private static IOException unsupported(String method, String path) {
    return new IOException("MockCalmLensServerClient does not emulate " + method + " " + path + "; enqueue a response for it");
  }

  private static Transport.Response respond(int status, String contentType, byte[] body, String... extra) {
    Map<String, List<String>> headers = new LinkedHashMap<>();
    headers.put("X-Request-Id", List.of(MockCalmLensServerClient.requestId()));
    if (contentType != null) headers.put("Content-Type", List.of(contentType));
    headers.put("Content-Length", List.of(String.valueOf(body.length)));
    for (int i = 0; i < extra.length; i += 2) headers.put(extra[i], List.of(extra[i + 1]));
    return new Transport.Response(status, headers, body);
  }

  static Transport.Response error(Failure failure) {
    JsonObject body = new JsonObject();
    body.addProperty("code", failure.code);
    body.addProperty("message", failure.getMessage());
    if (failure.details != null && !failure.details.isEmpty()) body.add("details", Json.WRITE.toJsonTree(failure.details));
    body.addProperty("traceId", "trace_mock");
    return respond(failure.status, "application/json", Json.write(body).getBytes(StandardCharsets.UTF_8));
  }

  private static List<String> segments(String path) {
    List<String> parts = new ArrayList<>();
    for (String part : path.split("/")) if (!part.isEmpty()) parts.add(URLDecoder.decode(part.replace("+", "%2B"), StandardCharsets.UTF_8));
    return parts;
  }

  private static String digest(byte[] body) {
    try {
      return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(body == null ? new byte[0] : body));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  /** Decodes query values: numbers, booleans and JSON values, plus {@code ordering[i][key]} and {@code ids[i]}. */
  private static JsonObject query(Map<String, String> raw) {
    JsonObject query = new JsonObject();
    TreeMap<Integer, JsonObject> ordering = new TreeMap<>();
    TreeMap<Integer, String> ids = new TreeMap<>();
    raw.forEach((key, value) -> {
      Matcher order = ORDERING.matcher(key), id = IDS.matcher(key);
      if (order.matches()) ordering.computeIfAbsent(Integer.parseInt(order.group(1)), i -> new JsonObject()).addProperty(order.group(2), value);
      else if (id.matches()) ids.put(Integer.parseInt(id.group(1)), value);
      else if (INT_QUERY.contains(key) && value.matches("-?\\d{1,18}")) query.addProperty(key, Long.parseLong(value));
      else if (BOOL_QUERY.contains(key) && (value.equals("true") || value.equals("false"))) query.addProperty(key, value.equals("true"));
      else if (JSON_QUERY.contains(key)) {
        try { query.add(key, JsonParser.parseString(value)); } catch (RuntimeException notJson) { query.addProperty(key, value); }
      } else query.addProperty(key, value);
    });
    if (!ordering.isEmpty()) {
      JsonArray list = new JsonArray();
      ordering.values().forEach(list::add);
      query.add("ordering", list);
    }
    if (!ids.isEmpty()) {
      JsonArray list = new JsonArray();
      ids.values().forEach(list::add);
      query.add("ids", list);
    }
    return query;
  }

  // ------------------------------------------------------------------ JSON helpers

  static String str(JsonObject object, String key) {
    JsonElement value = object == null ? null : object.get(key);
    return value == null || value.isJsonNull() || !value.isJsonPrimitive() ? null : value.getAsString();
  }

  private static boolean bool(JsonObject object, String key) {
    JsonElement value = object.get(key);
    return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() && value.getAsBoolean();
  }

  private static long number(JsonObject object, String key, long fallback, String name, long min, long max) throws Failure {
    JsonElement value = object.get(key);
    if (value == null || value.isJsonNull()) return fallback;
    if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber() || value.getAsLong() < min || value.getAsLong() > max)
      throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, name + " must be from " + min + " to " + max);
    return value.getAsLong();
  }

  /** A whole-number query value from 1 to {@code max}, refused like the API's query schemas. */
  private static long bounded(JsonObject object, String key, long fallback, long max) throws Failure {
    JsonElement value = object.get(key);
    if (value == null || value.isJsonNull()) return fallback;
    if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw Failure.validation("validation/invalid-type", key);
    if (value.getAsLong() < 1) throw Failure.validation("validation/too-small", key);
    if (value.getAsLong() > max) throw Failure.validation("validation/too-big", key);
    return value.getAsLong();
  }

  private static JsonElement path(JsonObject object, String dotted) {
    JsonElement current = object;
    for (String key : dotted.split("\\."))
      current = current != null && current.isJsonObject() ? current.getAsJsonObject().get(key) : null;
    return current;
  }

  private static JsonElement nullable(String value) { return value == null ? JsonNull.INSTANCE : new JsonPrimitive(value); }

  // ------------------------------------------------------------------ Routes

  private JsonElement dispatch(String method, List<String> parts, JsonObject q, JsonObject body, byte[] raw, String upload)
      throws Failure, IOException {
    long now = now();
    if (parts.size() >= 3 && parts.get(0).equals("projects")) {
      if (!parts.get(1).equals(projectId)) throw new Failure(ErrorCodes.API_KEY_PROJECT_MISMATCH);
      switch (method + " " + String.join("/", parts.subList(2, parts.size()))) {
        case "GET events": return events(q);
        case "PUT lenses": return putLenses(body);
        case "GET folders": return listFolders(q);
        case "POST folders": return createFolder(body, now);
        case "GET assets/search": return search(q);
        case "GET assets/page": {
          String folderId = str(q, "folderId");
          String filter = str(q, "filter");
          List<JsonObject> items = projectAssets().stream().filter(asset -> folderId == null || folderId.equals(str(asset, "folderId"))).collect(Collectors.toList());
          if (filter != null && !filter.isBlank()) items = items.stream().filter(rsql(filter)).collect(Collectors.toList());
          JsonArray scope = new JsonArray();
          scope.add(projectId);
          scope.add(nullable(filter));
          scope.add(nullable(folderId));
          return page(items, q, Json.write(scope));
        }
        case "POST assets": return createAsset(upload, q, body, raw, now);
        case "POST assets/batch": return batch(body, now);
        default: break;
      }
    } else if (parts.size() == 2 || parts.size() == 3) {
      String suffix = parts.size() == 3 ? parts.get(2) : "";
      if (parts.get(0).equals("assets")) return assetRoute(method, parts.get(1), suffix, q, body, raw, now);
      if (parts.get(0).equals("folders")) return folderRoute(method, parts.get(1), suffix, body, now);
    }
    throw unsupported(method, "/" + String.join("/", parts));
  }

  JsonObject asset(String id) throws Failure {
    JsonObject asset = storage.assets.get(id);
    if (asset == null || !projectId.equals(str(asset, "projectId"))) throw new Failure(ErrorCodes.ASSET_NOT_FOUND, "Asset not found");
    return asset;
  }

  private JsonObject folder(String id) throws Failure {
    JsonObject folder = storage.folders.get(id);
    if (folder == null || !projectId.equals(str(folder, "projectId"))) throw new Failure(ErrorCodes.FOLDER_NOT_FOUND, "Folder not found");
    return folder;
  }

  private List<JsonObject> projectAssets() {
    return storage.assets.values().stream().filter(a -> projectId.equals(str(a, "projectId"))).collect(Collectors.toList());
  }

  private List<JsonObject> projectFolders() {
    return storage.folders.values().stream().filter(f -> projectId.equals(str(f, "projectId"))).collect(Collectors.toList());
  }

  private static String assetType(String mime) {
    return mime.startsWith("image/") || List.of("jpg", "jpeg", "png", "gif", "webp", "avif").contains(mime) ? "image"
        : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio"
        : mime.startsWith("text/") || mime.equals("txt") ? "plaintext-document"
        : mime.contains("pdf") || mime.contains("document") || List.of("doc", "docx").contains(mime) ? "multimedia-document" : "file";
  }

  /** Like the API: image uploads in parts total 10 MiB (checked at the last part) to 20 MiB. */
  private static String imageSizeError(String type, long size, boolean last) {
    if (!type.equals("image")) return null;
    if (size > MAX_IMAGE_BYTES) return ErrorCodes.MULTIPART_IMAGE_TOO_LARGE;
    return last && size < MIN_MULTIPART_IMAGE_BYTES ? ErrorCodes.MULTIPART_IMAGE_TOO_SMALL : null;
  }

  /** Like the API: the parts may not overshoot a declared total, and must reach it at the end. */
  private static String totalSizeError(Long total, long received, boolean last) {
    return total != null && (received > total || last && received != total) ? ErrorCodes.UPLOAD_SIZE_MISMATCH : null;
  }

  private static void check(String code) throws Failure { if (code != null) throw new Failure(code); }

  private JsonObject createAsset(String upload, JsonObject q, JsonObject body, byte[] raw, long now) throws Failure {
    // X-CalmLens-Upload picks the mode: absent is a JSON body (a URL), "content" raw content and
    // "part" the raw first part of a multipart upload.
    boolean rawUpload = upload.equals("content") || upload.equals("part"), multipart = upload.equals("part");
    JsonObject o = rawUpload ? q : body;
    String mime = Objects.requireNonNullElse(str(o, "contentType"), "");
    String url = rawUpload ? null : str(o, "url");
    String kind = url != null ? "website" : assetType(mime.toLowerCase(Locale.ROOT));
    boolean queue = bool(q, "queue"), last = !multipart || bool(q, "isFinal");
    long size = raw == null ? 0 : raw.length;
    if (multipart) {
      // In the API's order: a declared total first, then a single final part as the whole upload,
      // then the part itself (5 MiB unless it is the last).
      Long total = q.has("totalSizeInBytes") ? q.get("totalSizeInBytes").getAsLong() : null;
      if (total != null) check(imageSizeError(kind, total, true));
      if (last) {
        check(totalSizeError(total, size, true));
        check(imageSizeError(kind, size, true));
      }
      if (!last && size < MIN_PART_BYTES) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Multipart upload parts must be at least 5MiB except the final part.");
      if (!last) check(totalSizeError(total, size, false));
    }
    if (str(o, "folderId") != null) folder(str(o, "folderId"));
    String externalId = str(o, "externalId");
    if (externalId != null && projectAssets().stream().anyMatch(a -> externalId.equals(str(a, "externalId"))))
      throw new Failure(ErrorCodes.DUPLICATE_EXTERNAL_ID);
    JsonElement processing = o.get("processingOptions");
    if (processing == null || !processing.isJsonObject()) {
      processing = new JsonObject();
      processing.getAsJsonObject().addProperty("keepContentAfterProcessing", false);
    }
    boolean keep = bool(processing.getAsJsonObject(), "keepContentAfterProcessing");

    // Fields the API returns as null when they are not set.
    JsonObject asset = new JsonObject();
    String id = createId();
    asset.addProperty("id", id);
    asset.addProperty("projectId", projectId);
    asset.add("userId", JsonNull.INSTANCE);
    asset.add("parentId", JsonNull.INSTANCE);
    asset.add("folderId", nullable(str(o, "folderId")));
    asset.add("uploadPresetId", nullable(str(o, "uploadPresetId")));
    asset.addProperty("createdAt", now);
    asset.addProperty("updatedAt", now);
    asset.add("name", nullable(str(o, "name")));
    asset.add("description", nullable(str(o, "description")));
    asset.add("externalId", nullable(externalId));
    asset.add("externalUrl", nullable(url != null ? url : str(o, "externalUrl")));
    asset.addProperty("type", kind);
    asset.add("metadata", o.has("metadata") ? o.get("metadata").deepCopy() : JsonNull.INSTANCE);
    asset.add("tags", JsonNull.INSTANCE);
    asset.add("processingOptions", processing.deepCopy());
    asset.addProperty("visibility", Objects.requireNonNullElse(str(o, "visibility"), "private"));
    JsonObject content = new JsonObject();
    content.addProperty("status", keep ? "stored" : "temporary");
    content.add("removalReason", JsonNull.INSTANCE);
    content.addProperty("updatedAt", now);
    content.add("safetyHold", JsonNull.INSTANCE);
    content.add("format", rawUpload ? new JsonPrimitive(mime) : JsonNull.INSTANCE);
    content.add("extension", JsonNull.INSTANCE);
    content.add("sizeInBytes", rawUpload ? new JsonPrimitive(size) : JsonNull.INSTANCE);
    content.add("checksums", JsonNull.INSTANCE);
    content.add("image", JsonNull.INSTANCE);
    content.add("extractedText", JsonNull.INSTANCE);
    asset.add("content", content);
    JsonObject uploadState = new JsonObject();
    uploadState.addProperty("status", last ? "completed" : "uploading");
    uploadState.addProperty("updatedAt", now);
    // Like the API, only an open upload counts the parts received.
    uploadState.add("partsReceived", last ? JsonNull.INSTANCE : new JsonPrimitive(1));
    asset.add("upload", uploadState);
    JsonObject moderation = new JsonObject();
    moderation.addProperty("status", "pending");
    moderation.add("manualReviews", new JsonArray());
    JsonObject classification = new JsonObject();
    classification.addProperty("status", last ? "processing" : "pending");
    classification.addProperty("updatedAt", now);
    classification.add("completedAt", JsonNull.INSTANCE);
    classification.add("moderation", moderation);
    asset.add("classification", classification);

    storage.assets.put(id, asset);
    if (rawUpload && raw != null) {
      TreeMap<Integer, byte[]> parts = new TreeMap<>();
      parts.put(1, raw.clone());
      storage.content.put(id, new MockCalmLensServerClient.StoredContent(mime, parts));
    }
    if (!last) {
      JsonObject open = new JsonObject();
      open.addProperty("queue", queue);
      if (q.has("totalSizeInBytes")) open.add("total", q.get("totalSizeInBytes"));
      uploads.put(id, open);
    } else {
      applyOutcome(asset, options.outcome(asset, queue), "policy", now());
    }
    return asset;
  }

  /**
   * Moves an asset to an outcome like the pipeline: a decision finishes processing, {@code purged}
   * removes the content (with {@code purgeReason}, {@code policy} for the pipeline), and finished
   * processing removes content held only temporarily. A classified image gets a ThumbHash for its
   * placeholder, which goes with removed content.
   */
  void applyOutcome(JsonObject asset, MockCalmLensServerClient.Outcome outcome, String purgeReason, long now) {
    boolean decided = outcome != MockCalmLensServerClient.Outcome.PENDING && outcome != MockCalmLensServerClient.Outcome.FAILED;
    JsonObject content = asset.getAsJsonObject("content");
    String contentStatus = str(content, "status");
    boolean purge = outcome == MockCalmLensServerClient.Outcome.PURGED && !"removed".equals(contentStatus);
    boolean remove = purge || decided && "temporary".equals(contentStatus);
    JsonElement image = content.get("image");
    if (decided && "image".equals(str(asset, "type")) && !"removed".equals(contentStatus) && !purge) {
      JsonObject classified = new JsonObject();
      classified.add("width", JsonNull.INSTANCE);
      classified.add("height", JsonNull.INSTANCE);
      classified.add("perceptualHash", JsonNull.INSTANCE);
      if (image != null && image.isJsonObject()) image.getAsJsonObject().entrySet().forEach(e -> classified.add(e.getKey(), e.getValue()));
      classified.addProperty("thumbhash", MOCK_THUMBHASH);
      if (str(classified, "averageColor") == null) classified.addProperty("averageColor", "#7f7f7f");
      image = classified;
    } else if (outcome == MockCalmLensServerClient.Outcome.PURGED) {
      image = withoutPlaceholder(image);
    }
    if (remove) {
      storage.content.remove(str(asset, "id"));
      content.addProperty("status", "removed");
      content.addProperty("removalReason", purge ? purgeReason : "retention");
      content.addProperty("updatedAt", now);
      content.add("extractedText", JsonNull.INSTANCE);
      image = withoutPlaceholder(image);
    }
    content.add("image", image == null ? JsonNull.INSTANCE : image);
    JsonObject classification = asset.getAsJsonObject("classification");
    classification.addProperty("status", decided ? "completed" : outcome == MockCalmLensServerClient.Outcome.FAILED ? "failed" : "processing");
    classification.addProperty("updatedAt", now);
    classification.add("completedAt", decided ? new JsonPrimitive(now) : JsonNull.INSTANCE);
    classification.getAsJsonObject("moderation").addProperty("status", decided ? outcome.value() : "pending");
    asset.getAsJsonObject("upload").addProperty("status", "completed");
    asset.getAsJsonObject("upload").addProperty("updatedAt", now);
    asset.addProperty("updatedAt", now);
  }

  /** Removing content removes the placeholder and average colour with it. */
  private static JsonElement withoutPlaceholder(JsonElement image) {
    if (image == null || !image.isJsonObject()) return image;
    JsonObject copy = image.getAsJsonObject().deepCopy();
    copy.add("thumbhash", JsonNull.INSTANCE);
    copy.add("averageColor", JsonNull.INSTANCE);
    return copy;
  }

  private void uploadPart(JsonObject asset, JsonObject q, byte[] raw, long now) throws Failure {
    // In the API's order: the upload must be open, parts arrive in order, image totals and the
    // declared total are checked, then the part itself (5 MiB unless it is the last).
    String id = str(asset, "id");
    JsonObject open = uploads.get(id);
    MockCalmLensServerClient.StoredContent stored = storage.content.get(id);
    JsonObject upload = asset.getAsJsonObject("upload");
    if (open == null || stored == null || !"uploading".equals(str(upload, "status"))) throw new Failure(ErrorCodes.UPLOAD_NOT_OPEN);
    long expected = (upload.get("partsReceived").isJsonNull() ? 0 : upload.get("partsReceived").getAsLong()) + 1;
    long number = q.has("partNumber") && q.get("partNumber").getAsJsonPrimitive().isNumber() ? q.get("partNumber").getAsLong() : -1;
    if (number != expected) {
      Map<String, Object> details = new LinkedHashMap<>();
      details.put("expectedPartNumber", expected);
      details.put("receivedPartNumber", number);
      throw new Failure(ErrorCodes.INVALID_UPLOAD_PART_NUMBER, ErrorCodes.httpStatus(ErrorCodes.INVALID_UPLOAD_PART_NUMBER).orElse(409), "Expected part " + expected, details);
    }
    byte[] part = raw == null ? new byte[0] : raw;
    boolean last = bool(q, "isFinal");
    long received = asset.getAsJsonObject("content").get("sizeInBytes").getAsLong() + part.length;
    Long total = open.has("total") ? open.get("total").getAsLong() : null;
    String sizeError = imageSizeError(str(asset, "type"), received, last);
    check(sizeError != null ? sizeError : totalSizeError(total, received, last));
    if (!last && part.length < MIN_PART_BYTES) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Multipart upload parts must be at least 5MiB except the final part.");
    stored.parts().put((int) number, part.clone());
    asset.getAsJsonObject("content").addProperty("sizeInBytes", received);
    upload.add("partsReceived", last ? JsonNull.INSTANCE : new JsonPrimitive(number));
    upload.addProperty("updatedAt", now);
    asset.addProperty("updatedAt", now);
    if (last) {
      boolean queue = q.has("queue") ? bool(q, "queue") : bool(open, "queue");
      uploads.remove(id);
      applyOutcome(asset, options.outcome(asset, queue), "policy", now());
    }
  }

  /** The events {@code asset.deleted}, {@code asset.content-removed} and {@code asset.retried} the API records. */
  private void lifecycle(String type, JsonObject asset) {
    List<Models.EventFact> facts = List.of(
        // A deleted asset has no portal page to link to.
        new Models.EventFact("asset-name", str(asset, "name"), type.equals("asset.deleted") ? null : "/portal/assets/" + str(asset, "id")),
        new Models.EventFact("asset-type", str(asset, "type"), null));
    recordEvent(type, "low", asset, facts);
  }

  /** Facts as the API stores them: {@code key}, {@code value} (null included) and {@code url} when there is one. */
  static JsonArray facts(List<Models.EventFact> facts) {
    JsonArray list = new JsonArray();
    for (Models.EventFact fact : facts) {
      JsonObject item = new JsonObject();
      item.addProperty("key", fact.key());
      item.add("value", fact.value() == null ? JsonNull.INSTANCE : Json.GSON.toJsonTree(fact.value()));
      if (fact.url() != null) item.addProperty("url", fact.url());
      list.add(item);
    }
    return list;
  }

  /** Adds an event to the feed, with a snapshot of {@code asset} when there is one. */
  JsonObject recordEvent(String type, String severity, JsonObject asset, List<Models.EventFact> facts) {
    long now = now();
    JsonObject event = new JsonObject();
    event.addProperty("id", createId());
    event.addProperty("projectId", projectId);
    event.add("userId", JsonNull.INSTANCE);
    event.addProperty("type", type);
    event.addProperty("severity", severity);
    event.addProperty("title", type);
    event.add("description", JsonNull.INSTANCE);
    event.add("assetId", asset == null ? JsonNull.INSTANCE : asset.get("id"));
    event.add("asset", asset == null ? JsonNull.INSTANCE : snapshot(asset));
    event.add("facts", facts(facts));
    event.addProperty("notify", false);
    event.addProperty("createdAt", now);
    event.addProperty("updatedAt", now);
    event.add("readAt", JsonNull.INSTANCE);
    storage.events.add(event);
    return event;
  }

  /** The UUID form the API's schema accepts (zod's {@code uuid()}). */
  private static final java.util.regex.Pattern UUID_PATTERN = java.util.regex.Pattern.compile(
      "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$");

  /**
   * POST /projects/:id/assets/batch: validated like the API's schema, then every asset must exist
   * before anything changes. The operation is applied at once, in request order, instead of in the
   * background. Mock assets carry no safety holds, so none is skipped.
   */
  private JsonElement batch(JsonObject body, long now) throws Failure {
    JsonElement idsElement = body == null ? null : body.get("assetIds");
    if (idsElement == null || !idsElement.isJsonArray()) throw Failure.validation("validation/invalid-type", "assetIds");
    JsonArray ids = idsElement.getAsJsonArray();
    if (ids.size() < 1) throw Failure.validation("validation/too-small", "assetIds");
    if (ids.size() > CalmLensServerClient.ASSET_BATCH_MAX_ASSETS) throw Failure.validation("validation/too-big", "assetIds");
    java.util.LinkedHashSet<String> unique = new java.util.LinkedHashSet<>();
    for (int index = 0; index < ids.size(); index++) {
      JsonElement id = ids.get(index);
      if (!id.isJsonPrimitive() || !id.getAsJsonPrimitive().isString()) throw Failure.validation("validation/invalid-type", "assetIds." + index);
      if (!UUID_PATTERN.matcher(id.getAsString()).matches()) throw Failure.validation("validation/invalid-format", "assetIds." + index);
      unique.add(id.getAsString());
    }
    String operation = str(body, "operation");
    if (!"delete".equals(operation) && !"remove-content".equals(operation)) throw Failure.validation("validation/invalid-value", "operation");
    List<JsonObject> assets = new ArrayList<>();
    for (String id : unique) assets.add(asset(id));
    for (JsonObject asset : assets) {
      if (operation.equals("delete")) {
        deleteAssetTree(str(asset, "id"));
        lifecycle("asset.deleted", asset);
      } else {
        removeContent(asset, now);
      }
    }
    JsonObject queued = new JsonObject();
    queued.addProperty("queued", true);
    return queued;
  }

  /** Deletes an asset, its stored child assets and their content. */
  private void deleteAssetTree(String id) {
    Set<String> deleting = new java.util.LinkedHashSet<>(List.of(id));
    for (boolean added = true; added; ) {
      added = false;
      for (JsonObject other : projectAssets()) {
        String parentId = str(other, "parentId");
        if (parentId != null && deleting.contains(parentId) && deleting.add(str(other, "id"))) added = true;
      }
    }
    for (String each : deleting) {
      storage.assets.remove(each);
      storage.content.remove(each);
      uploads.remove(each);
    }
  }

  /**
   * Removes an asset's content like the API: the record and report stay; stored content, extracted
   * text and the placeholder go. Content already removed keeps its reason, and an
   * asset.content-removed event is recorded either way.
   */
  private JsonObject removeContent(JsonObject asset, long now) {
    storage.content.remove(str(asset, "id"));
    JsonObject content = asset.getAsJsonObject("content");
    if (!"removed".equals(str(content, "status"))) {
      content.addProperty("status", "removed");
      content.addProperty("removalReason", "requested");
      content.addProperty("updatedAt", now);
      content.add("extractedText", JsonNull.INSTANCE);
      content.add("image", Objects.requireNonNullElse(withoutPlaceholder(content.get("image")), JsonNull.INSTANCE));
      asset.addProperty("updatedAt", now);
    } else if (content.get("image") instanceof JsonObject image && str(image, "thumbhash") != null) {
      content.add("image", withoutPlaceholder(image));
    }
    lifecycle("asset.content-removed", asset);
    return asset;
  }

  private JsonElement assetRoute(String method, String id, String suffix, JsonObject q, JsonObject body, byte[] raw, long now)
      throws Failure, IOException {
    JsonObject asset = asset(id);
    switch (method + " " + suffix) {
      case "GET ": return asset;
      case "GET children": return page(projectAssets().stream().filter(child -> id.equals(str(child, "parentId"))).collect(Collectors.toList()), q, Json.write(new JsonPrimitive(id)));
      case "DELETE ":
        storage.assets.remove(id);
        storage.content.remove(id);
        uploads.remove(id);
        lifecycle("asset.deleted", asset);
        return null;
      case "DELETE content": return removeContent(asset, now);
      case "POST retry":
        if (!"failed".equals(str(asset.getAsJsonObject("classification"), "status"))
            || !"pending".equals(str(asset.getAsJsonObject("classification").getAsJsonObject("moderation"), "status")))
          throw new Failure(ErrorCodes.ASSET_NOT_RETRYABLE);
        if ("removed".equals(str(asset.getAsJsonObject("content"), "status"))) throw new Failure(ErrorCodes.ASSET_CONTENT_UNAVAILABLE);
        // Like the API: back to processing, to be moderated again, with an asset.retried event.
        applyOutcome(asset, MockCalmLensServerClient.Outcome.PENDING, "policy", now);
        lifecycle("asset.retried", asset);
        return asset;
      case "POST explain": {
        if (!"completed".equals(str(asset.getAsJsonObject("classification"), "status"))) throw new Failure(ErrorCodes.ASSET_NOT_DECIDED);
        JsonObject moderation = asset.getAsJsonObject("classification").getAsJsonObject("moderation");
        if (body == null || !bool(body, "rerun")) {
          // Like the API: the evidence is completed and every action stays as decided.
          if (moderation.get("policy") instanceof JsonObject policy && "decision".equals(str(policy, "evidence"))) {
            policy.addProperty("evidence", "full");
            asset.addProperty("updatedAt", now);
          }
          return asset;
        }
        JsonElement reviews = moderation.get("manualReviews");
        if (reviews != null && reviews.isJsonArray() && !reviews.getAsJsonArray().isEmpty()) throw new Failure(ErrorCodes.ASSET_REVIEWED);
        if ("removed".equals(str(asset.getAsJsonObject("content"), "status"))) throw new Failure(ErrorCodes.ASSET_CONTENT_UNAVAILABLE);
        // Like the API: back to processing, to be moderated again under the current policy.
        applyOutcome(asset, MockCalmLensServerClient.Outcome.PENDING, "policy", now);
        return asset;
      }
      case "POST move": {
        String folderId = str(body, "folderId");
        if (folderId != null) folder(folderId);
        asset.add("folderId", nullable(folderId));
        asset.addProperty("updatedAt", now);
        return asset;
      }
      case "POST part": uploadPart(asset, q, raw, now); return asset;
      case "POST signed-url": {
        long expires = number(body, "expiresInSeconds", 900, "expiresInSeconds", 1, Integer.MAX_VALUE);
        List<String> params = new ArrayList<>();
        params.add("expiresInSeconds=" + expires);
        for (String key : List.of("lens", "transform")) {
          String value = str(body, key);
          if (value != null) params.add(key + "=" + URLEncoder.encode(value, StandardCharsets.UTF_8));
        }
        JsonObject signed = new JsonObject();
        signed.addProperty("url", options.signedUrlBaseUrl + "/assets/" + CalmLensServerClient.encodeComponent(id) + "/"
            + Objects.requireNonNullElse(str(body, "resource"), "rendered") + "?" + String.join("&", params));
        signed.addProperty("expiresAt", now + expires * 1000);
        return signed;
      }
      case "PATCH ":
        // Like the API: only the given fields change, null clears one, and an externalId stays unique.
        for (var entry : body.entrySet()) {
          String key = entry.getKey();
          if (Set.of("id", "projectId", "upload", "classification", "content", "createdAt", "updatedAt").contains(key)) continue;
          String value = entry.getValue().isJsonPrimitive() ? entry.getValue().getAsString() : null;
          if (key.equals("folderId") && value != null) folder(value);
          if (key.equals("externalId") && value != null
              && projectAssets().stream().anyMatch(other -> other != asset && value.equals(str(other, "externalId"))))
            throw new Failure(ErrorCodes.DUPLICATE_EXTERNAL_ID);
        }
        for (var entry : body.entrySet())
          if (!Set.of("id", "projectId", "upload", "classification", "content", "createdAt", "updatedAt").contains(entry.getKey()))
            asset.add(entry.getKey(), entry.getValue().deepCopy());
        asset.addProperty("updatedAt", now);
        return asset;
      default: throw unsupported(method, "/assets/" + id + "/" + suffix);
    }
  }

  // ------------------------------------------------------------------ Lists and search

  /**
   * A subset of RSQL: {@code ==} and {@code !=} (with {@code *} wildcards), {@code =in=}, {@code =out=},
   * {@code =gt=}, {@code =ge=}, {@code =lt=} and {@code =le=}, joined by {@code ;} (and), which binds
   * tighter than {@code ,} (or), and grouped with {@code ( … )}.
   */
  static Predicate<JsonObject> rsql(String expression) throws IOException {
    List<List<Predicate<JsonObject>>> alternatives = new ArrayList<>();
    for (String alternative : split(expression, ',')) {
      List<Predicate<JsonObject>> tests = new ArrayList<>();
      for (String term : split(alternative, ';')) {
        String text = term.strip();
        if (text.isEmpty()) throw new IOException("MockCalmLensServerClient cannot evaluate the filter " + expression);
        String group = unwrap(text);
        tests.add(group != null ? rsql(group) : comparison(text));
      }
      alternatives.add(tests);
    }
    return asset -> alternatives.stream().anyMatch(group -> group.stream().allMatch(test -> test.test(asset)));
  }

  /** Splits on {@code separator} outside quotes and parentheses (groups and {@code =in=(...)} lists). */
  private static List<String> split(String text, char separator) {
    List<String> parts = new ArrayList<>();
    StringBuilder current = new StringBuilder();
    int depth = 0;
    char quote = 0;
    for (char c : text.toCharArray()) {
      if (quote != 0) { if (c == quote) quote = 0; }
      else if (c == '"' || c == '\'') quote = c;
      else if (c == '(') depth++;
      else if (c == ')') depth--;
      else if (depth == 0 && c == separator) { parts.add(current.toString()); current.setLength(0); continue; }
      current.append(c);
    }
    parts.add(current.toString());
    return parts;
  }

  /** The expression inside {@code ( … )} when the parentheses enclose all of {@code text}, else null. */
  private static String unwrap(String text) {
    if (!text.startsWith("(") || !text.endsWith(")")) return null;
    int depth = 0;
    char quote = 0;
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (quote != 0) { if (c == quote) quote = 0; }
      else if (c == '"' || c == '\'') quote = c;
      else if (c == '(') depth++;
      else if (c == ')' && --depth == 0) return i == text.length() - 1 ? text.substring(1, i) : null;
    }
    return null;
  }

  private static final Pattern COMPARISON = Pattern.compile("\\s*([\\w.]+)\\s*(==|!=|=in=|=out=|=gt=|=ge=|=lt=|=le=)(.*)", Pattern.DOTALL);
  private static final Pattern VALUE = Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|[^,()]+");

  private static String unquote(String value) {
    String text = value.strip();
    return text.length() >= 2 && (text.charAt(0) == '"' || text.charAt(0) == '\'') ? text.substring(1, text.length() - 1).replace("\\\"", "\"").replace("\\'", "'") : text;
  }

  private static Predicate<JsonObject> comparison(String text) throws IOException {
    Matcher found = COMPARISON.matcher(text);
    if (!found.matches()) throw new IOException("MockCalmLensServerClient cannot evaluate the filter " + text);
    String name = found.group(1), operator = found.group(2), raw = found.group(3).strip();
    List<String> values = new ArrayList<>();
    if (raw.startsWith("(") && raw.endsWith(")")) {
      Matcher value = VALUE.matcher(raw.substring(1, raw.length() - 1));
      while (value.find()) values.add(unquote(value.group()));
    } else values.add(unquote(raw));
    Pattern glob = Pattern.compile(java.util.Arrays.stream(values.get(0).split("\\*", -1)).map(Pattern::quote).collect(Collectors.joining(".*")), Pattern.DOTALL);
    return asset -> {
      JsonElement actual = path(asset, name);
      List<String> texts = new ArrayList<>();
      if (actual != null && actual.isJsonArray()) actual.getAsJsonArray().forEach(item -> texts.add(item.isJsonPrimitive() ? item.getAsString() : ""));
      else texts.add(actual == null || !actual.isJsonPrimitive() ? "" : actual.getAsString());
      switch (operator) {
        case "==": return texts.stream().anyMatch(t -> glob.matcher(t).matches());
        case "!=": return texts.stream().noneMatch(t -> glob.matcher(t).matches());
        case "=in=": return texts.stream().anyMatch(values::contains);
        case "=out=": return texts.stream().noneMatch(values::contains);
        default:
          double left, right;
          try { left = Double.parseDouble(texts.get(0)); right = Double.parseDouble(values.get(0)); } catch (NumberFormatException notNumber) { return false; }
          return switch (operator) { case "=gt=" -> left > right; case "=ge=" -> left >= right; case "=lt=" -> left < right; default -> left <= right; };
      }
    };
  }

  private static int compare(JsonElement a, JsonElement b) {
    boolean aNull = a == null || a.isJsonNull(), bNull = b == null || b.isJsonNull();
    if (aNull || bNull) return aNull && bNull ? 0 : aNull ? -1 : 1;
    if (a.isJsonPrimitive() && b.isJsonPrimitive() && a.getAsJsonPrimitive().isNumber() && b.getAsJsonPrimitive().isNumber())
      return Double.compare(a.getAsDouble(), b.getAsDouble());
    return a.getAsString().compareTo(b.getAsString());
  }

  /**
   * One keyset page like the API's: ordered by {@code createdAt} and {@code id} (an {@code id}
   * tie-breaker is added), starting after the cursor's values. A cursor is tied to {@code scope}
   * (the filter, folder or parent) and the ordering, so it only continues the query it came from.
   */
  private JsonObject page(List<JsonObject> items, JsonObject q, String scope) throws Failure {
    long size = bounded(q, "pageSize", 10, MAX_PAGE_SIZE);
    JsonArray ordering = new JsonArray();
    if (q.has("ordering")) q.getAsJsonArray("ordering").forEach(order -> ordering.add(order.deepCopy()));
    else {
      JsonObject newest = new JsonObject();
      newest.addProperty("field", "createdAt");
      newest.addProperty("direction", "DESC");
      ordering.add(newest);
    }
    boolean byId = false;
    for (JsonElement element : ordering) {
      JsonObject order = element.getAsJsonObject();
      String field = str(order, "field");
      if (!"createdAt".equals(field) && !"id".equals(field)) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Invalid ordering");
      order.addProperty("direction", Objects.requireNonNullElse(str(order, "direction"), "ASC").toUpperCase(Locale.ROOT));
      byId |= field.equals("id");
    }
    if (!byId) {
      JsonObject tieBreak = new JsonObject();
      tieBreak.addProperty("field", "id");
      tieBreak.addProperty("direction", str(ordering.get(0).getAsJsonObject(), "direction"));
      ordering.add(tieBreak);
    }
    Comparator<JsonObject> comparator = (a, b) -> 0;
    for (JsonElement element : ordering) {
      String field = str(element.getAsJsonObject(), "field");
      Comparator<JsonObject> next = (a, b) -> compare(a.get(field), b.get(field));
      comparator = comparator.thenComparing("DESC".equals(str(element.getAsJsonObject(), "direction")) ? next.reversed() : next);
    }
    List<JsonObject> remaining = new ArrayList<>(items);
    remaining.sort(comparator);
    JsonArray signature = new JsonArray();
    signature.add(scope);
    signature.add(ordering);
    String cursor = str(q, "cursor");
    if (cursor != null && !cursor.isEmpty()) {
      JsonArray values;
      try {
        JsonObject parsed = JsonParser.parseString(new String(Base64.getDecoder().decode(cursor), StandardCharsets.UTF_8)).getAsJsonObject();
        values = parsed.getAsJsonArray("values");
        if (!Json.write(signature).equals(str(parsed, "scope")) || values == null || values.size() != ordering.size())
          throw new IllegalArgumentException("Invalid cursor");
        for (int i = 0; i < values.size(); i++) {
          boolean id = "id".equals(str(ordering.get(i).getAsJsonObject(), "field"));
          JsonElement value = values.get(i);
          if (!(value instanceof JsonPrimitive primitive) || (id ? !primitive.isString() : !primitive.isNumber())) throw new IllegalArgumentException("Invalid cursor");
        }
      } catch (RuntimeException invalid) {
        throw new Failure(ErrorCodes.INVALID_CURSOR, "The cursor is invalid or belongs to a different query.");
      }
      JsonArray boundary = values;
      remaining = remaining.stream().filter(item -> {
        for (int i = 0; i < ordering.size(); i++) {
          JsonObject rule = ordering.get(i).getAsJsonObject();
          int result = compare(item.get(str(rule, "field")), boundary.get(i));
          if (result != 0) return "DESC".equals(str(rule, "direction")) ? result < 0 : result > 0;
        }
        return false;
      }).collect(Collectors.toList());
    }
    List<JsonObject> selected = remaining.subList(0, (int) Math.min(size, remaining.size()));
    boolean more = remaining.size() > size;
    JsonObject page = new JsonObject();
    JsonArray list = new JsonArray();
    selected.forEach(list::add);
    page.add("items", list);
    page.addProperty("pageSize", size);
    page.addProperty("hasMore", more);
    page.add("ordering", ordering);
    if (more) {
      JsonObject last = selected.get(selected.size() - 1);
      JsonArray values = new JsonArray();
      for (JsonElement order : ordering) values.add(last.get(str(order.getAsJsonObject(), "field")));
      JsonObject next = new JsonObject();
      next.addProperty("scope", Json.write(signature));
      next.add("values", values);
      page.addProperty("nextCursor", Base64.getEncoder().encodeToString(Json.write(next).getBytes(StandardCharsets.UTF_8)));
    } else page.add("nextCursor", JsonNull.INSTANCE);
    return page;
  }

  /** Keyword search fields, in the order matches are reported. */
  private static final List<String> SEARCH_FIELDS = List.of("name", "id", "externalId", "description", "tags", "type",
      "content.format", "content.extension", "classification.moderation.status");
  private static final int MAX_SEARCH_TOKENS = 8, MAX_SEARCH_LIMIT = 20, MAX_SEARCH_QUERY_LENGTH = 200;

  /**
   * Keyword search like the API: every whitespace-separated token (case-insensitive, at most 8
   * distinct) must appear in some field. Results rank by the API's score, then newest first.
   */
  private JsonObject search(JsonObject q) throws Failure {
    // Like the API's query schema: a trimmed query of 1 to 200 characters, a limit of 1 to 20.
    String text = Objects.requireNonNullElse(str(q, "query"), "").strip();
    if (text.isEmpty()) throw Failure.validation("validation/too-small", "query");
    if (text.length() > MAX_SEARCH_QUERY_LENGTH) throw Failure.validation("validation/too-big", "query");
    long limit = bounded(q, "limit", 10, MAX_SEARCH_LIMIT);
    String normalized = text.toLowerCase(Locale.ROOT);
    List<String> tokens = java.util.Arrays.stream(normalized.split("\\s+")).distinct().limit(MAX_SEARCH_TOKENS).toList();
    List<JsonObject> items = new ArrayList<>();
    for (JsonObject asset : projectAssets()) {
      Map<String, String> values = new LinkedHashMap<>();
      for (String field : SEARCH_FIELDS) {
        JsonElement value = path(asset, field);
        List<String> texts = new ArrayList<>();
        if (value != null && value.isJsonArray()) value.getAsJsonArray().forEach(item -> { if (item.isJsonPrimitive()) texts.add(item.getAsString()); });
        else if (value != null && value.isJsonPrimitive()) texts.add(value.getAsString());
        values.put(field, String.join(" ", texts).toLowerCase(Locale.ROOT));
      }
      if (!tokens.stream().allMatch(token -> values.values().stream().anyMatch(value -> value.contains(token)))) continue;
      JsonArray matched = new JsonArray();
      values.forEach((field, value) -> { if (tokens.stream().anyMatch(value::contains)) matched.add(field); });
      JsonObject item = new JsonObject();
      item.add("asset", asset);
      item.addProperty("score", searchScore(values, normalized));
      item.add("matchedFields", matched);
      items.add(item);
    }
    items.sort(Comparator.comparingInt((JsonObject item) -> item.get("score").getAsInt())
        .thenComparingLong(item -> item.getAsJsonObject("asset").get("createdAt").getAsLong()).reversed());
    JsonObject result = new JsonObject();
    result.addProperty("query", text);
    JsonArray list = new JsonArray();
    items.stream().limit(limit).forEach(list::add);
    result.add("items", list);
    // The mock has no semantic index, so every search mode is keyword matching.
    result.addProperty("semanticStatus", "disabled");
    return result;
  }

  /** The API's keyword score for the whole normalized query. */
  private static int searchScore(Map<String, String> values, String query) {
    String id = values.get("id"), externalId = values.get("externalId"), name = values.get("name");
    if (id.equals(query)) return 1000;
    if (externalId.equals(query)) return 950;
    if (name.equals(query)) return 900;
    if (id.startsWith(query)) return 800;
    if (externalId.startsWith(query)) return 750;
    if (name.startsWith(query)) return 700;
    if (name.contains(query)) return 600;
    if (values.get("tags").contains(query)) return 500;
    return 100;
  }

  // ------------------------------------------------------------------ Folders, lenses and events

  private void unique(String name, String parentId, String exclude) throws Failure {
    for (JsonObject folder : projectFolders())
      if (!str(folder, "id").equals(exclude) && Objects.equals(str(folder, "name"), name) && Objects.equals(str(folder, "parentId"), parentId))
        throw new Failure(ErrorCodes.DUPLICATE_FOLDER_NAME, "A folder named \"" + name + "\" already exists in this location.");
  }

  private JsonObject listFolders(JsonObject q) throws Failure {
    long size = bounded(q, "pageSize", MAX_FOLDER_PAGE_SIZE, MAX_FOLDER_PAGE_SIZE);
    String parentId = str(q, "parentId"), search = Objects.requireNonNullElse(str(q, "search"), "").toLowerCase(Locale.ROOT);
    boolean everywhere = bool(q, "searchAll") && !search.isEmpty(), resolveOnly = bool(q, "resolveOnly");
    List<JsonObject> all = projectFolders();
    // Like the database: names compare by code point, so case matters, then IDs break ties.
    Comparator<JsonObject> order = "createdAt".equals(str(q, "sort"))
        ? Comparator.<JsonObject, JsonElement>comparing(f -> f.get("createdAt"), MockApi::compare)
        : Comparator.comparing((JsonObject f) -> Objects.requireNonNullElse(str(f, "name"), ""), MockApi::byCodePoint);
    order = order.thenComparing((JsonObject f) -> str(f, "id"), MockApi::byCodePoint);
    List<JsonObject> found = all.stream()
        .filter(f -> (everywhere || Objects.equals(str(f, "parentId"), parentId)) && Objects.requireNonNullElse(str(f, "name"), "").toLowerCase(Locale.ROOT).contains(search))
        .sorted("DESC".equals(str(q, "direction")) ? order.reversed() : order).collect(Collectors.toList());
    long start = number(q, "pageIndex", 0, "pageIndex", 0, Integer.MAX_VALUE) * size;
    List<JsonObject> page = resolveOnly ? List.of() : found.subList((int) Math.min(start, found.size()), (int) Math.min(start + size, found.size()));
    Set<String> ids = new HashSet<>();
    if (q.has("ids")) q.getAsJsonArray("ids").forEach(id -> ids.add(id.getAsString()));
    page.forEach(f -> ids.add(str(f, "id")));
    if (parentId != null) ids.add(parentId);
    List<String> pending = new ArrayList<>(ids);
    while (!pending.isEmpty()) {
      String parent = str(storage.folders.get(pending.remove(pending.size() - 1)), "parentId");
      if (parent != null && ids.add(parent)) pending.add(parent);
    }
    JsonObject result = new JsonObject();
    JsonArray folders = new JsonArray(), ancestors = new JsonArray();
    page.forEach(folders::add);
    all.stream().filter(f -> ids.contains(str(f, "id")) && !page.contains(f)).forEach(ancestors::add);
    result.add("folders", folders);
    result.add("ancestors", ancestors);
    result.addProperty("hasMore", !resolveOnly && found.size() > start + size);
    return result;
  }

  private static int byCodePoint(String a, String b) {
    int i = 0, j = 0;
    while (i < a.length() && j < b.length()) {
      int x = a.codePointAt(i), y = b.codePointAt(j);
      if (x != y) return Integer.compare(x, y);
      i += Character.charCount(x);
      j += Character.charCount(y);
    }
    return Integer.compare(a.length() - i, b.length() - j);
  }

  private JsonObject createFolder(JsonObject body, long now) throws Failure {
    String parentId = str(body, "parentId"), name = str(body, "name");
    if (name == null || name.isEmpty()) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Folder name is required");
    if (parentId != null) folder(parentId);
    unique(name, parentId, null);
    JsonObject folder = new JsonObject();
    folder.addProperty("id", createId());
    folder.addProperty("projectId", projectId);
    folder.add("parentId", nullable(parentId));
    folder.addProperty("name", name);
    folder.addProperty("createdAt", now);
    folder.addProperty("updatedAt", now);
    storage.folders.put(str(folder, "id"), folder);
    return folder;
  }

  private JsonElement folderRoute(String method, String id, String suffix, JsonObject body, long now) throws Failure, IOException {
    JsonObject folder = folder(id);
    switch (method + " " + suffix) {
      case "GET ": return folder;
      case "DELETE ": {
        boolean hasAssets = projectAssets().stream().anyMatch(a -> id.equals(str(a, "folderId")));
        boolean hasChildren = projectFolders().stream().anyMatch(f -> id.equals(str(f, "parentId")));
        if (hasAssets || hasChildren) throw Failure.of(ErrorCodes.FOLDER_NOT_EMPTY, Map.of("hasAssets", hasAssets, "hasChildren", hasChildren));
        storage.folders.remove(id);
        return null;
      }
      case "POST move": {
        String parentId = str(body, "parentId");
        Set<String> visited = new HashSet<>(Set.of(id));
        for (String current = parentId; current != null; current = str(folder(current), "parentId"))
          if (!visited.add(current)) throw new Failure(ErrorCodes.FOLDER_PARENT_CYCLE);
        if (!Objects.equals(parentId, str(folder, "parentId"))) unique(str(folder, "name"), parentId, id);
        folder.add("parentId", nullable(parentId));
        break;
      }
      case "PATCH ":
        if (str(body, "name") != null && !str(body, "name").equals(str(folder, "name"))) unique(str(body, "name"), str(folder, "parentId"), id);
        if (str(body, "name") != null) folder.addProperty("name", str(body, "name"));
        break;
      default: throw unsupported(method, "/folders/" + id + "/" + suffix);
    }
    folder.addProperty("updatedAt", now);
    return folder;
  }

  /** A JSON value with object keys sorted, so equal definitions compare equal. */
  private static String canonical(JsonElement value) {
    if (value == null || value.isJsonNull()) return "null";
    if (value.isJsonObject()) {
      TreeMap<String, JsonElement> sorted = new TreeMap<>(value.getAsJsonObject().asMap());
      return sorted.entrySet().stream().map(e -> Json.write(new JsonPrimitive(e.getKey())) + ":" + canonical(e.getValue())).collect(Collectors.joining(",", "{", "}"));
    }
    if (value.isJsonArray()) {
      List<String> items = new ArrayList<>();
      value.getAsJsonArray().forEach(item -> items.add(canonical(item)));
      return "[" + String.join(",", items) + "]";
    }
    return Json.write(value);
  }

  /**
   * Saves each definition in order, like the API: an unchanged definition at its version returns
   * the stored lens, a greater version updates it, anything else conflicts. Lenses saved before a
   * conflict stay saved.
   */
  private JsonObject putLenses(JsonObject body) throws Failure {
    JsonArray result = new JsonArray();
    for (JsonElement element : body.getAsJsonArray("lenses")) {
      JsonObject definition = element.getAsJsonObject();
      String identifier = str(definition, "identifier");
      long version = definition.has("version") && !definition.get("version").isJsonNull() ? definition.get("version").getAsLong() : 1;
      JsonObject existing = lenses.get(identifier);
      if (existing == null) {
        JsonObject lens = new JsonObject();
        lens.addProperty("id", createId());
        lens.addProperty("projectId", projectId);
        lens.add("userId", JsonNull.INSTANCE);
        definition.entrySet().forEach(e -> lens.add(e.getKey(), e.getValue().deepCopy()));
        lens.addProperty("createdAt", now());
        lens.addProperty("updatedAt", now());
        lenses.put(identifier, lens);
        result.add(lens);
        continue;
      }
      long current = existing.get("version").getAsLong();
      boolean same = List.of("name", "description", "type", "active", "transforms").stream()
          .allMatch(key -> canonical(existing.get(key)).equals(canonical(definition.get(key))));
      if (same && version == current) { result.add(existing); continue; }
      if (version > current) {
        JsonObject lens = existing.deepCopy();
        definition.entrySet().forEach(e -> lens.add(e.getKey(), e.getValue().deepCopy()));
        lens.addProperty("updatedAt", now());
        lenses.put(identifier, lens);
        result.add(lens);
        continue;
      }
      Map<String, Object> details = new LinkedHashMap<>();
      details.put("currentVersion", current);
      details.put("minimumVersion", current + 1);
      details.put("requestedVersion", version);
      throw Failure.of(ErrorCodes.LENS_VERSION_CONFLICT, details);
    }
    JsonObject answer = new JsonObject();
    answer.add("lenses", result);
    return answer;
  }

  /** Cursors are {@code mock_<n>}: the number of events in the feed when the cursor was taken. */
  private JsonObject events(JsonObject q) throws Failure {
    long limit = bounded(q, "limit", 50, MAX_EVENTS_LIMIT);
    List<JsonObject> feed = storage.events.stream().filter(e -> projectId.equals(str(e, "projectId"))).collect(Collectors.toList());
    int position = feed.size();
    String after = str(q, "after");
    if (after != null && !after.isEmpty()) {
      Matcher cursor = Pattern.compile("mock_(\\d{1,9})").matcher(after);
      if (!cursor.matches() || Integer.parseInt(cursor.group(1)) > feed.size())
        throw Failure.of(ErrorCodes.INVALID_EVENT_CURSOR, Map.of("after", after));
      position = Integer.parseInt(cursor.group(1));
    }
    int end = after == null || after.isEmpty() ? position : (int) Math.min(position + limit, feed.size());
    JsonObject page = new JsonObject();
    JsonArray events = new JsonArray();
    feed.subList(position, end).forEach(events::add);
    page.add("events", events);
    page.addProperty("cursor", "mock_" + end);
    page.addProperty("hasMore", end < feed.size());
    return page;
  }

  /** The asset's state as events snapshot it. */
  static JsonObject snapshot(JsonObject asset) {
    JsonObject snapshot = new JsonObject();
    snapshot.add("id", asset.get("id"));
    snapshot.add("externalId", Objects.requireNonNullElse(asset.get("externalId"), JsonNull.INSTANCE));
    snapshot.add("uploadPresetId", Objects.requireNonNullElse(asset.get("uploadPresetId"), JsonNull.INSTANCE));
    JsonObject upload = new JsonObject(), classification = new JsonObject(), moderation = new JsonObject(), content = new JsonObject();
    upload.add("status", path(asset, "upload.status"));
    moderation.add("status", path(asset, "classification.moderation.status"));
    classification.add("status", path(asset, "classification.status"));
    classification.add("moderation", moderation);
    content.add("status", path(asset, "content.status"));
    snapshot.add("upload", upload);
    snapshot.add("classification", classification);
    snapshot.add("content", content);
    return snapshot;
  }

  // ------------------------------------------------------------------ CDN

  /** Like the CDN, content a browser could run as a document is served as a download. */
  private static boolean isActiveContentType(String type) {
    String normalized = type == null ? "" : type.toLowerCase(Locale.ROOT).split(";", 2)[0].strip();
    return Set.of("image/svg+xml", "application/xhtml+xml", "text/html", "application/xml", "text/xml").contains(normalized) || normalized.endsWith("+xml");
  }

  private Transport.Response cdn(MockCalmLensServerClient.Request request, List<String> parts) {
    String identifier = parts.get(2), resource = parts.get(3);
    JsonObject asset = parts.get(1).equals(projectId) ? projectAssets().stream()
        .filter(a -> identifier.equals(str(a, "id")) || identifier.equals(str(a, "externalId"))).findFirst().orElse(null) : null;
    if (asset == null) return error(new Failure(ErrorCodes.ASSET_NOT_FOUND, 404, "Asset not found"));
    Failure notAvailable = new Failure("asset/not-available", 403, "Asset is not available");
    String status = str(asset.getAsJsonObject("classification").getAsJsonObject("moderation"), "status");
    boolean isPublic = "public".equals(str(asset, "visibility"));
    String apiKey = request.header("X-Api-Key");
    if (resource.equals("placeholder")) {
      // Like the CDN's placeholder handler: an image's ThumbHash, public for public assets whatever
      // their moderation status; refused for purged assets, assets without one (not yet classified,
      // or content removed) and, for private assets, keys without assets:download.
      String thumbhash = str(asset.getAsJsonObject("content").get("image") instanceof JsonObject image ? image : null, "thumbhash");
      if (thumbhash == null || "purged".equals(status)) return error(notAvailable);
      if (!isPublic && !canDownload(str(asset, "folderId"), apiKey)) return error(notAvailable);
      return served(request, Thumbhash.toPng(Base64.getDecoder().decode(thumbhash)), "image/png", "Cache-Control",
          (isPublic ? "public" : "private") + ", max-age=3600", "Cache-Tag", "asset-" + str(asset, "id"), "ETag", "\"" + thumbhash + "\"");
    }
    // Like the CDN, delivery checks come first and refuse everyone: content still uploading,
    // blocked or purged, failed processing or removed content.
    MockCalmLensServerClient.StoredContent stored = storage.content.get(str(asset, "id"));
    if ("uploading".equals(str(asset.getAsJsonObject("upload"), "status")) || "purged".equals(status) || "blocked".equals(status)
        || "failed".equals(str(asset.getAsJsonObject("classification"), "status"))
        || "removed".equals(str(asset.getAsJsonObject("content"), "status")) || stored == null)
      return error(notAvailable);
    // Then access: private assets, and public age-restricted ones requested without
    // allowAgeRestricted, need an API key with assets:download for the asset's folder.
    boolean isPrivate = !isPublic || "age-restricted".equals(status) && !"true".equals(request.query().get("allowAgeRestricted"));
    if (isPrivate && !canDownload(str(asset, "folderId"), apiKey))
      return error(new Failure("asset/api-key-missing-permission", 403, "This API key needs assets:download permission for this asset’s folder."));
    String type = stored.type() == null || stored.type().isEmpty() ? "application/octet-stream" : stored.type();
    boolean image = "image".equals(str(asset, "type"));
    List<String> headers = new ArrayList<>(List.of(
        // Like the CDN: an image's bytes are immutable for a year, other content is kept for an
        // hour, publicly only when delivery is public.
        "Cache-Control", (isPrivate ? "private" : "public") + ", " + (image ? "max-age=31536000, immutable" : "max-age=3600"),
        "Cache-Tag", "asset-" + str(asset, "id")));
    if (image) {
      headers.addAll(List.of("ETag", "\"" + str(asset, "id") + "\"",
          "Expires", DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.ofEpochMilli(now() + 31536000L * 1000).atOffset(ZoneOffset.UTC))));
    }
    headers.addAll(List.of("X-Content-Type-Options", "nosniff", "Content-Security-Policy", "sandbox; default-src 'none'"));
    if (isActiveContentType(type)) headers.addAll(List.of("Content-Disposition", "attachment"));
    return served(request, stored.bytes(), type, headers.toArray(String[]::new));
  }

  /** A 200 CDN response with its length and request ID; {@code HEAD} gets no body. */
  private static Transport.Response served(MockCalmLensServerClient.Request request, byte[] bytes, String type, String... headers) {
    Transport.Response response = respond(200, type, bytes, headers);
    return request.method().equals("HEAD") ? new Transport.Response(200, response.headers(), new byte[0]) : response;
  }

  private boolean canDownload(String folderId, String apiKey) {
    JsonArray granted = grants;
    if (granted == null) {
      if (apiKey == null || !apiKey.startsWith("sk_test_")) return false;
      try {
        granted = JsonParser.parseString(new String(Base64.getUrlDecoder().decode(apiKey.substring(8)), StandardCharsets.UTF_8)).getAsJsonArray();
      } catch (RuntimeException invalid) {
        return false;
      }
    }
    try {
      for (JsonElement element : granted) {
        JsonObject grant = element.getAsJsonObject();
        boolean download = false;
        for (JsonElement action : grant.getAsJsonArray("actions")) download |= action.getAsString().equals("assets:download");
        if (!download) continue;
        String folder = str(grant, "folderId");
        if (folder == null) return true;
        Set<String> seen = new HashSet<>();
        for (String current = folderId; current != null && seen.add(current); current = str(storage.folders.get(current), "parentId")) {
          if (current.equals(folder)) return true;
          if (!bool(grant, "includeSubfolders")) break;
        }
      }
    } catch (RuntimeException invalid) {
      return false;
    }
    return false;
  }

  /** Renders a ThumbHash as the small PNG the CDN's placeholder resource serves. */
  static final class Thumbhash {
    private Thumbhash() {}

    static byte[] toPng(byte[] hash) {
      int[] header = {hash[0] & 0xff, hash[1] & 0xff, hash[2] & 0xff, hash[3] & 0xff, hash[4] & 0xff, hash.length > 5 ? hash[5] & 0xff : 0};
      int header24 = header[0] | header[1] << 8 | header[2] << 16, header16 = header[3] | header[4] << 8;
      double lDc = (header24 & 63) / 63.0, pDc = (header24 >> 6 & 63) / 31.5 - 1, qDc = (header24 >> 12 & 63) / 31.5 - 1;
      double lScale = (header24 >> 18 & 31) / 31.0;
      boolean hasAlpha = (header24 >> 23) != 0;
      double pScale = (header16 >> 3 & 63) / 63.0, qScale = (header16 >> 9 & 63) / 63.0;
      boolean landscape = (header16 >> 15) != 0;
      int lx = Math.max(3, landscape ? hasAlpha ? 5 : 7 : header16 & 7), ly = Math.max(3, landscape ? header16 & 7 : hasAlpha ? 5 : 7);
      double aDc = hasAlpha ? (header[5] & 15) / 15.0 : 1, aScale = (header[5] >> 4) / 15.0;
      int[] index = {0};
      int acStart = hasAlpha ? 6 : 5;
      double[] lAc = decode(hash, acStart, index, lx, ly, lScale);
      double[] pAc = decode(hash, acStart, index, 3, 3, pScale * 1.25);
      double[] qAc = decode(hash, acStart, index, 3, 3, qScale * 1.25);
      double[] aAc = hasAlpha ? decode(hash, acStart, index, 5, 5, aScale) : null;
      double ratio = (double) (landscape ? hasAlpha ? 5 : 7 : header[3] & 7) / (landscape ? header[3] & 7 : hasAlpha ? 5 : 7);
      int w = (int) Math.round(ratio > 1 ? 32 : 32 * ratio), h = (int) Math.round(ratio > 1 ? 32 / ratio : 32);
      byte[] rgba = new byte[w * h * 4];
      double[] fx = new double[Math.max(lx, hasAlpha ? 5 : 3)], fy = new double[Math.max(ly, hasAlpha ? 5 : 3)];
      for (int y = 0, i = 0; y < h; y++) {
        for (int x = 0; x < w; x++, i += 4) {
          double l = lDc, p = pDc, q = qDc, a = aDc;
          for (int cx = 0; cx < fx.length; cx++) fx[cx] = Math.cos(Math.PI / w * (x + 0.5) * cx);
          for (int cy = 0; cy < fy.length; cy++) fy[cy] = Math.cos(Math.PI / h * (y + 0.5) * cy);
          for (int cy = 0, j = 0; cy < ly; cy++)
            for (int cx = cy > 0 ? 0 : 1; cx * ly < lx * (ly - cy); cx++, j++) l += lAc[j] * fx[cx] * fy[cy] * 2;
          for (int cy = 0, j = 0; cy < 3; cy++)
            for (int cx = cy > 0 ? 0 : 1; cx < 3 - cy; cx++, j++) {
              double f = fx[cx] * fy[cy] * 2;
              p += pAc[j] * f;
              q += qAc[j] * f;
            }
          if (hasAlpha)
            for (int cy = 0, j = 0; cy < 5; cy++)
              for (int cx = cy > 0 ? 0 : 1; cx < 5 - cy; cx++, j++) a += aAc[j] * fx[cx] * fy[cy] * 2;
          double b = l - 2.0 / 3 * p, r = (3 * l - b + q) / 2, g = r - q;
          rgba[i] = (byte) (int) Math.max(0, 255 * Math.min(1, r));
          rgba[i + 1] = (byte) (int) Math.max(0, 255 * Math.min(1, g));
          rgba[i + 2] = (byte) (int) Math.max(0, 255 * Math.min(1, b));
          rgba[i + 3] = (byte) (int) Math.max(0, 255 * Math.min(1, a));
        }
      }
      return png(w, h, rgba);
    }

    private static double[] decode(byte[] hash, int start, int[] index, int nx, int ny, double scale) {
      List<Double> ac = new ArrayList<>();
      for (int cy = 0; cy < ny; cy++)
        for (int cx = cy > 0 ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
          int at = start + (index[0] >> 1);
          int nibble = at < hash.length ? (hash[at] & 0xff) >> ((index[0]++ & 1) << 2) & 15 : 0;
          if (at >= hash.length) index[0]++;
          ac.add((nibble / 7.5 - 1) * scale);
        }
      return ac.stream().mapToDouble(Double::doubleValue).toArray();
    }

    /** An uncompressed RGBA PNG (stored deflate blocks), as the CDN's placeholder encoder writes it. */
    private static byte[] png(int w, int h, byte[] rgba) {
      java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
      out.writeBytes(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
      java.nio.ByteBuffer ihdr = java.nio.ByteBuffer.allocate(13).putInt(w).putInt(h).put((byte) 8).put((byte) 6).put((byte) 0).put((byte) 0).put((byte) 0);
      chunk(out, "IHDR", ihdr.array());
      int row = w * 4 + 1;
      java.io.ByteArrayOutputStream idat = new java.io.ByteArrayOutputStream();
      idat.write(120);
      idat.write(1);
      long a = 1, b = 0;
      for (int y = 0, i = 0; y < h; y++) {
        idat.write(y + 1 < h ? 0 : 1);
        idat.write(row & 255);
        idat.write(row >> 8);
        idat.write(~row & 255);
        idat.write((row >> 8 ^ 255) & 255);
        idat.write(0);
        b = (b + a) % 65521;
        for (int end = i + row - 1; i < end; i++) {
          int u = rgba[i] & 255;
          idat.write(u);
          a = (a + u) % 65521;
          b = (b + a) % 65521;
        }
      }
      idat.write((int) (b >> 8));
      idat.write((int) (b & 255));
      idat.write((int) (a >> 8));
      idat.write((int) (a & 255));
      chunk(out, "IDAT", idat.toByteArray());
      chunk(out, "IEND", new byte[0]);
      return out.toByteArray();
    }

    private static void chunk(java.io.ByteArrayOutputStream out, String type, byte[] data) {
      out.writeBytes(java.nio.ByteBuffer.allocate(4).putInt(data.length).array());
      byte[] name = type.getBytes(StandardCharsets.US_ASCII);
      out.writeBytes(name);
      out.writeBytes(data);
      java.util.zip.CRC32 crc = new java.util.zip.CRC32();
      crc.update(name);
      crc.update(data);
      out.writeBytes(java.nio.ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
    }
  }
}
