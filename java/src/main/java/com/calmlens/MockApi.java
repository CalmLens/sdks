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
    final String code;
    final int status;

    Failure(String code) { this(code, ErrorCodes.httpStatus(code).orElse(400), code); }

    Failure(String code, String message) { this(code, ErrorCodes.httpStatus(code).orElse(400), message); }

    Failure(String code, int status, String message) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  private record Saved(String fingerprint, int status, byte[] body) {}

  private static final Set<String> JSON_QUERY = Set.of("metadata", "processingOptions");
  private static final Set<String> INT_QUERY = Set.of("pageSize", "pageIndex", "limit", "partNumber", "sizeInBytes", "totalSizeInBytes");
  private static final Set<String> BOOL_QUERY = Set.of("queue", "isFinal", "searchAll", "resolveOnly");
  private static final Pattern ORDERING = Pattern.compile("ordering\\[(\\d+)]\\[(\\w+)]");
  private static final Pattern IDS = Pattern.compile("ids\\[(\\d+)]");
  private static final long MIB = 1024 * 1024;

  final MockCalmLensServerClient.Storage storage = new MockCalmLensServerClient.Storage();
  private final MockCalmLensServerClient.Options options;
  private final String projectId, apiBase, cdnBase;
  private final Map<String, Saved> idempotent = new HashMap<>();
  /** Open multipart uploads by asset ID: their queue choice, declared total size and whether they are images. */
  private final Map<String, JsonObject> uploads = new HashMap<>();
  private final Map<String, JsonObject> lenses = new LinkedHashMap<>();

  MockApi(String projectId, String apiBase, String cdnBase, MockCalmLensServerClient.Options options) {
    this.projectId = projectId;
    this.apiBase = apiBase;
    this.cdnBase = cdnBase;
    this.options = options;
  }

  long now() { return options.now.getAsLong(); }

  String createId() { return options.createId.get(); }

  // ------------------------------------------------------------------ Transport

  Transport.Response answer(MockCalmLensServerClient.Request request) throws IOException {
    String url = request.url().split("\\?", 2)[0];
    if (url.startsWith(cdnBase + "/assets/")) {
      List<String> parts = segments(url.substring(cdnBase.length()));
      if (parts.size() >= 4) return cdn(request, parts);
    }
    if (!url.startsWith(apiBase + "/")) throw unsupported(request.method(), request.url());
    List<String> parts = segments(url.substring(apiBase.length()));
    String key = request.header("Idempotency-Key");
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
      return error(failure);
    }
    byte[] bytes = result == null ? new byte[0] : Json.write(result).getBytes(StandardCharsets.UTF_8);
    int status = result == null ? 204 : 200;
    if (key != null) idempotent.put(key, new Saved(fingerprint, status, bytes));
    return respond(status, result == null ? null : "application/json", bytes);
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

  private static Transport.Response error(Failure failure) {
    JsonObject body = new JsonObject();
    body.addProperty("code", failure.code);
    body.addProperty("message", failure.getMessage());
    body.addProperty("traceId", "trace_mock");
    return respond(failure.status, "application/json", Json.write(body).getBytes(StandardCharsets.UTF_8));
  }

  private static List<String> segments(String path) {
    List<String> parts = new ArrayList<>();
    for (String part : path.split("/")) if (!part.isEmpty()) parts.add(URLDecoder.decode(part, StandardCharsets.UTF_8));
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

  private static JsonElement path(JsonObject object, String dotted) {
    JsonElement current = object;
    for (String key : dotted.split("\\."))
      current = current != null && current.isJsonObject() ? current.getAsJsonObject().get(key) : null;
    return current;
  }

  // ------------------------------------------------------------------ Routes

  private JsonElement dispatch(String method, List<String> parts, JsonObject q, JsonObject body, byte[] raw, String upload)
      throws Failure, IOException {
    long now = now();
    if (parts.size() >= 3 && parts.get(0).equals("projects")) {
      if (!parts.get(1).equals(projectId)) throw new Failure(ErrorCodes.API_KEY_PROJECT_MISMATCH);
      switch (method + " " + String.join("/", parts.subList(2, parts.size()))) {
        case "GET events": return events(q);
        case "PUT lenses": return putLenses(body, now);
        case "GET folders": return listFolders(q);
        case "POST folders": return createFolder(body, now);
        case "GET assets/search": return search(q);
        case "GET assets/page": {
          String folderId = str(q, "folderId");
          if (folderId != null) folder(folderId);
          return page(asset -> folderId == null || folderId.equals(str(asset, "folderId")), q);
        }
        case "POST assets": return createAsset(upload, q, body, raw, now);
        default: break;
      }
    } else if (parts.size() == 2 || parts.size() == 3) {
      String suffix = parts.size() == 3 ? parts.get(2) : "";
      if (parts.get(0).equals("assets")) return assetRoute(method, parts.get(1), suffix, q, body, raw, now);
      if (parts.get(0).equals("folders")) return folderRoute(method, parts.get(1), suffix, body, now);
    }
    throw unsupported(method, "/" + String.join("/", parts));
  }

  private JsonObject asset(String id) throws Failure {
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

  private JsonObject createAsset(String upload, JsonObject q, JsonObject body, byte[] raw, long now) throws Failure {
    // X-CalmLens-Upload picks the mode: absent is a JSON body (a URL), "content" raw content and
    // "part" the raw first part of a multipart upload.
    boolean rawUpload = upload.equals("content") || upload.equals("part"), multipart = upload.equals("part");
    JsonObject o = rawUpload ? q : body;
    String mime = Objects.requireNonNullElse(str(o, "contentType"), "").toLowerCase(Locale.ROOT);
    String url = rawUpload ? null : str(o, "url");
    String kind = url != null ? "website"
        : mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") ? mime.substring(0, mime.indexOf('/'))
        : mime.startsWith("text/") ? "plaintext-document" : mime.contains("pdf") || mime.contains("document") ? "multimedia-document" : "file";
    String externalId = str(o, "externalId");
    if (externalId != null && projectAssets().stream().anyMatch(a -> externalId.equals(str(a, "externalId"))))
      throw new Failure(ErrorCodes.DUPLICATE_EXTERNAL_ID);
    if (str(o, "folderId") != null) folder(str(o, "folderId"));
    Long total = q.has("totalSizeInBytes") ? q.get("totalSizeInBytes").getAsLong() : null;
    if (multipart && kind.equals("image") && total != null) {
      if (total > 20 * MIB) throw new Failure(ErrorCodes.MULTIPART_IMAGE_TOO_LARGE);
      if (total < 10 * MIB) throw new Failure(ErrorCodes.MULTIPART_IMAGE_TOO_SMALL);
    }
    boolean queue = bool(q, "queue"), last = !multipart || bool(q, "isFinal");
    JsonElement processing = o.get("processingOptions");
    boolean keep = processing != null && processing.isJsonObject() && bool(processing.getAsJsonObject(), "keepContentAfterProcessing");

    JsonObject asset = new JsonObject();
    String id = createId();
    asset.addProperty("id", id);
    asset.addProperty("projectId", projectId);
    for (String key : List.of("name", "description", "metadata", "externalId", "externalUrl", "uploadPresetId", "processingOptions", "folderId"))
      asset.add(key, o.has(key) ? o.get(key).deepCopy() : JsonNull.INSTANCE);
    if (url != null) asset.addProperty("externalUrl", url);
    asset.add("parentId", JsonNull.INSTANCE);
    asset.addProperty("type", kind);
    asset.addProperty("visibility", Objects.requireNonNullElse(str(o, "visibility"), "private"));
    asset.add("tags", new JsonArray());
    asset.addProperty("createdAt", now);
    asset.addProperty("updatedAt", now);
    JsonObject uploadState = new JsonObject();
    uploadState.addProperty("status", last ? "completed" : "uploading");
    uploadState.addProperty("updatedAt", now);
    uploadState.add("partsReceived", multipart ? new JsonPrimitive(1) : JsonNull.INSTANCE);
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
    JsonObject content = new JsonObject();
    content.addProperty("status", keep ? "stored" : "temporary");
    content.add("removalReason", JsonNull.INSTANCE);
    content.addProperty("updatedAt", now);
    content.add("format", mime.isEmpty() ? JsonNull.INSTANCE : new JsonPrimitive(mime));
    content.add("sizeInBytes", rawUpload && raw != null ? new JsonPrimitive(raw.length) : JsonNull.INSTANCE);
    asset.add("content", content);

    storage.assets.put(id, asset);
    if (rawUpload && raw != null) {
      TreeMap<Integer, byte[]> parts = new TreeMap<>();
      parts.put(1, raw.clone());
      storage.content.put(id, new MockCalmLensServerClient.StoredContent(mime, parts));
    }
    if (multipart && !last) {
      JsonObject open = new JsonObject();
      open.addProperty("queue", queue);
      if (total != null) open.addProperty("total", total);
      open.addProperty("image", kind.equals("image"));
      uploads.put(id, open);
    }
    if (last) applyOutcome(asset, queue ? options.queuedOutcome : options.analyzedOutcome, now);
    return asset;
  }

  /**
   * Moves an asset to an outcome like the pipeline: a decision finishes processing, {@code purged}
   * removes the content, and finished processing removes content held only temporarily.
   */
  void applyOutcome(JsonObject asset, MockCalmLensServerClient.Outcome outcome, long now) {
    boolean decided = outcome != MockCalmLensServerClient.Outcome.PENDING && outcome != MockCalmLensServerClient.Outcome.FAILED;
    JsonObject classification = asset.getAsJsonObject("classification");
    classification.addProperty("status", decided ? "completed" : outcome == MockCalmLensServerClient.Outcome.FAILED ? "failed" : "processing");
    classification.addProperty("updatedAt", now);
    classification.add("completedAt", decided ? new JsonPrimitive(now) : JsonNull.INSTANCE);
    classification.getAsJsonObject("moderation").addProperty("status", decided ? outcome.value() : "pending");
    asset.getAsJsonObject("upload").addProperty("status", "completed");
    asset.getAsJsonObject("upload").addProperty("updatedAt", now);
    if (outcome == MockCalmLensServerClient.Outcome.PURGED) removeContent(asset, "policy", now);
    else if (decided && "temporary".equals(str(asset.getAsJsonObject("content"), "status"))) removeContent(asset, "retention", now);
    asset.addProperty("updatedAt", now);
  }

  private void removeContent(JsonObject asset, String reason, long now) {
    storage.content.remove(str(asset, "id"));
    JsonObject content = asset.getAsJsonObject("content");
    if ("removed".equals(str(content, "status"))) return;
    content.addProperty("status", "removed");
    content.addProperty("removalReason", reason);
    content.addProperty("updatedAt", now);
    content.add("extractedText", JsonNull.INSTANCE);
  }

  private void uploadPart(JsonObject asset, JsonObject q, byte[] raw, long now) throws Failure {
    String id = str(asset, "id");
    JsonObject open = uploads.get(id);
    MockCalmLensServerClient.StoredContent stored = storage.content.get(id);
    if (open == null || stored == null || !"uploading".equals(str(asset.getAsJsonObject("upload"), "status")))
      throw new Failure(ErrorCodes.UPLOAD_NOT_OPEN);
    long number = number(q, "partNumber", 0, "partNumber", 1, Integer.MAX_VALUE);
    if (number != stored.parts().lastKey() + 1) throw new Failure(ErrorCodes.INVALID_UPLOAD_PART_NUMBER);
    byte[] part = raw == null ? new byte[0] : raw;
    long size = stored.bytes().length + part.length;
    boolean last = bool(q, "isFinal");
    if (bool(open, "image") && size > 20 * MIB) throw new Failure(ErrorCodes.MULTIPART_IMAGE_TOO_LARGE);
    if (bool(open, "image") && last && size < 10 * MIB) throw new Failure(ErrorCodes.MULTIPART_IMAGE_TOO_SMALL);
    Long total = open.has("total") ? open.get("total").getAsLong() : null;
    if (total != null && (size > total || last && size != total)) throw new Failure(ErrorCodes.UPLOAD_SIZE_MISMATCH);
    stored.parts().put((int) number, part.clone());
    asset.getAsJsonObject("content").addProperty("sizeInBytes", size);
    asset.getAsJsonObject("upload").addProperty("partsReceived", number);
    if (last) {
      boolean queue = q.has("queue") ? bool(q, "queue") : bool(open, "queue");
      uploads.remove(id);
      applyOutcome(asset, queue ? options.queuedOutcome : options.analyzedOutcome, now);
    }
  }

  private JsonElement assetRoute(String method, String id, String suffix, JsonObject q, JsonObject body, byte[] raw, long now)
      throws Failure, IOException {
    JsonObject asset = asset(id);
    switch (method + " " + suffix) {
      case "GET ": return asset;
      case "GET children": return page(child -> id.equals(str(child, "parentId")), q);
      case "DELETE ":
        storage.assets.remove(id);
        storage.content.remove(id);
        uploads.remove(id);
        return null;
      case "DELETE content": removeContent(asset, "requested", now); break;
      case "POST retry":
        if (!"failed".equals(str(asset.getAsJsonObject("classification"), "status"))) throw new Failure(ErrorCodes.ASSET_NOT_RETRYABLE);
        if ("removed".equals(str(asset.getAsJsonObject("content"), "status"))) throw new Failure(ErrorCodes.ASSET_CONTENT_UNAVAILABLE);
        applyOutcome(asset, MockCalmLensServerClient.Outcome.PENDING, now);
        break;
      case "POST move": {
        String folderId = str(body, "folderId");
        if (folderId != null) folder(folderId);
        asset.add("folderId", folderId == null ? JsonNull.INSTANCE : new JsonPrimitive(folderId));
        break;
      }
      case "POST part": uploadPart(asset, q, raw, now); break;
      case "POST signed-url": {
        long expires = number(body, "expiresInSeconds", 900, "expiresInSeconds", 1, Integer.MAX_VALUE);
        List<String> params = new ArrayList<>();
        for (String key : List.of("lens", "transform")) {
          String value = str(body, key);
          if (value != null) params.add(key + "=" + URLEncoder.encode(value, StandardCharsets.UTF_8));
        }
        params.add("expires=" + expires);
        JsonObject signed = new JsonObject();
        signed.addProperty("url", options.signedUrlBaseUrl + "/assets/" + URLEncoder.encode(id, StandardCharsets.UTF_8).replace("+", "%20") + "/"
            + Objects.requireNonNullElse(str(body, "resource"), "rendered") + "?" + String.join("&", params));
        signed.addProperty("expiresAt", now + expires * 1000);
        return signed;
      }
      case "PATCH ":
        for (var entry : body.entrySet()) {
          String key = entry.getKey();
          if (Set.of("id", "projectId", "upload", "classification", "content", "createdAt", "updatedAt").contains(key)) continue;
          String value = entry.getValue().isJsonPrimitive() ? entry.getValue().getAsString() : null;
          if (key.equals("folderId") && value != null) folder(value);
          if (key.equals("externalId") && value != null
              && projectAssets().stream().anyMatch(other -> other != asset && value.equals(str(other, "externalId"))))
            throw new Failure(ErrorCodes.DUPLICATE_EXTERNAL_ID);
          asset.add(key, entry.getValue().deepCopy());
        }
        break;
      default: throw unsupported(method, "/assets/" + id + "/" + suffix);
    }
    asset.addProperty("updatedAt", now);
    return asset;
  }

  // ------------------------------------------------------------------ Lists and search

  /** A subset of RSQL: {@code ;} (and), {@code ,} (or), {@code ==} and {@code !=} (with {@code *} wildcards), {@code =in=}, {@code =out=}, {@code =gt=}, {@code =ge=}, {@code =lt=} and {@code =le=}. */
  static Predicate<JsonObject> rsql(String expression) throws IOException {
    List<List<String>> groups = new ArrayList<>(List.of(new ArrayList<>()));
    StringBuilder current = new StringBuilder();
    int depth = 0;
    char quote = 0;
    for (char c : expression.toCharArray()) {
      if (quote != 0) { if (c == quote) quote = 0; current.append(c); continue; }
      if (c == '"' || c == '\'') quote = c;
      else if (c == '(') {
        if (!current.toString().matches("(?s).*=(in|out)=\\s*")) throw new IOException("MockCalmLensServerClient filters do not support parentheses for grouping");
        depth++;
      } else if (c == ')') depth--;
      if (depth == 0 && (c == ';' || c == ',')) {
        groups.get(groups.size() - 1).add(current.toString());
        current.setLength(0);
        if (c == ',') groups.add(new ArrayList<>());
      } else current.append(c);
    }
    groups.get(groups.size() - 1).add(current.toString());
    List<List<Predicate<JsonObject>>> alternatives = new ArrayList<>();
    for (List<String> group : groups) {
      List<Predicate<JsonObject>> tests = new ArrayList<>();
      for (String text : group) tests.add(comparison(text));
      alternatives.add(tests);
    }
    return asset -> alternatives.stream().anyMatch(group -> group.stream().allMatch(test -> test.test(asset)));
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
    if (aNull || bNull) return Boolean.compare(aNull, bNull);
    if (a.isJsonPrimitive() && b.isJsonPrimitive() && a.getAsJsonPrimitive().isNumber() && b.getAsJsonPrimitive().isNumber())
      return Double.compare(a.getAsDouble(), b.getAsDouble());
    return a.getAsString().compareTo(b.getAsString());
  }

  private JsonObject page(Predicate<JsonObject> include, JsonObject q) throws Failure, IOException {
    List<JsonObject> items = projectAssets().stream().filter(include).collect(Collectors.toList());
    String filter = str(q, "filter");
    if (filter != null && !filter.isBlank()) items = items.stream().filter(rsql(filter)).collect(Collectors.toList());
    JsonArray ordering = new JsonArray();
    if (q.has("ordering")) q.getAsJsonArray("ordering").forEach(order -> ordering.add(order.deepCopy()));
    else {
      JsonObject newest = new JsonObject();
      newest.addProperty("field", "createdAt");
      newest.addProperty("direction", "DESC");
      ordering.add(newest);
    }
    boolean byId = false;
    Comparator<JsonObject> comparator = (a, b) -> 0;
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
    for (JsonElement element : ordering) {
      String field = str(element.getAsJsonObject(), "field");
      Comparator<JsonObject> next = (a, b) -> compare(a.get(field), b.get(field));
      comparator = comparator.thenComparing("DESC".equals(str(element.getAsJsonObject(), "direction")) ? next.reversed() : next);
    }
    items.sort(comparator);
    long size = number(q, "pageSize", 10, "pageSize", 1, 100);
    String cursor = str(q, "cursor");
    if (cursor != null && !cursor.isEmpty()) {
      JsonObject boundary;
      try {
        boundary = JsonParser.parseString(new String(Base64.getDecoder().decode(cursor), StandardCharsets.UTF_8)).getAsJsonObject();
        for (JsonElement order : ordering) if (!boundary.has(str(order.getAsJsonObject(), "field"))) throw new IllegalArgumentException("Invalid cursor");
      } catch (RuntimeException invalid) {
        throw new Failure(ErrorCodes.INVALID_CURSOR, "Invalid cursor");
      }
      Comparator<JsonObject> order = comparator;
      items = items.stream().filter(item -> order.compare(item, boundary) > 0).collect(Collectors.toList());
    }
    List<JsonObject> selected = items.subList(0, (int) Math.min(size, items.size()));
    boolean more = items.size() > size;
    JsonObject page = new JsonObject();
    JsonArray list = new JsonArray();
    selected.forEach(list::add);
    page.add("items", list);
    if (more) {
      JsonObject last = new JsonObject();
      for (JsonElement order : ordering) {
        String field = str(order.getAsJsonObject(), "field");
        last.add(field, selected.get(selected.size() - 1).get(field));
      }
      page.addProperty("nextCursor", Base64.getEncoder().encodeToString(Json.write(last).getBytes(StandardCharsets.UTF_8)));
    } else page.add("nextCursor", JsonNull.INSTANCE);
    page.addProperty("pageSize", size);
    page.add("ordering", ordering);
    page.addProperty("hasMore", more);
    return page;
  }

  private JsonObject search(JsonObject q) throws Failure {
    String text = Objects.requireNonNullElse(str(q, "query"), "").strip().toLowerCase(Locale.ROOT);
    if (text.isEmpty()) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "query is required");
    long limit = number(q, "limit", 10, "limit", 1, 100);
    List<String> fields = List.of("name", "id", "externalId", "description");
    List<JsonObject> items = new ArrayList<>();
    for (JsonObject asset : projectAssets()) {
      JsonArray matched = new JsonArray();
      for (String field : fields) if (Objects.requireNonNullElse(str(asset, field), "").toLowerCase(Locale.ROOT).contains(text)) matched.add(field);
      JsonElement tags = asset.get("tags");
      if (tags != null && tags.isJsonArray()) {
        for (JsonElement tag : tags.getAsJsonArray())
          if (tag.isJsonPrimitive() && tag.getAsString().toLowerCase(Locale.ROOT).contains(text)) { matched.add("tags"); break; }
      }
      if (matched.isEmpty()) continue;
      JsonObject item = new JsonObject();
      item.add("asset", asset);
      item.addProperty("score", matched.size() / (double) (fields.size() + 1));
      item.add("matchedFields", matched);
      items.add(item);
    }
    items.sort(Comparator.comparingDouble((JsonObject item) -> item.get("score").getAsDouble()).reversed());
    JsonObject result = new JsonObject();
    result.add("query", q.get("query"));
    JsonArray list = new JsonArray();
    items.stream().limit(limit).forEach(list::add);
    result.add("items", list);
    // The mock has no semantic index, so every search mode is keyword matching.
    result.addProperty("semanticStatus", "disabled");
    return result;
  }

  // ------------------------------------------------------------------ Folders, lenses and events

  private void unique(String name, String parentId, String exclude) throws Failure {
    for (JsonObject folder : projectFolders())
      if (!str(folder, "id").equals(exclude) && Objects.equals(str(folder, "name"), name) && Objects.equals(str(folder, "parentId"), parentId))
        throw new Failure(ErrorCodes.DUPLICATE_FOLDER_NAME);
  }

  private JsonObject listFolders(JsonObject q) throws Failure {
    String parentId = str(q, "parentId"), search = Objects.requireNonNullElse(str(q, "search"), "").toLowerCase(Locale.ROOT);
    boolean everywhere = bool(q, "searchAll") && !search.isEmpty(), resolveOnly = bool(q, "resolveOnly");
    List<JsonObject> all = projectFolders();
    String sort = "createdAt".equals(str(q, "sort")) ? "createdAt" : "name";
    Comparator<JsonObject> order = Comparator.<JsonObject, JsonElement>comparing(f -> f.get(sort), MockApi::compare).thenComparing(f -> str(f, "id"));
    List<JsonObject> found = all.stream()
        .filter(f -> (everywhere || Objects.equals(str(f, "parentId"), parentId)) && Objects.requireNonNullElse(str(f, "name"), "").toLowerCase(Locale.ROOT).contains(search))
        .sorted("DESC".equals(str(q, "direction")) ? order.reversed() : order).collect(Collectors.toList());
    long size = number(q, "pageSize", 100, "pageSize", 1, 100), start = number(q, "pageIndex", 0, "pageIndex", 0, Integer.MAX_VALUE) * size;
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

  private JsonObject createFolder(JsonObject body, long now) throws Failure {
    String parentId = str(body, "parentId"), name = str(body, "name");
    if (name == null || name.isBlank()) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "name is required");
    if (parentId != null) folder(parentId);
    unique(name, parentId, null);
    JsonObject folder = body.deepCopy();
    folder.add("parentId", parentId == null ? JsonNull.INSTANCE : new JsonPrimitive(parentId));
    folder.addProperty("id", createId());
    folder.addProperty("projectId", projectId);
    folder.addProperty("createdAt", now);
    folder.addProperty("updatedAt", now);
    storage.folders.put(str(folder, "id"), folder);
    return folder;
  }

  private JsonElement folderRoute(String method, String id, String suffix, JsonObject body, long now) throws Failure, IOException {
    JsonObject folder = folder(id);
    switch (method + " " + suffix) {
      case "GET ": return folder;
      case "DELETE ":
        if (storage.assets.values().stream().anyMatch(a -> id.equals(str(a, "folderId")))
            || storage.folders.values().stream().anyMatch(f -> id.equals(str(f, "parentId"))))
          throw new Failure(ErrorCodes.FOLDER_NOT_EMPTY);
        storage.folders.remove(id);
        return null;
      case "POST move": {
        String parentId = str(body, "parentId");
        Set<String> visited = new HashSet<>(Set.of(id));
        for (String current = parentId; current != null; current = str(folder(current), "parentId"))
          if (!visited.add(current)) throw new Failure(ErrorCodes.FOLDER_PARENT_CYCLE);
        unique(str(folder, "name"), parentId, id);
        folder.add("parentId", parentId == null ? JsonNull.INSTANCE : new JsonPrimitive(parentId));
        break;
      }
      case "PATCH ":
        if (str(body, "name") != null) {
          unique(str(body, "name"), str(folder, "parentId"), id);
          folder.addProperty("name", str(body, "name"));
        }
        if (body.has("description")) folder.add("description", body.get("description").deepCopy());
        break;
      default: throw unsupported(method, "/folders/" + id + "/" + suffix);
    }
    folder.addProperty("updatedAt", now);
    return folder;
  }

  private JsonObject putLenses(JsonObject body, long now) throws Failure {
    Map<String, JsonObject> pending = new LinkedHashMap<>();
    lenses.forEach((key, lens) -> pending.put(key, lens.deepCopy()));
    JsonArray result = new JsonArray();
    for (JsonElement element : body.getAsJsonArray("lenses")) {
      JsonObject definition = element.getAsJsonObject();
      String identifier = str(definition, "identifier");
      JsonObject old = pending.get(identifier);
      boolean same = old != null && List.of("name", "description", "type", "active", "transforms", "version").stream()
          .allMatch(key -> Objects.equals(old.get(key), definition.get(key)));
      long version = definition.has("version") ? definition.get("version").getAsLong() : 1;
      if (old != null && !same && version <= old.get("version").getAsLong()) throw new Failure(ErrorCodes.LENS_VERSION_CONFLICT);
      JsonObject lens = old;
      if (!same) {
        lens = definition.deepCopy();
        if (!lens.has("version")) lens.addProperty("version", version);
        lens.addProperty("id", old != null ? str(old, "id") : createId());
        lens.addProperty("projectId", projectId);
        lens.add("userId", JsonNull.INSTANCE);
        lens.addProperty("createdAt", old != null ? old.get("createdAt").getAsLong() : now);
        lens.addProperty("updatedAt", now);
      }
      pending.put(identifier, lens);
      result.add(lens);
    }
    lenses.clear();
    lenses.putAll(pending);
    JsonObject answer = new JsonObject();
    answer.add("lenses", result);
    return answer;
  }

  /** Cursors are {@code <n>_mock}: the number of events in the feed when the cursor was taken. */
  private JsonObject events(JsonObject q) throws Failure {
    long limit = number(q, "limit", 50, "limit", 1, 100);
    List<JsonObject> feed = storage.events.stream().filter(e -> projectId.equals(str(e, "projectId"))).collect(Collectors.toList());
    int position = feed.size();
    String after = str(q, "after");
    if (after != null) {
      Matcher cursor = Pattern.compile("(\\d{1,9})_mock").matcher(after);
      if (!cursor.matches() || Integer.parseInt(cursor.group(1)) > feed.size()) throw new Failure(ErrorCodes.INVALID_EVENT_CURSOR);
      position = Integer.parseInt(cursor.group(1));
    }
    int end = (int) Math.min(position + limit, feed.size());
    JsonObject page = new JsonObject();
    JsonArray events = new JsonArray();
    feed.subList(position, end).forEach(events::add);
    page.add("events", events);
    page.addProperty("cursor", end + "_mock");
    page.addProperty("hasMore", end < feed.size());
    return page;
  }

  /** The asset's state as events snapshot it. */
  static JsonObject snapshot(JsonObject asset) {
    JsonObject snapshot = new JsonObject();
    snapshot.add("id", asset.get("id"));
    snapshot.add("externalId", asset.get("externalId"));
    snapshot.add("uploadPresetId", asset.get("uploadPresetId"));
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

  private Transport.Response cdn(MockCalmLensServerClient.Request request, List<String> parts) {
    String identifier = parts.get(2), resource = parts.get(3);
    JsonObject asset = parts.get(1).equals(projectId) ? projectAssets().stream()
        .filter(a -> identifier.equals(str(a, "id")) || identifier.equals(str(a, "externalId"))).findFirst().orElse(null) : null;
    if (asset == null) return error(new Failure(ErrorCodes.ASSET_NOT_FOUND, 404, "Asset not found"));
    // A placeholder is served whatever the moderation status. A public age-restricted asset needs
    // the allowAgeRestricted=true opt-in; otherwise it needs the download permission, like a private one.
    String status = str(asset.getAsJsonObject("classification").getAsJsonObject("moderation"), "status");
    boolean placeholder = resource.equals("placeholder");
    boolean ageRestricted = !placeholder && "age-restricted".equals(status) && !"true".equals(request.query().get("allowAgeRestricted"));
    boolean restricted = !"public".equals(str(asset, "visibility")) || ageRestricted;
    if (restricted && !canDownload(str(asset, "folderId"), request.header("X-Api-Key")))
      return error(new Failure("asset/api-key-missing-permission", 403, "The API key cannot download this asset"));
    MockCalmLensServerClient.StoredContent stored = storage.content.get(str(asset, "id"));
    if (stored == null || "uploading".equals(str(asset.getAsJsonObject("upload"), "status")))
      return error(new Failure(ErrorCodes.ASSET_CONTENT_UNAVAILABLE, 404, "Asset content is not available"));
    if (!placeholder && ("blocked".equals(status) || "purged".equals(status)))
      return error(new Failure("asset/not-available", 403, "This asset is not available"));
    byte[] data = stored.bytes();
    int code = 200;
    List<String> extra = new ArrayList<>(List.of("Accept-Ranges", "bytes", "Cache-Control", restricted ? "private, no-store" : "public, max-age=31536000"));
    String range = request.header("Range");
    Matcher single = range == null ? null : Pattern.compile("bytes=(\\d+)-(\\d*)").matcher(range.strip());
    if (single != null && single.matches()) {
      long start = Long.parseLong(single.group(1)), end = single.group(2).isEmpty() ? data.length - 1 : Long.parseLong(single.group(2));
      if (start > end || start >= data.length) return error(new Failure("cdn/invalid-range", 416, "Range not satisfiable"));
      end = Math.min(end, data.length - 1);
      extra.addAll(List.of("Content-Range", "bytes " + start + "-" + end + "/" + data.length));
      data = java.util.Arrays.copyOfRange(data, (int) start, (int) end + 1);
      code = 206;
    }
    Transport.Response response = respond(code, stored.type(), data, extra.toArray(String[]::new));
    return request.method().equals("HEAD") ? new Transport.Response(code, response.headers(), new byte[0]) : response;
  }

  private boolean canDownload(String folderId, String apiKey) {
    if (apiKey == null || !apiKey.startsWith("sk_test_")) return false;
    try {
      JsonArray grants = JsonParser.parseString(new String(Base64.getUrlDecoder().decode(apiKey.substring(8)), StandardCharsets.UTF_8)).getAsJsonArray();
      for (JsonElement element : grants) {
        JsonObject grant = element.getAsJsonObject();
        boolean download = false;
        for (JsonElement action : grant.getAsJsonArray("actions")) download |= action.getAsString().equals("assets:download");
        if (!download) continue;
        String granted = str(grant, "folderId");
        if (granted == null) return true;
        Set<String> seen = new HashSet<>();
        for (String current = folderId; current != null && seen.add(current); current = str(storage.folders.get(current), "parentId")) {
          if (current.equals(granted)) return true;
          if (!bool(grant, "includeSubfolders")) break;
        }
      }
    } catch (RuntimeException invalid) {
      return false;
    }
    return false;
  }
}
