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
import java.util.Collections;
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

    /**
     * A request the API's schema refuses: {@code validation/invalid-request} with HTTP 400, listing
     * the field and its issue code (such as {@code validation/too-big}) in {@code details.issues}.
     */
    static Failure validation(String code, String path) {
      Map<String, Object> issue = new java.util.LinkedHashMap<>();
      issue.put("path", path);
      issue.put("message", "Invalid " + path);
      issue.put("code", code);
      return new Failure(ErrorCodes.INVALID_REQUEST, 400, "Invalid " + path, Map.of("issues", List.of(issue)));
    }
  }

  private record Saved(String fingerprint, int status, byte[] body) {}

  private static final Set<String> INT_QUERY = Set.of("pageSize", "partNumber", "sizeInBytes", "totalSizeInBytes");
  private static final Set<String> BOOL_QUERY = Set.of("wait", "isFinal");
  /** A {@code sort} field: a name, descending when prefixed with {@code -}, as the API's {@code sortQueryField} reads it. */
  private static final Pattern SORT_FIELD = Pattern.compile("-?[A-Za-z][A-Za-z0-9.]*");
  /** Like the API: 1 to 255 printable ASCII characters, without a space at either end. */
  private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[\\x21-\\x7e](?:[\\x20-\\x7e]{0,253}[\\x21-\\x7e])?");
  private static final long MIB = 1024 * 1024;
  private static final long MIN_PART_BYTES = 5 * MIB, MAX_IMAGE_BYTES = 20 * MIB;
  /** Like the API: an upload has at most this many parts. */
  private static final long MAX_UPLOAD_PARTS = 10_000;
  /** Every API cursor list returns this many items unless {@code pageSize} says otherwise. */
  private static final int DEFAULT_PAGE_SIZE = 50;
  private static final int MAX_PAGE_SIZE = 100, MAX_EVENTS_PAGE_SIZE = 100, MAX_FOLDER_PAGE_SIZE = 100;
  /**
   * The ThumbHash the mock gives every processed asset's preview, standing in for one computed
   * from its pixels. The {@code placeholder} resource serves it as a PNG, like the CDN.
   */
  static final String MOCK_THUMBHASH = "1QcSHQRnh493V4dIh4eXh1h4kJUI";
  /** The page the mock serves at {@code /embed}, standing in for the CDN's embed page. */
  private static final String MOCK_EMBED_HTML =
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Embed</title></head><body></body></html>";
  /** The size of the waveform the API makes as an audio asset's preview. */
  private static final int WAVEFORM_WIDTH = 1200, WAVEFORM_HEIGHT = 300;
  /** Audio and video formats browsers play as uploaded, so the API serves them as stored. */
  private static final Set<String> BROWSER_SAFE_MEDIA_FORMATS = Set.of(
      "video/mp4", "audio/mpeg", "audio/aac", "audio/mp4", "audio/x-m4a", "audio/ogg");
  /** Spreadsheets, which have no rendered file or preview. */
  private static final Set<String> SPREADSHEET_MIME_TYPES = Set.of(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/vnd.ms-excel",
      "application/vnd.oasis.opendocument.spreadsheet");

  final MockCalmLensServerClient.Storage storage = new MockCalmLensServerClient.Storage();
  private final MockCalmLensServerClient.Options options;
  private final String projectId, apiBase, cdnBase;
  private final Map<String, Saved> idempotent = new HashMap<>();
  /** Open multipart uploads by asset ID: their queue choice and declared total size. */
  private final Map<String, JsonObject> uploads = new HashMap<>();
  /** The processing options each asset was uploaded with, which the API keeps but doesn't return. */
  private final Map<String, JsonObject> processingOptions = new HashMap<>();
  /**
   * The decided assets whose re-run ({@code assets.explain} with {@code rerun}) is still queued;
   * they keep their decision until {@link MockCalmLensServerClient#completeProcessing} decides them.
   */
  final Set<String> reruns = new HashSet<>();
  private final Map<String, JsonObject> lenses = new LinkedHashMap<>();
  /** Whether the request being answered created a hash list, hash list entry or policy. */
  private boolean created;
  /** The key's grants once {@link MockCalmLensServerClient#setApiKeyGrants} replaced them, else null. */
  JsonArray grants;

  MockApi(String projectId, String apiBase, String cdnBase, MockCalmLensServerClient.Options options) {
    this.projectId = projectId;
    this.apiBase = apiBase;
    this.cdnBase = cdnBase;
    this.options = options;
  }

  long now() { return options.now.getAsLong(); }

  String createId(String prefix) { return options.createId.apply(prefix); }

  private static final String BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  private static final java.security.SecureRandom RANDOM = new java.security.SecureRandom();

  /** A new ID like the API's: {@code prefix}, {@code _} and 20 random base62 characters. */
  static String newId(String prefix) {
    StringBuilder id = new StringBuilder(prefix).append('_');
    byte[] bytes = new byte[40];
    while (id.length() < prefix.length() + 21) {
      RANDOM.nextBytes(bytes);
      for (byte value : bytes) {
        int unsigned = value & 0xff;
        // Bytes 248-255 are redrawn, so every character is equally likely.
        if (unsigned >= 248) continue;
        id.append(BASE62.charAt(unsigned % 62));
        if (id.length() == prefix.length() + 21) break;
      }
    }
    return id.toString();
  }

  // ------------------------------------------------------------------ Transport

  /** Whether a request is for the CDN rather than the API. */
  boolean isCdn(String url) { return url.split("\\?", 2)[0].startsWith(cdnBase + "/assets/"); }

  /** Every client method that sends a request, by its JavaScript method path, for {@code failNextRequest}. */
  static final Set<String> OPERATIONS = Set.of(
      "assets.list", "assets.iterate", "assets.search", "assets.retrieve", "assets.waitForDecision", "assets.update",
      "assets.listChildren", "assets.iterateChildren", "assets.listTimeline", "assets.iterateTimeline", "assets.create",
      "assets.classify", "assets.uploadPart", "assets.move", "assets.retry", "assets.explain", "assets.decide", "assets.removeContent",
      "assets.delete", "assets.batch", "text.classify", "cdn.serve", "cdn.getAssetInfo", "cdn.signAssetUrl", "events.list", "events.pages",
      "folders.list", "folders.iterate", "folders.retrieve", "folders.create", "folders.update", "folders.delete", "folders.move",
      "hashLists.list", "hashLists.iterate", "hashLists.retrieve", "hashLists.create", "hashLists.update", "hashLists.delete",
      "hashLists.listEntries", "hashLists.iterateEntries", "hashLists.addEntry", "hashLists.removeEntry",
      "policies.list", "policies.iterate", "policies.retrieve", "policies.create", "policies.update", "policies.reset",
      "policies.upgrade", "policies.setAutomaticUpdates", "policies.delete", "policies.retrieveAssigned", "policies.assign",
      "lenses.list", "lenses.iterate", "lenses.create", "lenses.retrieve", "lenses.update", "lenses.delete",
      "ensureLens", "ensureLenses",
      "uploadPresets.list", "uploadPresets.iterate", "uploadPresets.ensure", "uploadPresets.delete",
      "projectSettings.get", "projectSettings.update",
      "metadataFields.list", "metadataFields.ensure", "metadataFields.delete");

  /** A request URL's path after the API or CDN base URL, with its segments decoded. */
  String relativePath(String url) {
    String path = url.split("\\?", 2)[0];
    String base = isCdn(path) ? cdnBase : path.startsWith(apiBase + "/") ? apiBase : null;
    if (base == null) return java.net.URI.create(url).getRawPath();
    return "/" + String.join("/", segments(path.substring(base.length())));
  }

  /**
   * The client operations a request can come from, by their JavaScript method paths, for {@code
   * failNextRequest}. A request answers both a method and the helper that calls it, such as {@code
   * assets.retrieve} and {@code assets.waitForDecision}.
   */
  Set<String> operations(MockCalmLensServerClient.Request request) {
    String url = request.url().split("\\?", 2)[0];
    if (isCdn(url)) {
      List<String> parts = segments(url.substring(cdnBase.length()));
      return parts.size() == 4 && parts.get(3).equals("info") ? Set.of("cdn.getAssetInfo") : Set.of("cdn.serve");
    }
    if (!url.startsWith(apiBase + "/")) return Set.of();
    List<String> parts = segments(url.substring(apiBase.length()));
    String method = request.method();
    if (parts.size() >= 3 && parts.get(0).equals("projects")) {
      String route = method + " " + String.join("/", parts.subList(2, parts.size()));
      if (parts.size() == 5 && parts.get(2).equals("assets") && parts.get(4).equals("timeline") && method.equals("GET"))
        return Set.of("assets.listTimeline", "assets.iterateTimeline");
      if (parts.size() == 4 && parts.get(2).equals("metadata-fields") && method.equals("DELETE"))
        return Set.of("metadataFields.delete");
      return switch (route) {
        case "GET events" -> Set.of("events.list", "events.pages");
        case "PUT lenses" -> Set.of("ensureLens", "ensureLenses");
        case "GET lenses" -> Set.of("lenses.list", "lenses.iterate");
        case "POST lenses" -> Set.of("lenses.create");
        case "GET upload-presets" -> Set.of("uploadPresets.list", "uploadPresets.iterate");
        case "PUT upload-presets" -> Set.of("uploadPresets.ensure");
        case "GET settings" -> Set.of("projectSettings.get");
        case "PUT settings" -> Set.of("projectSettings.update");
        case "GET metadata-fields" -> Set.of("metadataFields.list");
        case "PUT metadata-fields" -> Set.of("metadataFields.ensure");
        case "GET folders" -> Set.of("folders.list", "folders.iterate");
        case "POST folders" -> Set.of("folders.create");
        case "GET hash-lists" -> Set.of("hashLists.list", "hashLists.iterate");
        case "POST hash-lists" -> Set.of("hashLists.create");
        case "GET policy" -> Set.of("policies.retrieveAssigned");
        case "PUT policy" -> Set.of("policies.assign");
        case "GET assets/search" -> Set.of("assets.search");
        case "GET assets" -> Set.of("assets.list", "assets.iterate");
        case "POST assets/batch" -> Set.of("assets.batch");
        case "POST signed-asset-urls" -> Set.of("cdn.signAssetUrl");
        case "POST assets" -> "false".equals(request.query().get("wait")) ? Set.of("assets.create") : Set.of("assets.classify", "text.classify");
        default -> Set.of();
      };
    }
    if (parts.get(0).equals("policies") && parts.size() <= 3) {
      if (parts.size() == 1) return method.equals("GET") ? Set.of("policies.list", "policies.iterate") : Set.of("policies.create");
      return switch (method + " " + (parts.size() == 3 ? parts.get(2) : "")) {
        case "GET " -> Set.of("policies.retrieve");
        case "PATCH " -> Set.of("policies.update");
        case "DELETE " -> Set.of("policies.delete");
        case "POST reset" -> Set.of("policies.reset");
        case "POST upgrade" -> Set.of("policies.upgrade");
        case "PUT automatic-updates" -> Set.of("policies.setAutomaticUpdates");
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
      case "assets DELETE content" -> Set.of("assets.removeContent");
      case "assets POST retry" -> Set.of("assets.retry");
      case "assets POST explain" -> Set.of("assets.explain");
      case "assets POST decision" -> Set.of("assets.decide");
      case "assets POST move" -> Set.of("assets.move");
      case "assets POST part" -> Set.of("assets.uploadPart");
      case "folders GET " -> Set.of("folders.retrieve");
      case "folders PATCH " -> Set.of("folders.update");
      case "folders DELETE " -> Set.of("folders.delete");
      case "folders POST move" -> Set.of("folders.move");
      case "hash-lists GET " -> Set.of("hashLists.retrieve");
      case "hash-lists PATCH " -> Set.of("hashLists.update");
      case "hash-lists DELETE " -> Set.of("hashLists.delete");
      case "hash-lists GET entries" -> Set.of("hashLists.listEntries", "hashLists.iterateEntries");
      case "lenses GET " -> Set.of("lenses.retrieve");
      case "lenses PATCH " -> Set.of("lenses.update");
      case "lenses DELETE " -> Set.of("lenses.delete");
      case "upload-presets DELETE " -> Set.of("uploadPresets.delete");
      case "hash-lists POST entries" -> Set.of("hashLists.addEntry");
      case "hash-list-entries DELETE " -> Set.of("hashLists.removeEntry");
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
    String type = request.header("Content-Type");
    String upload = Objects.requireNonNullElse(request.header("X-CalmLens-Upload"), "");
    boolean create = request.method().equals("POST") && parts.size() == 3 && parts.get(0).equals("projects") && parts.get(2).equals("assets");
    UploadForm.Parsed form = null;
    if (create && !upload.isEmpty() && UploadForm.isForm(type)) {
      try { form = UploadForm.read(Objects.requireNonNullElse(request.body(), new byte[0]), type); }
      catch (IllegalArgumentException invalid) { /* The route refuses it below. */ }
    }
    // Like the API, an upload form is told apart by its options and file, not its boundary.
    String fingerprint = request.method() + " " + request.url() + " "
        + (form != null ? "multipart/form-data " + form.options() + " " + digest(form.file()) : digest(request.body()));
    if (key != null && idempotent.containsKey(key)) {
      Saved saved = idempotent.get(key);
      if (!saved.fingerprint().equals(fingerprint)) return error(new Failure(ErrorCodes.IDEMPOTENCY_KEY_REUSED));
      return respond(saved.status(), "application/json", saved.body(), "Idempotent-Replayed", "true");
    }
    JsonObject body = new JsonObject();
    if (request.body() != null && type != null && type.startsWith("application/json")) {
      JsonElement parsed = JsonParser.parseString(request.bodyText());
      if (parsed.isJsonObject()) body = parsed.getAsJsonObject();
    }
    byte[] raw = request.body();
    JsonElement result;
    created = false;
    try {
      if (create) {
        // Like the API: asset fields belong in the body, and raw content in an upload form.
        List<String> named = UploadForm.OPTION_KEYS.stream().filter(request.query()::containsKey).collect(Collectors.toList());
        if (!named.isEmpty())
          throw new Failure(ErrorCodes.UPLOAD_OPTIONS_IN_QUERY, 400, "Send the asset's name and fields in the request body, not in the query string.", Map.of("fields", named));
        if (!upload.isEmpty()) {
          String media = type == null ? "" : type.split(";", 2)[0].strip();
          if (!UploadForm.isForm(type)) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("contentType", media.isEmpty() ? null : media);
            throw new Failure(ErrorCodes.UNSUPPORTED_CONTENT_TYPE, 415, "Send a raw upload as multipart/form-data: an options part, then a file part.", details);
          }
          UploadForm.Parsed parsed;
          try { parsed = form != null ? form : UploadForm.read(Objects.requireNonNullElse(raw, new byte[0]), type); }
          catch (IllegalArgumentException invalid) { throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, invalid.getMessage()); }
          body = uploadOptions(parsed.options());
          raw = parsed.file();
        }
      }
      result = dispatch(request.method(), parts, query(request.query()), body, raw, upload);
    } catch (Failure failure) {
      // A failed request frees its key, as the API does.
      return error(failure);
    }
    // Like the API: deletes answer 200 with an empty object, a new folder, hash list, hash list
    // entry or policy is 201 Created and a queued batch 202 Accepted.
    byte[] bytes = Json.write(result == null ? new JsonObject() : result).getBytes(StandardCharsets.UTF_8);
    Set<String> operations = operations(request);
    int status = operations.contains("folders.create") || created ? 201 : operations.contains("assets.batch") ? 202 : 200;
    if (key != null) idempotent.put(key, new Saved(fingerprint, status, bytes));
    return respond(status, "application/json", bytes);
  }

  /** An upload form's options, checked like the API's strict schema. */
  private static JsonObject uploadOptions(String text) throws Failure {
    JsonElement parsed;
    try { parsed = JsonParser.parseString(text); } catch (RuntimeException invalid) { parsed = null; }
    if (parsed == null || !parsed.isJsonObject())
      throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "The options part must be a JSON object with the asset's fields");
    JsonObject options = parsed.getAsJsonObject();
    for (String key : options.keySet())
      if (!UploadForm.OPTION_KEYS.contains(key)) throw Failure.validation(ErrorCodes.UNKNOWN_FIELD, key);
    if (!(options.get("name") instanceof JsonPrimitive name) || !name.isString()) throw Failure.validation("validation/invalid-type", "name");
    return options;
  }

  private static IOException unsupported(String method, String path) {
    return new IOException("MockCalmLensServerClient does not emulate " + method + " " + path + "; enqueue a response for it");
  }

  private static Transport.Response respond(int status, String contentType, byte[] body, String... extra) {
    return respond(MockCalmLensServerClient.requestId(), status, contentType, body, extra);
  }

  private static Transport.Response respond(String requestId, int status, String contentType, byte[] body, String... extra) {
    Map<String, List<String>> headers = new LinkedHashMap<>();
    headers.put("X-Request-Id", List.of(requestId));
    if (contentType != null) headers.put("Content-Type", List.of(contentType));
    headers.put("Content-Length", List.of(String.valueOf(body.length)));
    for (int i = 0; i < extra.length; i += 2) headers.put(extra[i], List.of(extra[i + 1]));
    return new Transport.Response(status, headers, body);
  }

  /** The API's error body, {@code {code, message, requestId, details}}, with {@code requestId} as in the header. */
  static Transport.Response error(Failure failure) {
    String requestId = MockCalmLensServerClient.requestId();
    JsonObject body = new JsonObject();
    body.addProperty("code", failure.code);
    body.addProperty("message", failure.getMessage());
    body.addProperty("requestId", requestId);
    body.add("details", failure.details == null ? new JsonObject() : Json.WRITE.toJsonTree(failure.details));
    return respond(requestId, failure.status, "application/json", Json.write(body).getBytes(StandardCharsets.UTF_8));
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

  /** Decodes query values: numbers and booleans. */
  private static JsonObject query(Map<String, String> raw) {
    JsonObject query = new JsonObject();
    raw.forEach((key, value) -> {
      if (INT_QUERY.contains(key) && value.matches("-?\\d{1,18}")) query.addProperty(key, Long.parseLong(value));
      else if (BOOL_QUERY.contains(key) && (value.equals("true") || value.equals("false"))) query.addProperty(key, value.equals("true"));
      else query.addProperty(key, value);
    });
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

  /** Whether {@code object[key]} is {@code false}, as a query's {@code wait=false} reads. */
  private static boolean isFalse(JsonObject object, String key) {
    JsonElement value = object.get(key);
    return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() && !value.getAsBoolean();
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

  /**
   * Refuses {@code metadata} the API's schema refuses: it is null or a list of {@code {id, value}}
   * objects with a string {@code id} and any JSON {@code value}.
   */
  private static void checkMetadata(JsonElement metadata) throws Failure {
    if (metadata == null || metadata.isJsonNull()) return;
    if (!metadata.isJsonArray()) throw Failure.validation("validation/invalid-type", "metadata");
    JsonArray items = metadata.getAsJsonArray();
    for (int index = 0; index < items.size(); index++) {
      JsonElement item = items.get(index);
      if (!item.isJsonObject()) throw Failure.validation("validation/invalid-type", "metadata." + index);
      JsonElement id = item.getAsJsonObject().get("id");
      if (id == null || !id.isJsonPrimitive() || !id.getAsJsonPrimitive().isString()) throw Failure.validation("validation/invalid-type", "metadata." + index + ".id");
      if (!item.getAsJsonObject().has("value")) throw Failure.validation("validation/invalid-value", "metadata." + index + ".value");
    }
  }

  // ------------------------------------------------------------------ Routes

  private JsonElement dispatch(String method, List<String> parts, JsonObject q, JsonObject body, byte[] raw, String upload)
      throws Failure, IOException {
    long now = now();
    if (parts.size() >= 3 && parts.get(0).equals("projects")) {
      if (!parts.get(1).equals(projectId)) throw new Failure(ErrorCodes.API_KEY_PROJECT_MISMATCH);
      switch (method + " " + String.join("/", parts.subList(2, parts.size()))) {
        case "GET events": return events(q);
        case "PUT lenses": return putLenses(body);
        case "GET lenses": return page(new ArrayList<>(lenses.values()), q, Json.write(new JsonPrimitive(projectId + "/lenses")), null);
        case "POST lenses": return createLens(body);
        case "GET upload-presets": return page(new ArrayList<>(configuredPresets.values()), q, Json.write(new JsonPrimitive(projectId + "/upload-presets")), clause("createdAt", "asc"));
        case "PUT upload-presets": return ensureUploadPresets(body, now);
        case "GET settings": return toProjectSettings();
        case "PUT settings": return updateProjectSettings(body);
        case "GET metadata-fields": return toMetadataFields();
        case "PUT metadata-fields": return ensureMetadataFields(body);
        case "GET folders": return listFolders(q);
        case "POST folders": return createFolder(body, now);
        case "GET hash-lists": return page(projectHashLists(), q, Json.write(new JsonPrimitive(projectId + "/hash-lists")), null);
        case "POST hash-lists": return createHashList(body, now);
        case "GET policy": return toPolicy(policy(ensurePolicies()));
        case "PUT policy": return assignPolicy(body);
        case "GET assets/search": return search(q);
        case "GET assets": {
          String filter = str(q, "filter");
          // Like the API, the query is validated before the filter is read.
          bounded(q, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
          sort(q, List.of("createdAt", "id"), 2);
          List<JsonObject> items = projectAssets();
          if (filter != null && !filter.isBlank()) items = items.stream().filter(rsql(filter)).collect(Collectors.toList());
          JsonArray scope = new JsonArray();
          scope.add(projectId);
          scope.add(nullable(filter));
          return page(items, q, Json.write(scope), null);
        }
        case "POST assets": return createAsset(upload, q, body, raw, now);
        case "POST assets/batch": return batch(body, now);
        case "POST signed-asset-urls": return signAssetUrl(body, now);
        default: break;
      }
      if (parts.size() == 5 && parts.get(2).equals("assets") && parts.get(4).equals("timeline") && method.equals("GET"))
        return timeline(asset(parts.get(3)), q);
      if (parts.size() == 4 && parts.get(2).equals("metadata-fields") && method.equals("DELETE"))
        return deleteMetadataField(parts.get(3), q);
    } else if (parts.get(0).equals("policies") && parts.size() == 1) {
      if (method.equals("GET")) return listPolicies(q);
      if (method.equals("POST")) return createPolicy(body, now);
    } else if (parts.size() == 2 || parts.size() == 3) {
      String suffix = parts.size() == 3 ? parts.get(2) : "";
      if (parts.get(0).equals("assets")) return assetRoute(method, parts.get(1), suffix, q, body, raw, now);
      if (parts.get(0).equals("folders")) return folderRoute(method, parts.get(1), suffix, body, now);
      if (parts.get(0).equals("hash-lists")) return hashListRoute(method, parts.get(1), suffix, q, body, now);
      if (parts.get(0).equals("policies")) return policyRoute(method, parts.get(1), suffix, body, now);
      if (parts.get(0).equals("lenses") && parts.size() == 2) return lensRoute(method, parts.get(1), body);
      if (parts.get(0).equals("upload-presets") && parts.size() == 2 && method.equals("DELETE")) return deleteUploadPreset(parts.get(1));
      if (parts.get(0).equals("hash-list-entries") && parts.size() == 2 && method.equals("DELETE")) {
        JsonObject entry = storage.hashListEntries.get(parts.get(1));
        if (entry == null || !projectId.equals(str(entry, "projectId"))) throw new Failure(ErrorCodes.HASH_LIST_ENTRY_NOT_FOUND, "Hash list entry not found");
        storage.hashListEntries.remove(parts.get(1));
        return null;
      }
    }
    throw unsupported(method, "/" + String.join("/", parts));
  }

  /** Who decides through the mock: its API key, which has no ID. */
  static JsonObject mockApiKeyDecider() {
    JsonObject decidedBy = new JsonObject();
    decidedBy.addProperty("type", "api-key");
    decidedBy.add("id", JsonNull.INSTANCE);
    return decidedBy;
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

  /** Like the API: image uploads in parts total at most 20 MiB, at any size below that. */
  private static String imageSizeError(String type, long size, boolean last) {
    return type.equals("image") && size > MAX_IMAGE_BYTES ? ErrorCodes.UPLOAD_TOO_LARGE : null;
  }

  /** Like the API: the parts may not overshoot a declared total, and must reach it at the end. */
  private static String totalSizeError(Long total, long received, boolean last) {
    return total != null && (received > total || last && received != total) ? ErrorCodes.UPLOAD_SIZE_MISMATCH : null;
  }

  /** Throws a size error code, with the limit {@code upload/too-large} carries. */
  private static void check(String code) throws Failure {
    if (code == null) return;
    if (code.equals(ErrorCodes.UPLOAD_TOO_LARGE)) throw Failure.of(code, Map.of("limitBytes", MAX_IMAGE_BYTES, "source", "plan"));
    throw new Failure(code);
  }

  private JsonObject createAsset(String upload, JsonObject q, JsonObject body, byte[] raw, long now) throws Failure {
    // X-CalmLens-Upload picks the mode: absent is a JSON body (plain text or a URL), "content" an
    // upload form with the content and "part" one with the first part of a multipart upload. The
    // asset's fields come from the JSON body or the form's options; the form's transport values
    // (type, part number, final flag, declared total) from the query.
    boolean form = upload.equals("content") || upload.equals("part");
    JsonObject o = body;
    JsonObject t = q;
    boolean multipart = upload.equals("part");
    if (!form && (o.has("content") || o.has("part"))) {
      String field = o.has("content") ? "content" : "part";
      if (!(o.get(field) instanceof JsonObject text) || str(text, "plainText") == null || str(text, "type") == null)
        throw Failure.validation("validation/invalid-type", field);
      multipart = field.equals("part");
      raw = text.get("plainText").getAsString().getBytes(StandardCharsets.UTF_8);
      t = new JsonObject();
      t.addProperty("contentType", str(text, "type"));
      if (multipart) {
        t.addProperty("isFinal", bool(text, "isFinal"));
        if (o.has("totalSizeInBytes") && !o.get("totalSizeInBytes").isJsonNull()) t.add("totalSizeInBytes", o.get("totalSizeInBytes"));
      }
    }
    boolean rawUpload = form || t != q;
    checkMetadata(o.get("metadata"));
    String mime = rawUpload ? Objects.requireNonNullElse(str(t, "contentType"), "") : "";
    // Like the API: content and a first part must have a type it can moderate; a URL is exempt.
    if (rawUpload && !CalmLensServerClient.isAcceptedUploadMimeType(mime))
      throw new Failure(ErrorCodes.UNSUPPORTED_UPLOAD_TYPE, 415, CalmLensServerClient.rejectedUploadMimeTypeMessage(mime), Map.of("mimeType", mime, "source", "calmlens"));
    long size = raw == null ? 0 : raw.length;
    if (str(o, "uploadPresetId") != null) {
      JsonElement declaredTotal = t.get("totalSizeInBytes");
      Long presetSize = !rawUpload ? null : multipart && declaredTotal != null ? Long.valueOf(declaredTotal.getAsLong()) : Long.valueOf(size);
      o = withUploadPreset(o, rawUpload ? mime : null, presetSize);
    }
    String url = rawUpload ? null : str(o, "url");
    String kind = url != null ? "website" : assetType(mime.toLowerCase(Locale.ROOT));
    // wait=false queues the upload; the SDKs send wait=true to wait for the decision.
    boolean queue = isFalse(q, "wait"), last = !multipart || bool(t, "isFinal");
    if (multipart) {
      // In the API's order: a declared total first, then a single final part as the whole upload,
      // then the part itself (5 MiB unless it is the last).
      Long total = t.has("totalSizeInBytes") ? t.get("totalSizeInBytes").getAsLong() : null;
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
    String id = createId("asset");
    asset.addProperty("id", id);
    asset.addProperty("projectId", projectId);
    asset.add("parentId", JsonNull.INSTANCE);
    asset.add("parentPages", new JsonArray());
    asset.add("folderId", nullable(str(o, "folderId")));
    asset.add("uploadPresetId", nullable(str(o, "uploadPresetId")));
    asset.addProperty("createdAt", now);
    asset.addProperty("updatedAt", now);
    asset.add("name", nullable(str(o, "name")));
    asset.add("description", nullable(str(o, "description")));
    asset.add("externalId", nullable(externalId));
    asset.add("externalUrl", nullable(url != null ? url : str(o, "externalUrl")));
    asset.add("authorId", nullable(str(o, "authorId")));
    // Like the API, only the posts CalmLens uses are kept, and only while the content is held.
    asset.add("context", usedContext(o.get("context")));
    asset.addProperty("type", kind);
    asset.add("metadata", o.has("metadata") && !o.get("metadata").isJsonNull() ? o.get("metadata").deepCopy() : new JsonArray());
    asset.add("tags", o.has("tags") && !o.get("tags").isJsonNull() ? o.get("tags").deepCopy() : new JsonArray());
    processingOptions.put(id, processing.getAsJsonObject().deepCopy());
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
    // The mock decodes nothing, so the file's own details are unknown.
    for (String unknown : List.of("width", "height", "durationSeconds", "pageCount", "perceptualHash", "perceptualHashQuality", "metadata"))
      content.add(unknown, JsonNull.INSTANCE);
    content.add("extractedText", JsonNull.INSTANCE);
    // Like the API, the rendered file and preview come with processing.
    withoutRendering(content);
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
    // Like the API, the decision's fields are null until moderation decides.
    for (String undecided : List.of("automatedStatus", "policy", "pendingReview", "source", "rule", "explanationComplete", "categories"))
      moderation.add(undecided, JsonNull.INSTANCE);
    moderation.add("flaggedCategories", new JsonArray());
    moderation.add("regions", new JsonArray());
    moderation.add("raw", JsonNull.INSTANCE);
    moderation.add("timeline", JsonNull.INSTANCE);
    JsonObject classification = new JsonObject();
    classification.addProperty("status", last ? "processing" : "queued");
    classification.add("failureReason", JsonNull.INSTANCE);
    // The mock never analyses media in sections.
    classification.add("progress", JsonNull.INSTANCE);
    classification.addProperty("updatedAt", now);
    classification.add("completedAt", JsonNull.INSTANCE);
    // The mock never reads test inputs.
    classification.addProperty("testInput", false);
    classification.add("moderation", moderation);
    // Like the API, a feature's result is null until it has run.
    classification.add("ocr", JsonNull.INSTANCE);
    classification.add("linkDetection", JsonNull.INSTANCE);
    asset.add("classification", classification);

    if (rawUpload && raw != null) {
      TreeMap<Integer, byte[]> parts = new TreeMap<>();
      parts.put(1, raw.clone());
      storage.content.put(id, new MockCalmLensServerClient.StoredContent(mime, parts));
    }
    if (!last) {
      JsonObject open = new JsonObject();
      open.addProperty("queue", queue);
      if (t.has("totalSizeInBytes")) open.add("total", t.get("totalSizeInBytes"));
      uploads.put(id, open);
      storage.assets.put(id, asset);
      return asset;
    }
    applyRendering(asset, false);
    MockDecision decision;
    try {
      decision = decisionFor(asset, MockCalmLensServerClient.Trigger.UPLOAD, queue);
    } catch (RuntimeException failed) {
      storage.content.remove(id);
      throw failed;
    }
    storage.assets.put(id, asset);
    finishUpload(asset, decision);
    return asset;
  }

  /**
   * An API-key upload through a preset, as the API applies it: the preset gives the folder and
   * visibility, which the upload can't change, and the processing options unless the upload sets
   * its own, and refuses types and sizes it doesn't accept.
   *
   * @param contentType the upload's type, or null for a URL
   * @param size the upload's size, or null for a URL
   * @return the upload's fields with the preset's applied
   */
  private JsonObject withUploadPreset(JsonObject fields, String contentType, Long size) throws Failure {
    String presetId = str(fields, "uploadPresetId");
    JsonObject preset = configuredPresets.values().stream().filter(p -> presetId.equals(str(p, "id"))).findFirst()
        .orElseThrow(() -> new Failure(ErrorCodes.UPLOAD_PRESET_NOT_FOUND, "Upload preset not found"));
    if (!bool(preset, "enabled")) throw new Failure(ErrorCodes.UPLOAD_PRESET_DISABLED);
    String presetFolder = str(preset, "folderId"), folder = str(fields, "folderId");
    if (presetFolder != null && folder != null && !folder.equals(presetFolder))
      throw Failure.of(ErrorCodes.UPLOAD_PRESET_FIELD_NOT_ALLOWED, Map.of("field", "folderId"));
    String visibility = str(fields, "visibility");
    if (visibility != null && !visibility.equals(str(preset, "visibility")))
      throw Failure.of(ErrorCodes.UPLOAD_PRESET_FIELD_NOT_ALLOWED, Map.of("field", "visibility"));
    if (contentType != null && preset.get("allowedContentTypes").isJsonArray()) {
      List<String> allowed = new ArrayList<>();
      preset.getAsJsonArray("allowedContentTypes").forEach(type -> allowed.add(type.getAsString()));
      if (!isFileAccepted(str(fields, "name"), contentType, allowed))
        throw Failure.of(ErrorCodes.UNSUPPORTED_UPLOAD_TYPE, Map.of("source", "preset", "contentType", contentType, "allowedContentTypes", allowed));
    }
    if (size != null && !preset.get("maxSizeInBytes").isJsonNull() && preset.get("maxSizeInBytes").getAsLong() > 0 && size > preset.get("maxSizeInBytes").getAsLong())
      throw Failure.of(ErrorCodes.UPLOAD_TOO_LARGE, Map.of("limitBytes", preset.get("maxSizeInBytes").getAsLong(), "source", "preset"));
    JsonObject applied = fields.deepCopy();
    if (presetFolder != null) applied.addProperty("folderId", presetFolder);
    applied.add("visibility", preset.get("visibility").deepCopy());
    if ((!fields.has("processingOptions") || fields.get("processingOptions").isJsonNull()) && !preset.get("processingOptions").isJsonNull())
      applied.add("processingOptions", preset.get("processingOptions").deepCopy());
    return applied;
  }

  /** Whether a preset's accepted types take a file: {@code *}, {@code image/*}, {@code .png} or an exact type. */
  private static boolean isFileAccepted(String name, String contentType, List<String> patterns) {
    String type = contentType.toLowerCase(Locale.ROOT), file = name == null ? "" : name.toLowerCase(Locale.ROOT);
    return patterns.stream().map(pattern -> pattern.trim().toLowerCase(Locale.ROOT)).anyMatch(pattern ->
        pattern.equals("*") || pattern.equals("*/*")
            || (pattern.endsWith("/*") ? type.startsWith(pattern.substring(0, pattern.length() - 1))
            : pattern.startsWith(".") ? file.endsWith(pattern) : type.equals(pattern)));
  }

  /**
   * Records {@code asset.uploaded} for a completed upload, with the asset before moderation, then
   * settles it with {@code decision}.
   */
  private void finishUpload(JsonObject asset, MockDecision decision) {
    JsonObject uploaded = asset.deepCopy();
    if (decision.status() != MockCalmLensServerClient.Outcome.PENDING) decided(asset, decision);
    // UploadAssetUtils.ts records the upload before the pipeline's events.
    recordEvent("asset.uploaded", "low", API_KEY_ACTOR, uploaded, java.util.Arrays.asList(
        new Models.EventFact("asset-type", str(uploaded, "type"), null), assetNameFact(uploaded),
        new Models.EventFact("file-format", str(uploaded.getAsJsonObject("content"), "format"), null)));
    recordProcessingEvents(asset, decision);
  }

  /** An asset's portal link, as event facts carry it. */
  private static Models.EventFact assetNameFact(JsonObject asset) {
    return new Models.EventFact("asset-name", str(asset, "name"), "https://calmlens.com/go/asset/" + str(asset, "id"));
  }

  /**
   * Asks {@code moderate} how to decide a processing asset, with its stored content (none once
   * the content is removed).
   */
  private MockDecision decisionFor(JsonObject asset, MockCalmLensServerClient.Trigger trigger, boolean queued) {
    MockCalmLensServerClient.StoredContent stored = "removed".equals(str(asset.getAsJsonObject("content"), "status")) ? null : storage.content.get(str(asset, "id"));
    byte[] bytes = stored == null ? null : stored.bytes();
    String text = bytes != null && "plaintext-document".equals(str(asset, "type")) ? new String(bytes, StandardCharsets.UTF_8) : null;
    Models.Asset copy = Json.GSON.fromJson(asset, Models.Asset.class);
    return options.decide(new MockCalmLensServerClient.ModerationInput(copy, new MockCalmLensServerClient.Content(bytes, text), trigger, queued));
  }

  /**
   * Applies a decided or failed {@code decision} and its report. The mock reads no text, QR codes,
   * people or faces in an image, so like the API for an image without them, a decided image
   * reports empty results for OCR, person and face detection when its upload turned them on, and
   * for link detection unless its upload turned it off.
   */
  private void decided(JsonObject asset, MockDecision decision) {
    long now = now();
    applyOutcome(asset, decision.status(), "policy", now, decision.report(now));
    JsonObject classification = asset.getAsJsonObject("classification");
    if (!"completed".equals(str(classification, "status")) || !"image".equals(str(asset, "type"))) return;
    if (feature(asset, "ocr") == Boolean.TRUE) classification.add("ocr", evaluated("textRegions"));
    if (feature(asset, "linkDetection") != Boolean.FALSE) {
      JsonObject links = evaluated("qrCodes");
      links.add("links", new JsonArray());
      classification.add("linkDetection", links);
    }
    if (feature(asset, "personDetection") == Boolean.TRUE) classification.add("personDetection", evaluated("people"));
    if (feature(asset, "faceDetection") == Boolean.TRUE) classification.add("faceDetection", evaluated("faces"));
  }

  /** The asset's {@code processingOptions.features.<feature>.enabled} as uploaded, or null when it wasn't set. */
  private Boolean feature(JsonObject asset, String feature) {
    JsonObject uploaded = processingOptions.get(str(asset, "id"));
    JsonElement enabled = uploaded == null ? null : path(uploaded, "features." + feature + ".enabled");
    return enabled != null && enabled.isJsonPrimitive() && enabled.getAsJsonPrimitive().isBoolean() ? enabled.getAsBoolean() : null;
  }

  /** An evaluated detection result that found nothing. */
  private static JsonObject evaluated(String list) {
    JsonObject result = new JsonObject();
    result.addProperty("status", "evaluated");
    result.add(list, new JsonArray());
    return result;
  }

  /**
   * Asks {@code moderate} (unless {@code decision} is given) and settles a processing asset with
   * its events; a {@code pending} decision leaves it processing.
   */
  void moderateStored(JsonObject asset, MockCalmLensServerClient.Trigger trigger, MockDecision decision) {
    MockDecision settled = decision != null ? decision : decisionFor(asset, trigger, true);
    if (settled.status() == MockCalmLensServerClient.Outcome.PENDING) return;
    decided(asset, settled);
    recordProcessingEvents(asset, settled);
  }

  /**
   * Asks {@code moderate} (unless {@code decision} is given) for a re-run's decision on a decided
   * asset and applies it like the pipeline: a {@code pending} decision stays queued for {@link
   * MockCalmLensServerClient#completeProcessing}, a {@code failed} one keeps the asset's decision,
   * and any other replaces it with the pipeline's events.
   */
  void settleRerun(JsonObject asset, MockCalmLensServerClient.Trigger trigger, MockDecision decision) {
    MockDecision settled = decision != null ? decision : decisionFor(asset, trigger, true);
    String id = str(asset, "id");
    reruns.remove(id);
    switch (settled.status()) {
      case PENDING -> reruns.add(id);
      case FAILED -> { }
      default -> moderateStored(asset, trigger, settled);
    }
  }

  /**
   * The events the pipeline records when it settles an asset (AssetClassification.ts and
   * AssetErrorAlert.ts): {@code asset.classified} and the automated {@code asset.<status>}, or
   * {@code asset.failed}.
   */
  private void recordProcessingEvents(JsonObject asset, MockDecision decision) {
    MockCalmLensServerClient.Outcome status = decision.status();
    if (status == MockCalmLensServerClient.Outcome.PENDING) return;
    String type = str(asset, "type");
    if (status == MockCalmLensServerClient.Outcome.FAILED) {
      String reason = str(asset.getAsJsonObject("classification"), "failureReason");
      recordEvent("asset.failed", "high", AUTOMATED_ACTOR, asset, List.of(assetNameFact(asset), new Models.EventFact("asset-type", type, null),
          new Models.EventFact("previous-status", "processing", null), new Models.EventFact("failure-reason", reason == null ? "processing-error" : reason, null)));
      return;
    }
    List<String> flagged = decision.flaggedCategories();
    recordEvent("asset.classified", "low", AUTOMATED_ACTOR, asset, List.of(new Models.EventFact("flagged-categories", flagged, null),
        new Models.EventFact("moderation-status", status.value(), null), new Models.EventFact("asset-type", type, null), assetNameFact(asset)));
    // Like the event catalog: only allowing and limiting are low severity.
    recordEvent("asset." + status.value(), status == MockCalmLensServerClient.Outcome.ALLOWED || status == MockCalmLensServerClient.Outcome.LIMITED ? "low" : "high",
        AUTOMATED_ACTOR, asset, List.of(new Models.EventFact("flagged-categories", flagged, null),
            new Models.EventFact("asset-type", type, null), assetNameFact(asset)));
  }

  /** The earlier posts CalmLens uses from a request's {@code context}, or null when there are none. */
  private static JsonElement usedContext(JsonElement context) throws Failure {
    if (context == null || context.isJsonNull()) return JsonNull.INSTANCE;
    Models.ModerationContext parsed;
    try {
      parsed = Json.GSON.fromJson(context, Models.ModerationContext.class);
    } catch (RuntimeException invalid) {
      throw Failure.validation("validation/invalid-type", "context");
    }
    if (parsed == null || parsed.items() == null || parsed.items().stream().anyMatch(item -> item == null || item.text() == null))
      throw Failure.validation("validation/invalid-type", "context.items");
    List<Models.ModerationContextItem> items = Models.selectModerationContextItems(parsed.items());
    return items.isEmpty() ? JsonNull.INSTANCE : Json.GSON.toJsonTree(new Models.ModerationContext(items));
  }

  /**
   * Moves an asset to an outcome like the pipeline: a decision finishes processing, {@code purged}
   * removes the content (with {@code purgeReason}, {@code policy} for the pipeline), and finished
   * processing removes content held only temporarily. A decided asset gets its rendered file and
   * preview (with a ThumbHash for its placeholder), which go with its content.
   */
  void applyOutcome(JsonObject asset, MockCalmLensServerClient.Outcome outcome, String purgeReason, long now, JsonObject report) {
    boolean decided = outcome != MockCalmLensServerClient.Outcome.PENDING && outcome != MockCalmLensServerClient.Outcome.FAILED;
    JsonObject content = asset.getAsJsonObject("content");
    String contentStatus = str(content, "status");
    boolean purge = outcome == MockCalmLensServerClient.Outcome.PURGED && !"removed".equals(contentStatus);
    boolean remove = purge || decided && "temporary".equals(contentStatus);
    if (remove) {
      storage.content.remove(str(asset, "id"));
      content.addProperty("status", "removed");
      content.addProperty("removalReason", purge ? purgeReason : "retention");
      asset.add("context", JsonNull.INSTANCE);
      content.addProperty("updatedAt", now);
      content.add("extractedText", JsonNull.INSTANCE);
      content.add("metadata", JsonNull.INSTANCE);
      withoutRendering(content);
    } else if (!"removed".equals(contentStatus) && !purge && !held(asset)) {
      // Like the API, an asset whose content is held has its rendered file and preview, completed
      // by its decision; removing content removes them with it, so no placeholder outlives the
      // content, and a safety hold withholds them.
      applyRendering(asset, decided);
    } else {
      withoutRendering(content);
    }
    JsonObject classification = asset.getAsJsonObject("classification");
    classification.addProperty("status", decided ? "completed" : outcome == MockCalmLensServerClient.Outcome.FAILED ? "failed" : "processing");
    // Like the API, a failure carries its reason; the mock never decodes content, so it fails processing.
    classification.add("failureReason", outcome == MockCalmLensServerClient.Outcome.FAILED ? new JsonPrimitive("processing-error") : JsonNull.INSTANCE);
    classification.addProperty("updatedAt", now);
    classification.add("completedAt", decided ? new JsonPrimitive(now) : JsonNull.INSTANCE);
    JsonObject moderation = classification.getAsJsonObject("moderation");
    moderation.addProperty("status", decided ? outcome.value() : "pending");
    if (report != null) report.entrySet().forEach(entry -> moderation.add(entry.getKey(), entry.getValue().deepCopy()));
    asset.getAsJsonObject("upload").addProperty("status", "completed");
    asset.getAsJsonObject("upload").addProperty("updatedAt", now);
    asset.addProperty("updatedAt", now);
  }

  /** Whether a safety hold is on the asset. */
  private static boolean held(JsonObject asset) {
    JsonElement hold = asset.getAsJsonObject("content").get("safetyHold");
    return hold != null && !hold.isJsonNull();
  }

  /**
   * Removing or withholding content removes its rendered file, HLS stream and preview, as the API
   * does. The mock never prepares an HLS stream.
   */
  private static void withoutRendering(JsonObject content) {
    content.add("rendered", JsonNull.INSTANCE);
    content.add("hls", JsonNull.INSTANCE);
    content.add("hlsStatus", JsonNull.INSTANCE);
    content.add("preview", JsonNull.INSTANCE);
  }

  /** A preview of the given size, with the mock ThumbHash and average colour once processed. */
  private static JsonObject mockPreview(Integer width, Integer height, boolean processed) {
    JsonObject preview = new JsonObject();
    preview.add("width", width == null ? JsonNull.INSTANCE : new JsonPrimitive(width));
    preview.add("height", height == null ? JsonNull.INSTANCE : new JsonPrimitive(height));
    preview.add("thumbhash", processed ? new JsonPrimitive(MOCK_THUMBHASH) : JsonNull.INSTANCE);
    preview.add("averageColor", processed ? new JsonPrimitive("#7f7f7f") : JsonNull.INSTANCE);
    return preview;
  }

  /** A rendered file of unknown size. */
  private static JsonObject mockRendered(String kind, String format) {
    JsonObject rendered = new JsonObject();
    rendered.addProperty("kind", kind);
    rendered.addProperty("format", format);
    rendered.add("width", JsonNull.INSTANCE);
    rendered.add("height", JsonNull.INSTANCE);
    return rendered;
  }

  /**
   * Sets the rendered file and preview the API reports for an asset with its content held. Once
   * uploaded, an image renders as itself with a preview that has no ThumbHash yet, and a PDF and
   * browser-safe audio and video render as uploaded. Once processed, a website renders as its
   * screenshot; a document or presentation as a PDF, with its first page as the preview; video and
   * audio as a browser-safe file (MP4 or M4A unless browsers play the upload), audio with a
   * waveform preview and video with no poster; and every preview has its ThumbHash. Text,
   * spreadsheets and other files have neither. The mock decodes nothing, so sizes are unknown,
   * audio has no peaks, and audio and video never get an HLS stream.
   */
  private static void applyRendering(JsonObject asset, boolean processed) {
    JsonObject content = asset.getAsJsonObject("content");
    content.add("hls", JsonNull.INSTANCE);
    content.add("hlsStatus", JsonNull.INSTANCE);
    String type = str(asset, "type"), format = str(content, "format");
    String mime = format == null ? "" : format.toLowerCase(Locale.ROOT).split(";", 2)[0].strip();
    boolean browserSafe = BROWSER_SAFE_MEDIA_FORMATS.contains(mime);
    boolean rendersOnUpload = "image".equals(type) || mime.equals("application/pdf")
        || ("video".equals(type) || "audio".equals(type)) && browserSafe;
    withoutRendering(content);
    if (!processed && !rendersOnUpload) return;
    switch (type) {
      case "image" -> {
        content.add("rendered", mockRendered("image", format == null ? "image/png" : format));
        content.add("preview", mockPreview(null, null, processed));
      }
      case "website" -> {
        content.add("rendered", mockRendered("image", "image/png"));
        content.add("preview", mockPreview(null, null, processed));
      }
      case "multimedia-document" -> {
        if (SPREADSHEET_MIME_TYPES.contains(mime)) return;
        content.add("rendered", mockRendered("pdf", "application/pdf"));
        if (processed) content.add("preview", mockPreview(null, null, true));
      }
      case "video" -> content.add("rendered", mockRendered("video", browserSafe ? format : "video/mp4"));
      case "audio" -> {
        JsonObject rendered = mockRendered("audio", browserSafe ? format : "audio/mp4");
        if (processed) rendered.add("peaks", new JsonArray());
        content.add("rendered", rendered);
        if (processed) content.add("preview", mockPreview(WAVEFORM_WIDTH, WAVEFORM_HEIGHT, true));
      }
      default -> {}
    }
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
    if (number != expected || number > MAX_UPLOAD_PARTS) {
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
      // wait=false queues the final part; without wait, the upload's saved choice applies.
      boolean queue = q.has("wait") ? isFalse(q, "wait") : bool(open, "queue");
      uploads.remove(id);
      applyOutcome(asset, MockCalmLensServerClient.Outcome.PENDING, "policy", now(), null);
      finishUpload(asset, decisionFor(asset, MockCalmLensServerClient.Trigger.UPLOAD, queue));
    }
  }

  /**
   * The events {@code asset.deleted}, {@code asset.content-removed} and {@code asset.retried} the
   * API records for {@code actor}, with the {@code batch-id} fact when a batch caused them.
   */
  private void lifecycle(String type, JsonObject asset, JsonObject actor, String batchId) {
    List<Models.EventFact> facts = new ArrayList<>(List.of(
        // A deleted asset has no portal page to link to.
        new Models.EventFact("asset-name", str(asset, "name"), type.equals("asset.deleted") ? null : "https://calmlens.com/go/asset/" + str(asset, "id")),
        new Models.EventFact("asset-type", str(asset, "type"), null)));
    if (batchId != null) facts.add(new Models.EventFact("batch-id", batchId, null));
    recordEvent(type, "low", actor, asset, facts);
  }

  /** The actor of events the mock's API key causes: mock keys have no ID. */
  static final JsonObject API_KEY_ACTOR = actor("api-key");
  /** The actor of a reviewer's decision through {@link MockCalmLensServerClient#decide}. */
  static final JsonObject USER_ACTOR = actor("user");
  /** The actor of the moderation pipeline's events. */
  static final JsonObject AUTOMATED_ACTOR = actor("automated");

  private static JsonObject actor(String type) {
    JsonObject actor = new JsonObject();
    actor.addProperty("type", type);
    actor.add("id", JsonNull.INSTANCE);
    return actor;
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

  /** Each asset's latest event {@code assetSequence}, which the API keeps on the asset. */
  private final Map<String, Long> assetSequences = new HashMap<>();

  /** The {@code assetSequence} of the next event about an asset, like the API: 1 for its first event, then one more for each later one. */
  long nextAssetSequence(String assetId) {
    return assetSequences.merge(assetId, 1L, Long::sum);
  }

  /** Adds an event that {@code actor} caused to the feed, with a snapshot of {@code asset} when there is one. */
  JsonObject recordEvent(String type, String severity, JsonObject actor, JsonObject asset, List<Models.EventFact> facts) {
    long now = now();
    JsonObject event = new JsonObject();
    event.addProperty("id", createId("evt"));
    event.addProperty("projectId", projectId);
    event.add("actor", actor.deepCopy());
    event.addProperty("type", type);
    event.addProperty("severity", severity);
    event.addProperty("title", type);
    event.add("description", JsonNull.INSTANCE);
    event.add("assetId", asset == null ? JsonNull.INSTANCE : asset.get("id"));
    event.add("assetSequence", asset == null ? JsonNull.INSTANCE : new JsonPrimitive(nextAssetSequence(asset.get("id").getAsString())));
    event.add("asset", asset == null ? JsonNull.INSTANCE : snapshot(asset));
    event.add("facts", facts(facts));
    event.addProperty("createdAt", now);
    storage.events.add(event);
    return event;
  }

  /** An asset ID as the API's schema accepts it: {@code asset_} and 20 base62 characters. */
  private static final java.util.regex.Pattern ASSET_ID_PATTERN = java.util.regex.Pattern.compile("^asset_[0-9A-Za-z]{20}$");

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
      if (!ASSET_ID_PATTERN.matcher(id.getAsString()).matches()) throw Failure.validation("validation/invalid-format", "assetIds." + index);
      unique.add(id.getAsString());
    }
    String operation = str(body, "operation");
    if (!"delete".equals(operation) && !"remove-content".equals(operation)) throw Failure.validation("validation/invalid-value", "operation");
    List<JsonObject> assets = new ArrayList<>();
    for (String id : unique) assets.add(asset(id));
    String batchId = createId("batch");
    for (JsonObject asset : assets) {
      if (operation.equals("delete")) {
        deleteAssetTree(str(asset, "id"));
        lifecycle("asset.deleted", asset, API_KEY_ACTOR, batchId);
      } else {
        removeContent(asset, now, API_KEY_ACTOR, batchId);
      }
    }
    JsonObject queued = new JsonObject();
    queued.addProperty("batchId", batchId);
    queued.addProperty("status", "queued");
    queued.addProperty("assetCount", assets.size());
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
   * asset.content-removed event is recorded for {@code actor} either way, with the {@code
   * batch-id} fact when a batch removed it.
   */
  private JsonObject removeContent(JsonObject asset, long now, JsonObject actor, String batchId) {
    storage.content.remove(str(asset, "id"));
    asset.add("context", JsonNull.INSTANCE);
    JsonObject content = asset.getAsJsonObject("content");
    if (!"removed".equals(str(content, "status"))) {
      content.addProperty("status", "removed");
      content.addProperty("removalReason", "requested");
      content.addProperty("updatedAt", now);
      content.add("extractedText", JsonNull.INSTANCE);
      content.add("metadata", JsonNull.INSTANCE);
      withoutRendering(content);
      asset.addProperty("updatedAt", now);
    } else {
      withoutRendering(content);
    }
    lifecycle("asset.content-removed", asset, actor, batchId);
    return asset;
  }

  private static final Set<String> DECISIONS = Set.of("allowed", "limited", "age-restricted", "blocked", "purged");
  private static final int MAX_DECISION_NOTE_LENGTH = 1499;

  /**
   * POST /assets/:id/decision, like the API: the body is validated, an asset still uploading or
   * processing is refused, a pending asset can only be blocked or purged, the same status is refused and purged
   * content can only be blocked. The status changes, a manual review is added, purging removes the
   * content (with its {@code asset.content-removed} event) and an {@code asset.<status>} event
   * records the reviewer's decision.
   */
  private JsonObject decide(JsonObject asset, JsonObject body, long now) throws Failure {
    String decision = str(body, "decision");
    if (decision == null || !DECISIONS.contains(decision)) throw Failure.validation("validation/invalid-value", "decision");
    JsonElement rawNote = body.get("note");
    if (rawNote == null || !rawNote.isJsonPrimitive() || !rawNote.getAsJsonPrimitive().isString()) throw Failure.validation("validation/invalid-type", "note");
    String note = rawNote.getAsString().strip();
    if (note.isEmpty()) throw Failure.validation("validation/too-small", "note");
    if (note.length() > MAX_DECISION_NOTE_LENGTH) throw Failure.validation("validation/too-big", "note");
    if (decision.equals("purged") && !bool(body, "confirmPurge")) throw Failure.validation("validation/invalid-value", "confirmPurge");
    if ("uploading".equals(str(asset.getAsJsonObject("upload"), "status"))
        || "processing".equals(str(asset.getAsJsonObject("classification"), "status")))
      throw new Failure(ErrorCodes.ASSET_PROCESSING);
    JsonObject moderation = asset.getAsJsonObject("classification").getAsJsonObject("moderation");
    String status = str(moderation, "status");
    if (!decision.equals("purged") && !decision.equals("blocked") && "pending".equals(status)) throw new Failure(ErrorCodes.ASSET_DECISION_NOT_ALLOWED);
    if (decision.equals(status)) throw new Failure(ErrorCodes.ASSET_DECISION_UNCHANGED);
    if (!decision.equals("purged") && !decision.equals("blocked") && "purged".equals(status)) throw new Failure(ErrorCodes.ASSET_CONTENT_PURGED);
    moderation.addProperty("status", decision);
    JsonObject review = new JsonObject();
    review.addProperty("id", createId("rev"));
    review.addProperty("decision", decision);
    review.addProperty("note", note);
    review.add("decidedBy", mockApiKeyDecider());
    review.addProperty("reviewedAt", now);
    review.addProperty("applied", true);
    if (!(moderation.get("manualReviews") instanceof JsonArray)) moderation.add("manualReviews", new JsonArray());
    moderation.getAsJsonArray("manualReviews").add(review);
    // Like the API: a queued re-run no longer replaces a reviewed decision.
    reruns.remove(str(asset, "id"));
    asset.addProperty("updatedAt", now);
    if (decision.equals("purged")) removeContent(asset, now, API_KEY_ACTOR, null);
    String name = str(asset, "name"), type = str(asset, "type");
    recordEvent("asset." + decision, decision.equals("allowed") || decision.equals("limited") ? "low" : "high", API_KEY_ACTOR, asset, java.util.Arrays.asList(
        new Models.EventFact("asset-type", type, null),
        new Models.EventFact("asset-name", name, "https://calmlens.com/go/asset/" + str(asset, "id")), new Models.EventFact("note", note, null)));
    return asset;
  }

  /**
   * The mock's grant, the asset segment of a URL {@code signAssetUrl} signs: {@code sig_} and the
   * lowercase hex of the UTF-8 string {@code {assetId}.{1|0}.{expiresAt}}, its asset, original
   * access and expiry. Every SDK's mock writes it the same way. It is readable, not signed, as the
   * mock has no secret to keep.
   */
  static String encodeMockGrant(String assetId, boolean original, long expiresAt) {
    return "sig_" + java.util.HexFormat.of().formatHex((assetId + "." + (original ? 1 : 0) + "." + expiresAt).getBytes(StandardCharsets.UTF_8));
  }

  /** A grant the mock signed. */
  record MockGrant(String assetId, boolean original, long expiresAt) {}

  private static final Pattern MOCK_GRANT = Pattern.compile("(.+)\\.([01])\\.(\\d+)", Pattern.DOTALL);

  /** Reads a mock grant, or null for a segment the mock didn't sign. */
  static MockGrant decodeMockGrant(String segment) {
    String hex = segment.substring("sig_".length());
    if (!hex.matches("(?:[0-9a-f]{2})+")) return null;
    String text;
    try {
      text = StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(java.util.HexFormat.of().parseHex(hex))).toString();
    } catch (java.nio.charset.CharacterCodingException invalid) {
      return null;
    }
    java.util.regex.Matcher match = MOCK_GRANT.matcher(text);
    if (!match.matches()) return null;
    try {
      return new MockGrant(match.group(1), match.group(2).equals("1"), Long.parseLong(match.group(3)));
    } catch (NumberFormatException tooLong) {
      return null;
    }
  }

  /**
   * Signs an asset URL like the API ({@code POST /projects/:projectId/signed-asset-urls}): a grant
   * to one asset, by ID or external ID, until it expires, serving the original only when asked.
   * The mock's grant is readable (its asset, original access and expiry), unlike the CDN's, and
   * only the mock's CDN accepts it.
   */
  private JsonObject signAssetUrl(JsonObject body, long now) throws Failure {
    // Like the API's schema, none of these fields takes null.
    for (String key : List.of("assetId", "externalId", "expiresIn", "original"))
      if (body.has(key) && body.get(key).isJsonNull()) throw Failure.validation("validation/invalid-type", key);
    if (body.has("assetId") == body.has("externalId")) {
      Map<String, Object> issue = new java.util.LinkedHashMap<>();
      issue.put("path", "");
      issue.put("message", "Send either assetId or externalId");
      issue.put("code", "custom");
      throw new Failure(ErrorCodes.INVALID_REQUEST, 400, "Send either assetId or externalId", Map.of("issues", List.of(issue)));
    }
    long expiresIn = 15 * 60;
    if (body.has("expiresIn")) {
      JsonElement value = body.get("expiresIn");
      if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber() || value.getAsDouble() != Math.rint(value.getAsDouble()))
        throw Failure.validation("validation/invalid-type", "expiresIn");
      if (value.getAsDouble() < 1) throw Failure.validation("validation/too-small", "expiresIn");
      if (value.getAsDouble() > 24 * 60 * 60) throw Failure.validation("validation/too-big", "expiresIn");
      expiresIn = value.getAsLong();
    }
    boolean original = false;
    if (body.has("original")) {
      JsonElement value = body.get("original");
      if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) throw Failure.validation("validation/invalid-type", "original");
      original = value.getAsBoolean();
    }
    JsonObject asset;
    if (body.has("externalId")) {
      JsonElement externalId = body.get("externalId");
      asset = projectAssets().stream().filter(candidate -> externalId.equals(candidate.get("externalId"))).findFirst()
          .orElseThrow(() -> new Failure(ErrorCodes.ASSET_NOT_FOUND, "Asset not found"));
    } else {
      asset = asset(body.get("assetId").isJsonPrimitive() ? body.get("assetId").getAsString() : body.get("assetId").toString());
    }
    if (held(asset)) throw Failure.of(ErrorCodes.ASSET_HELD, Map.of("hold", "safety"));
    long expiresAt = now + expiresIn * 1000;
    JsonObject signed = new JsonObject();
    signed.addProperty("url", cdnBase + "/assets/" + CalmLensServerClient.encodeComponent(projectId) + "/" + encodeMockGrant(str(asset, "id"), original, expiresAt));
    signed.addProperty("expiresAt", expiresAt);
    return signed;
  }

  private JsonElement assetRoute(String method, String id, String suffix, JsonObject q, JsonObject body, byte[] raw, long now)
      throws Failure, IOException {
    // Like the API's schemas, which are checked before the asset is looked up.
    if (method.equals("PATCH") && suffix.isEmpty()) {
      checkMetadata(body.get("metadata"));
      if (body.has("name") && body.get("name").isJsonNull()) throw Failure.validation("validation/invalid-type", "name");
    }
    JsonObject asset = asset(id);
    switch (method + " " + suffix) {
      case "GET ": return asset;
      case "GET children": return page(projectAssets().stream().filter(child -> id.equals(str(child, "parentId"))).collect(Collectors.toList()), q, Json.write(new JsonPrimitive(id)), null);
      case "DELETE ":
        storage.assets.remove(id);
        storage.content.remove(id);
        uploads.remove(id);
        lifecycle("asset.deleted", asset, API_KEY_ACTOR, null);
        return null;
      case "DELETE content": return removeContent(asset, now, API_KEY_ACTOR, null);
      case "POST retry":
        if (!"failed".equals(str(asset.getAsJsonObject("classification"), "status"))
            || !"pending".equals(str(asset.getAsJsonObject("classification").getAsJsonObject("moderation"), "status")))
          throw new Failure(ErrorCodes.ASSET_NOT_RETRYABLE);
        if ("removed".equals(str(asset.getAsJsonObject("content"), "status"))) throw new Failure(ErrorCodes.ASSET_CONTENT_UNAVAILABLE);
        // Like the API: back to processing, to be moderated again, with an asset.retried event.
        applyOutcome(asset, MockCalmLensServerClient.Outcome.PENDING, "policy", now, null);
        lifecycle("asset.retried", asset, API_KEY_ACTOR, null);
        moderateStored(asset, MockCalmLensServerClient.Trigger.RETRY, null);
        return asset;
      case "POST decision": return decide(asset, body, now);
      case "POST explain": {
        if (!"completed".equals(str(asset.getAsJsonObject("classification"), "status"))) throw new Failure(ErrorCodes.ASSET_NOT_DECIDED);
        JsonObject moderation = asset.getAsJsonObject("classification").getAsJsonObject("moderation");
        if (body == null || !bool(body, "rerun")) {
          // Like the API: the evidence is completed and every action stays as decided.
          if (moderation.has("explanationComplete") && !moderation.get("explanationComplete").getAsBoolean()) {
            moderation.addProperty("explanationComplete", true);
            asset.addProperty("updatedAt", now);
          }
          return asset;
        }
        JsonElement reviews = moderation.get("manualReviews");
        if (reviews != null && reviews.isJsonArray() && !reviews.getAsJsonArray().isEmpty()) throw new Failure(ErrorCodes.ASSET_REVIEWED);
        if ("removed".equals(str(asset.getAsJsonObject("content"), "status"))) throw new Failure(ErrorCodes.ASSET_CONTENT_UNAVAILABLE);
        // Like the API: the request is recorded, and the asset returns as it was. It keeps its
        // decision while it's moderated again under the current policy.
        recordEvent("asset.rerun-requested", "low", API_KEY_ACTOR, asset, List.of(assetNameFact(asset),
            new Models.EventFact("asset-type", str(asset, "type"), null), new Models.EventFact("moderation-status", str(moderation, "status"), null)));
        JsonObject response = asset.deepCopy();
        settleRerun(asset, MockCalmLensServerClient.Trigger.RERUN, null);
        return response;
      }
      case "POST move": {
        String folderId = str(body, "folderId");
        if (folderId != null) folder(folderId);
        asset.add("folderId", nullable(folderId));
        asset.addProperty("updatedAt", now);
        return asset;
      }
      case "POST part": uploadPart(asset, q, raw, now); return asset;
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
   * An RSQL filter as the API reads it: comparisons on the fields in {@link MockAssetFilters#FIELDS},
   * each with its own operators, joined by {@code ;} (and), which binds
   * tighter than {@code ,} (or), and grouped with {@code ( … )}. Anything else is
   * {@code filter/invalid}.
   */
  static Predicate<JsonObject> rsql(String expression) throws Failure {
    List<List<Predicate<JsonObject>>> alternatives = new ArrayList<>();
    for (String alternative : split(expression, ',')) {
      List<Predicate<JsonObject>> tests = new ArrayList<>();
      for (String term : split(alternative, ';')) {
        String text = term.strip();
        if (text.isEmpty()) throw invalidFilter();
        String group = unwrap(text);
        tests.add(group != null ? rsql(group) : comparison(text));
      }
      alternatives.add(tests);
    }
    return asset -> alternatives.stream().anyMatch(group -> group.stream().allMatch(test -> test.test(asset)));
  }

  private static Failure invalidFilter() { return new Failure(ErrorCodes.INVALID_FILTER, "Invalid filter"); }

  /** Splits on {@code separator} outside quotes and parentheses (groups and {@code =in=(...)} lists). */
  private static List<String> split(String text, char separator) throws Failure {
    List<String> parts = new ArrayList<>();
    StringBuilder current = new StringBuilder();
    int depth = 0;
    char quote = 0;
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (quote != 0) {
        if (c == '\\' && i + 1 < text.length()) { current.append(c).append(text.charAt(++i)); continue; }
        if (c == quote) quote = 0;
      }
      else if (c == '"' || c == '\'') quote = c;
      else if (c == '(') depth++;
      else if (c == ')' && --depth < 0) throw invalidFilter();
      else if (depth == 0 && c == separator) { parts.add(current.toString()); current.setLength(0); continue; }
      current.append(c);
    }
    if (quote != 0 || depth != 0) throw invalidFilter();
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
      if (quote != 0) { if (c == '\\') i++; else if (c == quote) quote = 0; }
      else if (c == '"' || c == '\'') quote = c;
      else if (c == '(') depth++;
      else if (c == ')' && --depth == 0) return i == text.length() - 1 ? text.substring(1, i) : null;
    }
    return null;
  }

  // An operator is == or != or a comparison, or =name= (FIQL): only the field's own operators pass.
  private static final Pattern COMPARISON = Pattern.compile("\\s*([^\\s=!~<>(),;\"']+)\\s*(==|!=|>=|<=|>|<|=[a-z]*=)(.*)", Pattern.DOTALL);
  private static final Pattern VALUE = Pattern.compile("\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|[^\\s\"'(),;=!~<>]+)\\s*");
  private static final Pattern NUMBER = Pattern.compile("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?");

  /** One value: quoted (backslash escapes the next character) or unquoted, or null when invalid. */
  private static String value(String raw) {
    Matcher found = VALUE.matcher(raw);
    if (!found.matches()) return null;
    String text = found.group(1);
    if (text.charAt(0) != '"' && text.charAt(0) != '\'') return text;
    return text.substring(1, text.length() - 1).replaceAll("\\\\(.)", "$1");
  }

  /** Compares text by code point, like the database. */
  private static int compareText(String a, String b) {
    int[] left = a.codePoints().toArray(), right = b.codePoints().toArray();
    for (int i = 0; i < Math.min(left.length, right.length); i++)
      if (left[i] != right[i]) return Integer.compare(left[i], right[i]);
    return Integer.compare(left.length, right.length);
  }

  private static Predicate<JsonObject> comparison(String text) throws Failure {
    Matcher found = COMPARISON.matcher(text);
    if (!found.matches()) throw invalidFilter();
    String name = found.group(1), operator = found.group(2), raw = found.group(3).strip();
    MockAssetFilters.Field field = MockAssetFilters.FIELDS.get(name);
    if (field == null || !field.operators().contains(operator)) throw invalidFilter();
    boolean isList = operator.equals("=in=") || operator.equals("=out=");
    List<String> texts = new ArrayList<>();
    if (isList) {
      if (!raw.startsWith("(") || !raw.endsWith(")")) throw invalidFilter();
      for (String part : split(raw.substring(1, raw.length() - 1), ',')) texts.add(value(part));
    } else texts.add(value(raw));
    if (texts.contains(null)) throw invalidFilter();
    boolean number = field.kind().equals("number"), list = field.kind().equals("list");
    // Values as the API reads them: null for a nullable field's "null", a number for a number field.
    List<Object> values = new ArrayList<>();
    for (String value : texts) {
      if (field.nullable() && value.equals("null")) values.add(null);
      else if (!number) values.add(value);
      else if (NUMBER.matcher(value).matches()) values.add(Double.parseDouble(value));
      else throw invalidFilter();
    }
    Object first = values.get(0);
    // `*` in an == or != text value matches any run of characters, ignoring case.
    Pattern glob = !isList && (operator.equals("==") || operator.equals("!=")) && first instanceof String pattern && pattern.contains("*")
        ? Pattern.compile(java.util.Arrays.stream(pattern.split("\\*", -1)).map(part -> part.isEmpty() ? "" : Pattern.quote(part)).collect(Collectors.joining(".*")),
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE)
        : null;
    return asset -> {
      JsonElement actual = path(asset, name);
      if (list) {
        // A list holds any of the values (=in=) or none of them (=out=); a missing list holds none.
        Set<String> held = new HashSet<>();
        if (actual != null && actual.isJsonArray())
          actual.getAsJsonArray().forEach(item -> { if (item.isJsonPrimitive()) held.add(item.getAsString()); });
        return values.stream().anyMatch(held::contains) == operator.equals("=in=");
      }
      if (actual == null || actual.isJsonNull()) {
        // Like SQL, a comparison never matches a missing value; only == null finds one.
        return operator.equals("==") && glob == null && first == null;
      }
      List<Object> present = new ArrayList<>();
      if (!actual.isJsonPrimitive()) return false;
      else if (number && actual.getAsJsonPrimitive().isNumber()) present.add(actual.getAsDouble());
      else present.add(actual.getAsString());
      Predicate<Object> equal = expected -> expected != null && present.stream().anyMatch(expected::equals);
      switch (operator) {
        case "==": return glob != null ? present.stream().anyMatch(v -> glob.matcher(String.valueOf(v)).matches()) : first != null && equal.test(first);
        case "!=": return glob != null ? present.stream().noneMatch(v -> glob.matcher(String.valueOf(v)).matches()) : first == null || !equal.test(first);
        case "=in=": return values.stream().anyMatch(equal);
        case "=out=": return !values.contains(null) && values.stream().noneMatch(equal);
        default:
          if (first == null) return false;
          Object left = present.get(0);
          int order;
          if (left instanceof Double l && first instanceof Double r) order = Double.compare(l, r);
          else if (left instanceof String l && first instanceof String r) order = compareText(l, r);
          else return false;
          return switch (operator) { case ">" -> order > 0; case ">=" -> order >= 0; case "<" -> order < 0; default -> order <= 0; };
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
   * A list's {@code sort} as the API parses it ({@code sortQueryField}): comma-separated fields from
   * {@code fields}, descending when prefixed with {@code -}, none repeated and at most {@code max},
   * as {@code {field, direction}} clauses; null when the query has none. Anything else is refused
   * with {@code validation/invalid-value} at {@code sort}.
   */
  private static JsonArray sort(JsonObject q, List<String> fields, int max) throws Failure {
    String value = str(q, "sort");
    if (value == null) return null;
    JsonArray clauses = new JsonArray();
    Set<String> seen = new HashSet<>();
    for (String raw : value.split(",", -1)) {
      String part = raw.strip();
      String field = part.startsWith("-") ? part.substring(1) : part;
      if (!SORT_FIELD.matcher(part).matches() || !fields.contains(field) || !seen.add(field))
        throw Failure.validation(ErrorCodes.INVALID_VALUE, "sort");
      JsonObject clause = new JsonObject();
      clause.addProperty("field", field);
      clause.addProperty("direction", part.startsWith("-") ? "desc" : "asc");
      clauses.add(clause);
    }
    if (clauses.size() > max) throw Failure.validation(ErrorCodes.INVALID_VALUE, "sort");
    return clauses;
  }

  /** A single {@code {field, direction}} clause. */
  private static JsonObject clause(String field, String direction) {
    JsonObject clause = new JsonObject();
    clause.addProperty("field", field);
    clause.addProperty("direction", direction);
    return clause;
  }

  /**
   * An asset's findings timeline, as the API lists it: refused while a safety hold is on. The mock
   * analyses no audio or video, so it keeps no segments: every timeline is empty, and no cursor
   * continues one.
   */
  private JsonObject timeline(JsonObject asset, JsonObject q) throws Failure {
    bounded(q, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    if (held(asset)) throw Failure.of(ErrorCodes.ASSET_HELD, Map.of("hold", "safety"));
    if (q.has("cursor")) throw new Failure(ErrorCodes.INVALID_CURSOR, "The cursor is invalid or belongs to a different query.");
    JsonObject page = new JsonObject();
    page.add("items", new JsonArray());
    page.add("nextCursor", JsonNull.INSTANCE);
    page.addProperty("hasMore", false);
    return page;
  }

  /**
   * One keyset page like the API's (CursorPagination.ts): ordered by the query's {@code sort} of
   * {@code createdAt} and {@code id} ({@code defaultSort}, or newest first, without one), with an
   * {@code id} tie-breaker added, starting after the cursor's values. A cursor is tied to {@code
   * scope} (the filter, list or parent) and the sort, so it only continues the query it came from.
   */
  private JsonObject page(List<JsonObject> items, JsonObject q, String scope, JsonObject defaultSort) throws Failure {
    long size = bounded(q, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    JsonArray requested = sort(q, List.of("createdAt", "id"), 2);
    JsonArray ordering = requested != null ? requested : new JsonArray();
    if (ordering.isEmpty()) ordering.add(defaultSort != null ? defaultSort.deepCopy() : clause("createdAt", "desc"));
    boolean byId = false;
    for (JsonElement element : ordering) byId |= "id".equals(str(element.getAsJsonObject(), "field"));
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
      comparator = comparator.thenComparing("desc".equals(str(element.getAsJsonObject(), "direction")) ? next.reversed() : next);
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
          if (result != 0) return "desc".equals(str(rule, "direction")) ? result < 0 : result > 0;
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
    page.addProperty("hasMore", more);
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
  private static final int MAX_SEARCH_TOKENS = 8, MAX_SEARCH_PAGE_SIZE = 20, MAX_SEARCH_QUERY_LENGTH = 200;

  /**
   * Keyword search like the API: every whitespace-separated token (case-insensitive, at most 8
   * distinct) must appear in some field. Results rank by the API's score, then newest first.
   */
  private JsonObject search(JsonObject q) throws Failure {
    // Like the API's query schema: a trimmed query of 1 to 200 characters, 1 to 20 results.
    String text = Objects.requireNonNullElse(str(q, "query"), "").strip();
    if (text.isEmpty()) throw Failure.validation("validation/too-small", "query");
    if (text.length() > MAX_SEARCH_QUERY_LENGTH) throw Failure.validation("validation/too-big", "query");
    long limit = bounded(q, "pageSize", 10, MAX_SEARCH_PAGE_SIZE);
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

  /**
   * GET /projects/:id/folders, like the API: keyset pages ordered by {@code name} (by code point, the
   * default, ascending) or {@code createdAt}, with the folder ID breaking ties, and the ancestors
   * needed to show the listed and parent folders' paths.
   */
  private JsonObject listFolders(JsonObject q) throws Failure {
    long size = bounded(q, "pageSize", DEFAULT_PAGE_SIZE, MAX_FOLDER_PAGE_SIZE);
    String parentId = str(q, "parentId"), search = Objects.requireNonNullElse(str(q, "search"), "").toLowerCase(Locale.ROOT);
    // The folder list sorts by one field, name (the default) or createdAt.
    JsonArray requested = sort(q, List.of("name", "createdAt"), 1);
    JsonObject clause = requested != null && !requested.isEmpty() ? requested.get(0).getAsJsonObject() : clause("name", "asc");
    String field = str(clause, "field");
    boolean descending = "desc".equals(str(clause, "direction"));
    List<JsonObject> all = projectFolders();
    // Like the database: names compare by code point, so case matters, then IDs break ties.
    Comparator<JsonObject> order = field.equals("createdAt")
        ? Comparator.<JsonObject, JsonElement>comparing(f -> f.get("createdAt"), MockApi::compare)
        : Comparator.comparing((JsonObject f) -> Objects.requireNonNullElse(str(f, "name"), ""), MockApi::byCodePoint);
    order = order.thenComparing((JsonObject f) -> str(f, "id"), MockApi::byCodePoint);
    if (descending) order = order.reversed();
    List<JsonObject> found = all.stream()
        .filter(f -> Objects.equals(str(f, "parentId"), parentId) && Objects.requireNonNullElse(str(f, "name"), "").toLowerCase(Locale.ROOT).contains(search))
        .sorted(order).collect(Collectors.toList());
    JsonArray scope = new JsonArray();
    scope.add(projectId);
    scope.add(nullable(parentId));
    scope.add(search);
    scope.add(clause);
    String cursor = str(q, "cursor");
    if (cursor != null && !cursor.isEmpty()) {
      JsonObject boundary = new JsonObject();
      try {
        JsonObject parsed = JsonParser.parseString(new String(Base64.getDecoder().decode(cursor), StandardCharsets.UTF_8)).getAsJsonObject();
        if (!Json.write(scope).equals(str(parsed, "scope")) || str(parsed, "id") == null || !parsed.has("value")) throw new IllegalArgumentException("Invalid cursor");
        boundary.add(field, parsed.get("value"));
        boundary.add("id", parsed.get("id"));
      } catch (RuntimeException invalid) {
        throw new Failure(ErrorCodes.INVALID_CURSOR, "The cursor is invalid or belongs to a different query.");
      }
      Comparator<JsonObject> keyset = order;
      found = found.stream().filter(f -> keyset.compare(f, boundary) > 0).collect(Collectors.toList());
    }
    List<JsonObject> page = found.subList(0, (int) Math.min(size, found.size()));
    boolean more = found.size() > size;
    Set<String> ids = new HashSet<>();
    page.forEach(f -> ids.add(str(f, "id")));
    if (parentId != null) ids.add(parentId);
    List<String> pending = new ArrayList<>(ids);
    while (!pending.isEmpty()) {
      String parent = str(storage.folders.get(pending.remove(pending.size() - 1)), "parentId");
      if (parent != null && ids.add(parent)) pending.add(parent);
    }
    JsonObject result = new JsonObject();
    JsonArray items = new JsonArray(), ancestors = new JsonArray();
    page.forEach(items::add);
    all.stream().filter(f -> ids.contains(str(f, "id")) && !page.contains(f)).forEach(ancestors::add);
    result.add("items", items);
    result.add("ancestors", ancestors);
    if (more) {
      JsonObject last = page.get(page.size() - 1);
      JsonObject next = new JsonObject();
      next.addProperty("scope", Json.write(scope));
      next.add("value", last.get(field));
      next.add("id", last.get("id"));
      result.addProperty("nextCursor", Base64.getEncoder().encodeToString(Json.write(next).getBytes(StandardCharsets.UTF_8)));
    } else result.add("nextCursor", JsonNull.INSTANCE);
    result.addProperty("hasMore", more);
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
    folder.addProperty("id", createId("fldr"));
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

  // ------------------------------------------------------------------ Hash lists
  // Lists and entries live in memory for the mock's lifetime. Uploads aren't matched against them.

  private static final Pattern PDQ_HASH = Pattern.compile("[0-9a-f]{64}");

  private List<JsonObject> projectHashLists() {
    return storage.hashLists.values().stream().filter(l -> projectId.equals(str(l, "projectId"))).collect(Collectors.toList());
  }

  private JsonObject hashList(String id) throws Failure {
    JsonObject list = storage.hashLists.get(id);
    if (list == null || !projectId.equals(str(list, "projectId"))) throw new Failure(ErrorCodes.HASH_LIST_NOT_FOUND, "Hash list not found");
    return list;
  }

  private static String hashListAction(JsonObject body) {
    String action = str(body, "action");
    return "flag".equals(action) || "block".equals(action) ? action : null;
  }

  private JsonObject createHashList(JsonObject body, long now) throws Failure {
    String name = str(body, "name");
    String action = hashListAction(body);
    if (name == null || name.isBlank() || action == null)
      throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "A hash list needs a name and an action of flag or block");
    JsonObject list = new JsonObject();
    list.addProperty("id", createId("hl"));
    list.addProperty("projectId", projectId);
    list.addProperty("name", name.trim());
    list.add("description", nullable(str(body, "description")));
    list.addProperty("action", action);
    list.addProperty("createdAt", now);
    list.addProperty("updatedAt", now);
    storage.hashLists.put(str(list, "id"), list);
    created = true;
    return list;
  }

  private JsonElement hashListRoute(String method, String id, String suffix, JsonObject q, JsonObject body, long now) throws Failure, IOException {
    JsonObject list = hashList(id);
    switch (method + " " + suffix) {
      case "GET ": return list;
      case "PATCH ": {
        if (str(body, "name") != null) list.addProperty("name", str(body, "name").trim());
        if (body.has("description")) list.add("description", nullable(str(body, "description")));
        if (hashListAction(body) != null) list.addProperty("action", hashListAction(body));
        list.addProperty("updatedAt", now);
        return list;
      }
      case "DELETE ":
        storage.hashLists.remove(id);
        storage.hashListEntries.values().removeIf(entry -> id.equals(str(entry, "hashListId")));
        return null;
      case "GET entries": {
        List<JsonObject> entries = storage.hashListEntries.values().stream().filter(entry -> id.equals(str(entry, "hashListId"))).collect(Collectors.toList());
        return page(entries, q, Json.write(new JsonPrimitive("hash-list-entries/" + id)), null);
      }
      case "POST entries": {
        String hash = str(body, "hash") == null ? null : str(body, "hash").trim().toLowerCase(Locale.ROOT);
        JsonElement rawQuality = body.get("quality");
        JsonElement quality = rawQuality != null && rawQuality.isJsonPrimitive() && rawQuality.getAsJsonPrimitive().isNumber() ? rawQuality : JsonNull.INSTANCE;
        String assetId = str(body, "assetId");
        if ((hash == null) == (assetId == null)) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Send either hash or assetId");
        if (assetId != null) {
          JsonObject content = asset(assetId).getAsJsonObject("content");
          String perceptualHash = str(content, "perceptualHash");
          if (perceptualHash == null) throw new Failure(ErrorCodes.HASH_LIST_ASSET_NOT_HASHED, "This asset has no perceptual hash.");
          hash = perceptualHash;
          JsonElement hashQuality = content.get("perceptualHashQuality");
          quality = hashQuality == null ? JsonNull.INSTANCE : hashQuality;
        }
        if (!PDQ_HASH.matcher(hash).matches()) throw new Failure(ErrorCodes.INVALID_UPLOAD_PAYLOAD, "Use a PDQ hash of 64 hexadecimal characters");
        for (JsonObject existing : storage.hashListEntries.values())
          if (id.equals(str(existing, "hashListId")) && hash.equals(str(existing, "hash"))) return existing;
        JsonObject entry = new JsonObject();
        entry.addProperty("id", createId("hle"));
        entry.addProperty("projectId", projectId);
        entry.addProperty("hashListId", id);
        entry.addProperty("hash", hash);
        entry.add("quality", quality);
        entry.add("label", nullable(str(body, "label")));
        entry.add("assetId", nullable(assetId));
        entry.addProperty("createdAt", now);
        storage.hashListEntries.put(str(entry, "id"), entry);
        created = true;
        return entry;
      }
      default: throw unsupported(method, "/hash-lists/" + id + "/" + suffix);
    }
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

  // ------------------------------------------------------------------ Configuration
  // Upload presets, project settings and metadata fields. Settings and fields share one revision.

  private final Map<String, JsonObject> configuredPresets = new LinkedHashMap<>();
  private long settingsRevision = 1;
  private JsonObject projectSettingsValues = new JsonObject();
  private List<JsonObject> metadataFieldList = new ArrayList<>();

  /** The objects in {@code body[key]}, refused like the API's schema when there are none. */
  private static List<JsonObject> definitions(JsonObject body, String key) throws Failure {
    List<JsonObject> items = new ArrayList<>();
    JsonElement value = body.get(key);
    if (value != null && value.isJsonArray())
      for (JsonElement item : value.getAsJsonArray()) {
        if (!item.isJsonObject()) throw Failure.validation("validation/invalid-type", key + "." + items.size());
        items.add(item.getAsJsonObject());
      }
    if (items.isEmpty()) throw Failure.validation("validation/too-small", key);
    return items;
  }

  private static JsonElement orNull(JsonObject object, String key) {
    JsonElement value = object.get(key);
    return value == null ? JsonNull.INSTANCE : value.deepCopy();
  }

  private static JsonElement orDefault(JsonObject object, String key, JsonElement fallback) {
    JsonElement value = object.get(key);
    return value == null || value.isJsonNull() ? fallback : value.deepCopy();
  }

  /** A preset's list without repeats, with null for an empty or missing one. */
  private static JsonElement distinctList(JsonElement value) {
    if (value == null || !value.isJsonArray() || value.getAsJsonArray().isEmpty()) return JsonNull.INSTANCE;
    JsonArray distinct = new JsonArray();
    new java.util.LinkedHashSet<>(value.getAsJsonArray().asList()).forEach(distinct::add);
    return distinct;
  }

  /** Whether a revision the caller sent, in a body or a query, is the given one. */
  private static boolean sameRevision(JsonElement sent, long current) {
    return sent.isJsonPrimitive() && sent.getAsString().equals(String.valueOf(current));
  }

  /** Like the API: every preset's revision and settings are checked before any is saved. */
  private JsonObject ensureUploadPresets(JsonObject body, long now) throws Failure {
    List<JsonObject> plans = new ArrayList<>();
    List<JsonObject> definitions = definitions(body, "uploadPresets");
    for (int index = 0; index < definitions.size(); index++) {
      JsonObject definition = definitions.get(index);
      String key = str(definition, "key");
      if (key == null || key.isEmpty()) throw Failure.validation("validation/invalid-type", "uploadPresets." + index + ".key");
      String name = str(definition, "name");
      if (name == null || name.isEmpty()) throw Failure.validation("validation/invalid-type", "uploadPresets." + index + ".name");
      JsonObject existing = configuredPresets.get(key);
      long current = existing == null ? 0 : existing.get("revision").getAsLong();
      JsonElement revision = definition.get("revision");
      if (revision != null && !sameRevision(revision, current)) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("key", key);
        details.put("revision", current);
        throw Failure.of(ErrorCodes.UPLOAD_PRESET_REVISION_CONFLICT, details);
      }
      JsonObject values = new JsonObject();
      values.addProperty("key", key);
      values.addProperty("name", name);
      values.add("access", orDefault(definition, "access", new JsonPrimitive("token")));
      values.add("enabled", orDefault(definition, "enabled", new JsonPrimitive(true)));
      values.add("allowedContentTypes", distinctList(definition.get("allowedContentTypes")));
      values.add("maxSizeInBytes", orNull(definition, "maxSizeInBytes"));
      values.add("folderId", orNull(definition, "folderId"));
      values.add("policyId", orNull(definition, "policyId"));
      values.add("visibility", orDefault(definition, "visibility", new JsonPrimitive("private")));
      values.add("processingOptions", orNull(definition, "processingOptions"));
      values.add("revealDecision", orDefault(definition, "revealDecision", new JsonPrimitive(false)));
      values.add("dailyUploadLimit", orNull(definition, "dailyUploadLimit"));
      values.add("allowedOrigins", distinctList(definition.get("allowedOrigins")));
      JsonElement limit = values.get("dailyUploadLimit");
      if ("anyone".equals(str(values, "access")) && (limit.isJsonNull() || limit.getAsDouble() == 0))
        throw new Failure(ErrorCodes.UPLOAD_PRESET_DAILY_LIMIT_REQUIRED);
      plans.add(values);
    }
    JsonArray saved = new JsonArray();
    for (JsonObject values : plans) {
      JsonObject existing = configuredPresets.get(str(values, "key"));
      if (existing != null && values.keySet().stream().allMatch(field -> canonical(values.get(field)).equals(canonical(existing.get(field))))) {
        saved.add(existing);
        continue;
      }
      JsonObject preset = new JsonObject();
      preset.addProperty("id", existing == null ? createId("preset") : str(existing, "id"));
      preset.addProperty("projectId", projectId);
      preset.add("createdByUserId", JsonNull.INSTANCE);
      values.entrySet().forEach(entry -> preset.add(entry.getKey(), entry.getValue()));
      preset.addProperty("revision", existing == null ? 1 : existing.get("revision").getAsLong() + 1);
      preset.addProperty("createdAt", existing == null ? now : existing.get("createdAt").getAsLong());
      preset.addProperty("updatedAt", now);
      configuredPresets.put(str(values, "key"), preset);
      saved.add(preset);
    }
    JsonObject response = new JsonObject();
    response.add("uploadPresets", saved);
    return response;
  }

  private JsonElement deleteUploadPreset(String id) throws Failure {
    if (!configuredPresets.values().removeIf(preset -> id.equals(str(preset, "id"))))
      throw new Failure(ErrorCodes.UPLOAD_PRESET_NOT_FOUND, "Upload preset not found");
    return null;
  }

  private JsonObject toProjectSettings() {
    JsonObject settings = new JsonObject();
    settings.add("optOutJurisdictions", new JsonArray());
    settings.addProperty("blockUnmoderatedAssets", true);
    settings.addProperty("storeSensitiveMetadata", false);
    settings.addProperty("streamingEnabled", false);
    settings.addProperty("aiMediaSearchEnabled", false);
    settings.add("remoteUrlRule", JsonNull.INSTANCE);
    settings.add("websiteSubmissionsPerMinute", JsonNull.INSTANCE);
    projectSettingsValues.deepCopy().entrySet().forEach(entry -> settings.add(entry.getKey(), entry.getValue()));
    JsonObject humanReview = new JsonObject();
    humanReview.addProperty("allowedSamplePercent", 0);
    humanReview.addProperty("restrictedSamplePercent", 0);
    humanReview.addProperty("uncertaintyMarginPercent", 0);
    humanReview.addProperty("reviewMissingEvidence", false);
    if (projectSettingsValues.get("humanReview") instanceof JsonObject chosen)
      chosen.deepCopy().entrySet().forEach(entry -> humanReview.add(entry.getKey(), entry.getValue()));
    settings.add("humanReview", humanReview);
    JsonObject resource = new JsonObject();
    resource.addProperty("projectId", projectId);
    resource.addProperty("revision", settingsRevision);
    resource.add("settings", settings);
    return resource;
  }

  private void checkSettingsRevision(JsonElement revision) throws Failure {
    if (revision != null && !revision.isJsonNull() && !sameRevision(revision, settingsRevision))
      throw new Failure(ErrorCodes.PROJECT_SETTINGS_REVISION_CONFLICT);
  }

  /** Replaces the settings: those left out return to their defaults. Only a real change takes a new revision. */
  private JsonObject updateProjectSettings(JsonObject body) throws Failure {
    checkSettingsRevision(body.get("revision"));
    if (!(body.get("settings") instanceof JsonObject settings)) throw Failure.validation("validation/invalid-type", "settings");
    String before = canonical(toProjectSettings().get("settings"));
    JsonObject previous = projectSettingsValues;
    projectSettingsValues = settings.deepCopy();
    if (canonical(toProjectSettings().get("settings")).equals(before)) projectSettingsValues = previous;
    else settingsRevision += 1;
    return toProjectSettings();
  }

  private JsonObject toMetadataFields() {
    JsonArray fields = new JsonArray();
    metadataFieldList.forEach(field -> fields.add(field.deepCopy()));
    JsonObject resource = new JsonObject();
    resource.addProperty("projectId", projectId);
    resource.addProperty("revision", settingsRevision);
    resource.add("fields", fields);
    return resource;
  }

  /** Creates or replaces fields by ID, keeping the others in order. */
  private JsonObject ensureMetadataFields(JsonObject body) throws Failure {
    checkSettingsRevision(body.get("revision"));
    List<JsonObject> fields = definitions(body, "fields");
    Map<String, JsonObject> byId = new HashMap<>();
    fields.forEach(field -> byId.put(str(field, "id"), field));
    Set<String> known = new HashSet<>();
    List<JsonObject> merged = new ArrayList<>();
    for (JsonObject field : metadataFieldList) {
      known.add(str(field, "id"));
      merged.add(byId.getOrDefault(str(field, "id"), field));
    }
    for (JsonObject field : fields) if (!known.contains(str(field, "id"))) merged.add(field);
    JsonArray before = new JsonArray(), after = new JsonArray();
    metadataFieldList.forEach(before::add);
    merged.forEach(after::add);
    if (!canonical(after).equals(canonical(before))) {
      metadataFieldList = merged;
      settingsRevision += 1;
    }
    return toMetadataFields();
  }

  private JsonObject deleteMetadataField(String fieldId, JsonObject q) throws Failure {
    if (metadataFieldList.stream().noneMatch(field -> fieldId.equals(str(field, "id")))) {
      Map<String, Object> details = new LinkedHashMap<>();
      details.put("fieldId", fieldId);
      throw Failure.of(ErrorCodes.METADATA_FIELD_NOT_FOUND, details);
    }
    checkSettingsRevision(q.get("revision"));
    metadataFieldList.removeIf(field -> fieldId.equals(str(field, "id")));
    settingsRevision += 1;
    return toMetadataFields();
  }

  // ------------------------------------------------------------------ Policies
  // The project starts on the organisation's own General preset policy, following automatic
  // updates. The mock's presets have one release, version 1, with mockPresetSettings().

  /** The built-in presets the mock knows, by display name. */
  private static final Map<String, String> PRESET_NAMES = Map.of("general-community", "General",
      "children-platform", "Kids", "education-support", "Learning and support", "wholesome-community", "Teen-safe");

  /**
   * Stored policies in the API's shape, without {@code projectIds}, with {@code preset} as {@code
   * {id, version, own}} and {@code followsPreset}: whether the organisation's own preset policy
   * follows its preset (mode {@code live}).
   */
  private final Map<String, JsonObject> policies = new LinkedHashMap<>();
  /** Each policy's reset baseline: the settings of its preset version. */
  private final Map<String, JsonObject> policyBaselines = new HashMap<>();
  private String projectPolicyId;

  /** The project's policy, after creating the organisation's own General policy on first use. */
  private String ensurePolicies() {
    if (projectPolicyId == null)
      projectPolicyId = str(newPolicy("General", "", mockPresetSettings(), true, "general-community", true, now()), "id");
    return projectPolicyId;
  }

  /**
   * The settings of the mock's presets: every category with its default action ({@code allow} for
   * personal information and profanity, {@code block} otherwise) and no rules. The mock holds no
   * built-in preset settings, and uploads are never decided by a policy.
   */
  private static JsonObject mockPresetSettings() {
    JsonObject categories = new JsonObject();
    for (String category : MockClassification.CATEGORIES) {
      JsonObject settings = new JsonObject();
      settings.addProperty("action", category.equals("personal-information") || category.equals("profanity") ? "allow" : "block");
      settings.add("allowances", new JsonArray());
      settings.add("restrictions", new JsonArray());
      categories.add(category, settings);
    }
    JsonObject settings = new JsonObject();
    settings.add("categorySettings", categories);
    return settings;
  }

  /**
   * Refuses settings the API refuses (MODERATION_POLICY_SETTINGS_SCHEMA): every category, each with
   * an {@code action} and its {@code allowances} and {@code restrictions} lists, and no others.
   */
  private static void checkPolicySettings(JsonElement settings) throws Failure {
    JsonElement categories = settings != null && settings.isJsonObject() ? settings.getAsJsonObject().get("categorySettings") : null;
    if (categories == null || !categories.isJsonObject()) throw Failure.validation("validation/invalid-type", "settings.categorySettings");
    JsonObject byCategory = categories.getAsJsonObject();
    for (String category : MockClassification.CATEGORIES) {
      String path = "settings.categorySettings." + category;
      JsonElement value = byCategory.get(category);
      if (value == null || !value.isJsonObject()) throw Failure.validation("validation/invalid-type", path);
      for (String key : List.of("allowances", "restrictions")) {
        JsonElement rules = value.getAsJsonObject().get(key);
        if (rules == null || !rules.isJsonArray()) throw Failure.validation("validation/invalid-type", path + "." + key);
      }
      JsonElement action = value.getAsJsonObject().get("action");
      if (action == null || !action.isJsonPrimitive() || !action.getAsJsonPrimitive().isString())
        throw Failure.validation(ErrorCodes.INVALID_VALUE, path + ".action");
    }
    for (String key : byCategory.keySet())
      if (!MockClassification.CATEGORIES.contains(key)) throw Failure.validation("validation/unknown-field", "settings.categorySettings." + key);
  }

  private JsonObject newPolicy(String name, String description, JsonObject settings, boolean followsPreset,
      String presetId, boolean presetOwn, long now) {
    JsonObject policy = new JsonObject();
    policy.addProperty("id", createId("pol"));
    policy.addProperty("name", name);
    policy.addProperty("description", description);
    policy.add("settings", settings);
    policy.addProperty("revision", 1);
    policy.addProperty("followsPreset", followsPreset);
    if (presetId == null) policy.add("preset", JsonNull.INSTANCE);
    else {
      JsonObject preset = new JsonObject();
      preset.addProperty("id", presetId);
      preset.addProperty("version", 1);
      preset.addProperty("own", presetOwn);
      policy.add("preset", preset);
    }
    policy.addProperty("createdAt", now);
    policy.addProperty("updatedAt", now);
    policies.put(str(policy, "id"), policy);
    policyBaselines.put(str(policy, "id"), settings.deepCopy());
    return policy;
  }

  /** A stored policy as the API shows it, its preset's {@code mode} derived. */
  private JsonObject toPolicy(JsonObject stored) {
    JsonObject policy = new JsonObject();
    for (String key : List.of("id", "name", "description", "settings", "revision")) policy.add(key, stored.get(key).deepCopy());
    JsonElement preset = stored.get("preset");
    if (preset.isJsonObject()) {
      JsonObject shown = new JsonObject();
      shown.add("id", preset.getAsJsonObject().get("id"));
      shown.add("version", preset.getAsJsonObject().get("version"));
      shown.addProperty("latestVersion", 1);
      shown.addProperty("mode", bool(preset.getAsJsonObject(), "own") ? bool(stored, "followsPreset") ? "live" : "pinned" : "copy");
      policy.add("preset", shown);
    } else policy.add("preset", JsonNull.INSTANCE);
    JsonArray projectIds = new JsonArray();
    if (str(stored, "id").equals(projectPolicyId)) projectIds.add(projectId);
    policy.add("projectIds", projectIds);
    policy.add("createdAt", stored.get("createdAt"));
    policy.add("updatedAt", stored.get("updatedAt"));
    return policy;
  }

  private JsonObject policy(String id) throws Failure {
    ensurePolicies();
    JsonObject policy = policies.get(id);
    if (policy == null) throw new Failure(ErrorCodes.POLICY_NOT_FOUND, "Policy not found");
    return policy;
  }

  /** A page of the organisation's policies, oldest first unless {@code sort} says otherwise. */
  private JsonObject listPolicies(JsonObject q) throws Failure {
    ensurePolicies();
    List<JsonObject> items = new ArrayList<>();
    for (JsonObject policy : policies.values()) items.add(toPolicy(policy));
    return page(items, q, Json.write(new JsonPrimitive("policies/" + projectId)), clause("createdAt", "asc"));
  }

  private JsonObject createPolicy(JsonObject body, long now) throws Failure {
    ensurePolicies();
    String name = str(body, "name"), preset = str(body, "presetId");
    JsonElement settings = body.get("settings");
    boolean hasSettings = settings != null && !settings.isJsonNull();
    if (hasSettings == (preset != null) || preset != null && !PRESET_NAMES.containsKey(preset)
        || preset == null && (name == null || name.isBlank()))
      throw new Failure(ErrorCodes.INVALID_VALUE, "Send settings with a name, or presetId");
    if (preset == null) checkPolicySettings(settings);
    String description = str(body, "description");
    JsonObject policy = newPolicy(name != null && !name.isBlank() ? name.trim() : PRESET_NAMES.get(preset),
        description == null ? "" : description, preset != null ? mockPresetSettings() : settings.getAsJsonObject().deepCopy(),
        false, preset, false, now);
    created = true;
    return toPolicy(policy);
  }

  /** Saves the changes under the next revision, once {@code revision} is the current one. */
  private JsonObject savePolicy(JsonObject policy, JsonObject body, long now, java.util.function.Consumer<JsonObject> change) throws Failure {
    JsonElement revision = body.get("revision");
    long current = policy.get("revision").getAsLong();
    if (revision == null || !revision.isJsonPrimitive() || !revision.getAsJsonPrimitive().isNumber() || revision.getAsDouble() != current)
      throw new Failure(ErrorCodes.POLICY_REVISION_CONFLICT, "The policy changed");
    change.accept(policy);
    policy.addProperty("revision", current + 1);
    policy.addProperty("updatedAt", now);
    return toPolicy(policy);
  }

  private JsonElement policyRoute(String method, String id, String action, JsonObject body, long now) throws Failure, IOException {
    JsonObject policy = policy(id);
    JsonObject preset = policy.get("preset").isJsonObject() ? policy.getAsJsonObject("preset") : null;
    switch (method + " " + action) {
      case "GET ": return toPolicy(policy);
      case "PATCH ":
        if (body.has("settings") && !body.get("settings").isJsonNull()) checkPolicySettings(body.get("settings"));
        return savePolicy(policy, body, now, saved -> {
          if (str(body, "name") != null) saved.addProperty("name", str(body, "name").trim());
          if (str(body, "description") != null) saved.addProperty("description", str(body, "description"));
          if (body.has("settings") && !body.get("settings").isJsonNull()) saved.add("settings", body.get("settings").deepCopy());
          // Saving a live policy pins it.
          saved.addProperty("followsPreset", false);
        });
      case "DELETE ":
        if (id.equals(projectPolicyId)) throw new Failure(ErrorCodes.POLICY_IN_USE, "Projects still use this policy");
        policies.remove(id);
        policyBaselines.remove(id);
        return null;
      case "POST reset":
      case "POST upgrade":
        // Only a pinned or copied policy has a preset release to reset to or upgrade from.
        if (preset == null || bool(policy, "followsPreset")) throw new Failure(ErrorCodes.POLICY_NO_PRESET, "This policy has no preset baseline");
        if (!presetVersionIs(body, preset.get("version").getAsLong()))
          throw new Failure(ErrorCodes.POLICY_PRESET_VERSION_CONFLICT, "The preset changed");
        // The mock's presets have one release, so an upgrade never has a newer one to apply.
        if (action.equals("upgrade"))
          throw new Failure(ErrorCodes.POLICY_PRESET_UPDATE_UNAVAILABLE, "Only an unchanged policy at an older preset release can be upgraded");
        return savePolicy(policy, body, now, saved -> saved.add("settings", policyBaselines.get(id).deepCopy()));
      case "PUT automatic-updates": {
        boolean enabled = bool(body, "enabled");
        if (preset == null || !bool(preset, "own") || bool(policy, "followsPreset") == enabled)
          throw new Failure(ErrorCodes.POLICY_AUTOMATIC_UPDATES_UNAVAILABLE, "Automatic updates can't be switched this way for this policy");
        JsonElement revision = body.get("revision");
        if (revision == null || !revision.isJsonPrimitive() || !revision.getAsJsonPrimitive().isNumber() || revision.getAsDouble() != policy.get("revision").getAsLong())
          throw new Failure(ErrorCodes.POLICY_REVISION_CONFLICT, "The policy changed");
        if (!presetVersionIs(body, 1)) throw new Failure(ErrorCodes.POLICY_PRESET_VERSION_CONFLICT, "The preset changed");
        return savePolicy(policy, body, now, saved -> {
          saved.addProperty("followsPreset", enabled);
          if (enabled) {
            saved.addProperty("name", PRESET_NAMES.get(str(preset, "id")));
            saved.addProperty("description", "");
            saved.add("settings", policyBaselines.get(id).deepCopy());
          }
        });
      }
      default: throw unsupported(method, "/policies/" + id + (action.isEmpty() ? "" : "/" + action));
    }
  }

  private static boolean presetVersionIs(JsonObject body, long version) {
    JsonElement value = body.get("presetVersion");
    return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() && value.getAsDouble() == version;
  }

  private JsonObject assignPolicy(JsonObject body) throws Failure {
    JsonObject policy = policy(String.valueOf(str(body, "policyId")));
    projectPolicyId = str(policy, "id");
    return toPolicy(policy);
  }

  // ------------------------------------------------------------------ Lenses

  /** The lens fields a definition sets. */
  private static final List<String> LENS_FIELDS = List.of("name", "description", "type", "active", "transform");

  /**
   * Saves each definition in order, like the API: a new identifier creates a lens, an unchanged
   * definition returns the stored lens and a changed one updates it in place.
   */
  private JsonObject putLenses(JsonObject body) throws Failure {
    JsonElement definitions = body.get("lenses");
    if (definitions == null || !definitions.isJsonArray() || definitions.getAsJsonArray().isEmpty()) throw Failure.validation("validation/too-small", "lenses");
    JsonArray result = new JsonArray();
    for (JsonElement element : definitions.getAsJsonArray()) result.add(ensureLens(element.getAsJsonObject()));
    JsonObject answer = new JsonObject();
    answer.add("lenses", result);
    return answer;
  }

  private JsonObject ensureLens(JsonObject definition) {
    JsonObject existing = lenses.get(str(definition, "identifier"));
    if (existing == null) return saveNewLens(definition);
    JsonObject wanted = withLensDefaults(definition);
    boolean same = LENS_FIELDS.stream().allMatch(key -> canonical(existing.get(key)).equals(canonical(wanted.get(key))));
    if (same) return existing;
    JsonObject lens = existing.deepCopy();
    wanted.entrySet().forEach(e -> lens.add(e.getKey(), e.getValue().deepCopy()));
    lens.addProperty("updatedAt", now());
    lenses.put(str(lens, "identifier"), lens);
    return lens;
  }

  /** Like the API, a definition without {@code active} is an active lens. */
  private static JsonObject withLensDefaults(JsonObject definition) {
    JsonObject filled = definition.deepCopy();
    if (!filled.has("active") || filled.get("active").isJsonNull()) filled.addProperty("active", true);
    return filled;
  }

  private JsonObject saveNewLens(JsonObject definition) {
    JsonObject lens = new JsonObject();
    lens.addProperty("id", createId("lens"));
    lens.addProperty("projectId", projectId);
    withLensDefaults(definition).entrySet().forEach(e -> lens.add(e.getKey(), e.getValue().deepCopy()));
    long now = now();
    lens.addProperty("createdAt", now);
    lens.addProperty("updatedAt", now);
    lenses.put(str(lens, "identifier"), lens);
    return lens;
  }

  /** POST /projects/:id/lenses: a new lens, whose identifier must be new to the project. */
  private JsonObject createLens(JsonObject body) throws Failure {
    String identifier = str(body, "identifier");
    if (identifier == null || identifier.isEmpty()) throw Failure.validation("validation/invalid-type", "identifier");
    if (lenses.containsKey(identifier)) throw Failure.of(ErrorCodes.LENS_IDENTIFIER_TAKEN, Map.of("identifier", identifier));
    created = true;
    return saveNewLens(body);
  }

  private JsonObject lens(String id) throws Failure {
    for (JsonObject lens : lenses.values()) if (id.equals(str(lens, "id"))) return lens;
    throw new Failure(ErrorCodes.LENS_NOT_FOUND, "Lens not found");
  }

  private JsonElement lensRoute(String method, String id, JsonObject body) throws Failure, IOException {
    JsonObject lens = lens(id);
    switch (method) {
      case "GET": return lens;
      case "PATCH": {
        // The identifier can't change.
        JsonObject definition = lens.deepCopy();
        body.entrySet().forEach(e -> { if (!e.getKey().equals("identifier")) definition.add(e.getKey(), e.getValue().deepCopy()); });
        return ensureLens(definition);
      }
      case "DELETE":
        lenses.remove(str(lens, "identifier"));
        return null;
      default: throw unsupported(method, "/lenses/" + id);
    }
  }

  /** An event type's shape ({@code resource.action}), as the mock checks {@code types} without the catalog. */
  private static final Pattern EVENT_TYPE = Pattern.compile("[a-z][a-z-]*\\.[a-z][a-z-]*");

  /**
   * Cursors are {@code mock_<n>~<filters>}: the number of events in the feed when the cursor was
   * taken, and the filters it was issued with, since a cursor belongs to them as in the API.
   * Without a cursor the page is empty and its {@code nextCursor} is the current position.
   * {@code types} (one comma-separated value) and {@code assetId} keep only the matching events.
   */
  private JsonObject events(JsonObject q) throws Failure {
    long pageSize = bounded(q, "pageSize", DEFAULT_PAGE_SIZE, MAX_EVENTS_PAGE_SIZE);
    String typesValue = str(q, "types");
    List<String> types = typesValue == null ? List.of() : List.of(typesValue.split(",", -1));
    if (typesValue != null && types.stream().anyMatch(type -> !EVENT_TYPE.matcher(type).matches()))
      throw Failure.validation(ErrorCodes.INVALID_VALUE, "types");
    String assetId = str(q, "assetId");
    if (assetId != null && !ASSET_ID_PATTERN.matcher(assetId).matches()) throw Failure.validation(ErrorCodes.INVALID_FORMAT, "assetId");
    JsonArray filters = new JsonArray();
    JsonArray sortedTypes = new JsonArray();
    new java.util.TreeSet<>(types).forEach(sortedTypes::add);
    filters.add(sortedTypes);
    filters.add(assetId);
    String filter = Base64.getUrlEncoder().withoutPadding().encodeToString(filters.toString().getBytes(StandardCharsets.UTF_8));
    java.util.function.Predicate<JsonObject> matches = event ->
        (types.isEmpty() || types.contains(str(event, "type"))) && (assetId == null || assetId.equals(str(event, "assetId")));
    List<JsonObject> feed = storage.events.stream().filter(e -> projectId.equals(str(e, "projectId"))).collect(Collectors.toList());
    int position = feed.size();
    String cursor = str(q, "cursor");
    boolean continuing = cursor != null && !cursor.isEmpty();
    if (continuing) {
      Matcher match = Pattern.compile("mock_(\\d{1,9})~(.*)").matcher(cursor);
      if (!match.matches() || !match.group(2).equals(filter) || Integer.parseInt(match.group(1)) > feed.size())
        throw new Failure(ErrorCodes.INVALID_CURSOR, "The cursor is invalid or belongs to a different query.");
      position = Integer.parseInt(match.group(1));
    }
    JsonArray items = new JsonArray();
    int next = position;
    while (continuing && next < feed.size() && items.size() < pageSize) {
      JsonObject event = feed.get(next++);
      if (matches.test(event)) items.add(event);
    }
    JsonObject page = new JsonObject();
    page.add("items", items);
    page.addProperty("nextCursor", "mock_" + next + "~" + filter);
    page.addProperty("hasMore", feed.subList(next, feed.size()).stream().anyMatch(matches));
    // The mock's key holds every permission, so no event type is excluded.
    page.add("excludedTypes", new JsonArray());
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
    classification.add("testInput", path(asset, "classification.testInput"));
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

  /**
   * Serves an asset's resources like the CDN: {@code original} is the upload; {@code rendered} the
   * image, PDF, video or audio file {@code content.rendered} describes; {@code preview} the still
   * {@code content.preview} describes; and {@code placeholder} its ThumbHash as a PNG. The mock
   * converts nothing: an upload stands in for its rendered file, an image for its own preview, and
   * the placeholder PNG for a screenshot, page or waveform.
   */
  private Transport.Response cdn(MockCalmLensServerClient.Request request, List<String> parts) {
    String resource = parts.get(3);
    List<String> raw = new ArrayList<>();
    for (String part : request.url().split("\\?", 2)[0].substring(cdnBase.length()).split("/")) if (!part.isEmpty()) raw.add(part);
    String segment = raw.get(2);
    List<String> selectorPath = raw.subList(4, raw.size());
    Failure invalidTransform = new Failure(ErrorCodes.INVALID_TRANSFORM, 400, "Invalid transform selector");
    Failure noRenderedVersion = new Failure(ErrorCodes.NO_RENDERED_VERSION, 404, "This asset has no such resource");
    // Like the CDN, the selector after the resource is read as sent (still percent-encoded); the
    // original and the embed page take none. Beneath /hls/ are the stream's playlists and
    // segments, not a selector.
    CalmLensServerClient.TransformSelector selector;
    try {
      selector = CalmLensServerClient.parseTransformSelector(resource.equals("hls") ? "" : String.join("/", selectorPath));
    } catch (IllegalArgumentException invalid) {
      return error(invalidTransform);
    }
    boolean hasSelector = selector.lens() != null || selector.options() != null;
    if ((resource.equals("original") || resource.equals("embed") || resource.equals("info")) && hasSelector) return error(invalidTransform);
    Failure notFound = new Failure(ErrorCodes.ASSET_NOT_FOUND, 404, "Asset not found");
    if (!parts.get(1).equals(projectId)) return error(notFound);
    // Like the CDN, the asset is "ext:" and its URL-encoded external ID, a grant ("sig_…") or its ID.
    MockGrant grant = null;
    String assetId = null, externalId = null;
    if (segment.startsWith("sig_")) {
      grant = decodeMockGrant(segment);
      if (grant == null) return error(new Failure(ErrorCodes.SIGNED_URL_INVALID, 403, "The signed asset URL's grant is invalid"));
      if (grant.expiresAt() <= now()) return error(new Failure(ErrorCodes.SIGNED_URL_EXPIRED, 403, "The signed URL has expired"));
      assetId = grant.assetId();
    } else if (segment.startsWith("ext:")) {
      try {
        externalId = URLDecoder.decode(segment.substring("ext:".length()).replace("+", "%2B"), StandardCharsets.UTF_8);
      } catch (IllegalArgumentException undecodable) {
        return error(notFound);
      }
    } else {
      assetId = parts.get(2);
    }
    String wantedId = assetId, wantedExternalId = externalId;
    JsonObject asset = projectAssets().stream()
        .filter(a -> wantedId != null ? wantedId.equals(str(a, "id")) : !wantedExternalId.isEmpty() && wantedExternalId.equals(str(a, "externalId")))
        .findFirst().orElse(null);
    if (asset == null) return error(notFound);
    if (resource.equals("original") && grant != null && !grant.original())
      return error(new Failure(ErrorCodes.SIGNED_URL_ORIGINAL_NOT_GRANTED, 403, "This signed asset URL doesn't grant the original file"));
    Failure notAvailable = new Failure("asset/not-available", 403, "Asset is not available");
    String status = str(asset.getAsJsonObject("classification").getAsJsonObject("moderation"), "status");
    boolean isPublic = "public".equals(str(asset, "visibility"));
    String apiKey = request.header("X-Api-Key");
    JsonObject content = asset.getAsJsonObject("content");
    JsonObject rendered = content.get("rendered") instanceof JsonObject value ? value : null;
    JsonObject preview = content.get("preview") instanceof JsonObject value ? value : null;
    // Like the CDN, a private asset answers anyone without a grant or the project's API key as an
    // unknown asset does, whatever its state. Its placeholder is public.
    if (!isPublic && grant == null && apiKey == null && !resource.equals("placeholder") && !resource.equals("info")) return error(notFound);
    if (resource.equals("info")) return info(request, asset, grant != null || canDownload(str(asset, "folderId"), apiKey));
    // Like the CDN, a safety hold refuses every resource.
    if (held(asset)) return error(notAvailable);
    if (resource.equals("placeholder")) {
      // Like the CDN's placeholder handler: the preview's ThumbHash, public whatever the asset's
      // visibility or moderation status; refused for purged assets and assets without one (not yet
      // processed, without a preview, or content removed).
      String thumbhash = str(preview, "thumbhash");
      if (thumbhash == null || "purged".equals(status)) return error(notAvailable);
      return served(request, Thumbhash.toPng(Base64.getDecoder().decode(thumbhash)), "image/png", "Cache-Control",
          "public, max-age=3600", "Cache-Tag", "asset-" + str(asset, "id"), "ETag", "\"" + thumbhash + "\"");
    }
    // Like the CDN, delivery checks come first and refuse everyone: content still uploading,
    // blocked or purged, failed processing or removed content, and an original without its bytes.
    MockCalmLensServerClient.StoredContent stored = storage.content.get(str(asset, "id"));
    if ("uploading".equals(str(asset.getAsJsonObject("upload"), "status")) || "purged".equals(status) || "blocked".equals(status)
        || "failed".equals(str(asset.getAsJsonObject("classification"), "status"))
        || "removed".equals(str(content, "status")) || resource.equals("original") && stored == null)
      return error(notAvailable);
    // Then access: age-restricted assets need viewerClaims.ageConfirmed whatever the key, and
    // private assets need an API key with assets:download for the asset's folder.
    JsonObject claims = JsonParser.parseString(request.query().getOrDefault("viewerClaims", "{}")).getAsJsonObject();
    if ("age-restricted".equals(status) && !(claims.has("ageConfirmed") && claims.get("ageConfirmed").getAsBoolean()))
      return error(new Failure("viewer/age-confirmation-required", 403, "Age confirmation required"));
    boolean isPrivate = !isPublic;
    if (isPrivate && grant == null && !canDownload(str(asset, "folderId"), apiKey))
      return error(new Failure(ErrorCodes.PERMISSION_DENIED, 403, "This API key needs assets:download permission for this asset’s folder."));
    // The embed page shows any asset that may be delivered, as its viewer for the asset's type or a
    // notice that the type has none.
    if (resource.equals("embed")) {
      return served(request, MOCK_EMBED_HTML.getBytes(StandardCharsets.UTF_8), "text/html; charset=utf-8",
          "Cache-Control", !claims.isEmpty() ? "private, no-store" : (isPrivate ? "private" : "public") + ", max-age=3600",
          "Cache-Tag", "asset-" + str(asset, "id"), "X-Content-Type-Options", "nosniff");
    }
    // Then whether the asset has the resource (the mock prepares no HLS stream), and whether it is
    // a still image that takes a lens or transform: the preview always is, the rendered file only
    // when it is an image.
    if (resource.equals("rendered") && rendered == null || resource.equals("preview") && preview == null || resource.equals("hls"))
      return error(noRenderedVersion);
    boolean renderedImage = rendered != null && "image".equals(str(rendered, "kind"));
    boolean stillImage = resource.equals("preview") || resource.equals("rendered") && renderedImage;
    if (!stillImage && hasSelector) return error(invalidTransform);
    // Then the options, checked against the transform schema once the asset may be served.
    if (selector.options() != null) {
      CalmLensServerClient.TransformProblems problems = CalmLensServerClient.checkTransformOptions(selector.options());
      if (!problems.isEmpty()) {
        List<String> keys = new ArrayList<>(problems.unknownKeys());
        keys.addAll(problems.invalidKeys());
        return error(new Failure(ErrorCodes.INVALID_TRANSFORM_OPTIONS, 400, "Invalid transform options: " + String.join(", ", keys)));
      }
    }
    // The bytes: the upload, which stands in for its own rendered file and an image's preview, or
    // the placeholder PNG for a still the mock doesn't make.
    boolean image = "image".equals(str(asset, "type"));
    boolean servesUpload = resource.equals("original") || resource.equals("rendered") && !renderedImage || image;
    byte[] bytes;
    String type;
    if (servesUpload) {
      if (stored == null) return error(notAvailable);
      bytes = stored.bytes();
      type = resource.equals("rendered") && rendered != null ? str(rendered, "format")
          : stored.type() == null || stored.type().isEmpty() ? "application/octet-stream" : stored.type();
    } else {
      String thumbhash = str(preview, "thumbhash");
      bytes = Thumbhash.toPng(Base64.getDecoder().decode(thumbhash == null ? MOCK_THUMBHASH : thumbhash));
      type = "image/png";
    }
    boolean immutable = stillImage || resource.equals("original") && image;
    List<String> headers = new ArrayList<>(List.of(
        // Like the CDN: a still image's bytes are immutable for a year, other content is kept for
        // an hour, publicly only when delivery is public.
        "Cache-Control", !claims.isEmpty() ? "private, no-store" : (isPrivate ? "private" : "public") + ", " + (immutable ? "max-age=31536000, immutable" : "max-age=3600"),
        "Cache-Tag", "asset-" + str(asset, "id")));
    if (immutable) {
      headers.addAll(List.of("ETag", "\"" + str(asset, "id") + "\"",
          "Expires", DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.ofEpochMilli(now() + 31536000L * 1000).atOffset(ZoneOffset.UTC))));
    }
    headers.addAll(List.of("X-Content-Type-Options", "nosniff", "Content-Security-Policy", "sandbox; default-src 'none'"));
    if (isActiveContentType(type)) headers.addAll(List.of("Content-Disposition", "attachment"));
    return served(request, bytes, type, headers.toArray(String[]::new));
  }

  /**
   * The display info at {@code /info}, like the CDN's: the allowlisted fields and whether the
   * viewer the claims describe can see the content, decided as the other resources decide it. A
   * private asset's needs a grant or an API key with {@code assets:download}.
   */
  private Transport.Response info(MockCalmLensServerClient.Request request, JsonObject asset, boolean authorised) {
    if (!"public".equals(str(asset, "visibility")) && !authorised)
      return error(new Failure("asset/not-found", 404, "Asset not found"));
    JsonObject claims;
    try {
      claims = JsonParser.parseString(request.query().getOrDefault("viewerClaims", "{}")).getAsJsonObject();
    } catch (RuntimeException invalid) {
      return error(new Failure(ErrorCodes.INVALID_VIEWER_CLAIMS, 400, "Invalid viewer claims"));
    }
    String status = str(asset.getAsJsonObject("classification").getAsJsonObject("moderation"), "status");
    JsonObject content = asset.getAsJsonObject("content");
    String availability = held(asset) || "uploading".equals(str(asset.getAsJsonObject("upload"), "status"))
        || "blocked".equals(status) || "purged".equals(status) || "failed".equals(str(asset.getAsJsonObject("classification"), "status"))
        || "removed".equals(str(content, "status")) ? "unavailable"
        : "age-restricted".equals(status) && !(claims.get("ageConfirmed") instanceof JsonPrimitive confirmed && confirmed.isBoolean() && confirmed.getAsBoolean())
        ? "age-restricted" : "available";
    JsonObject shown = new JsonObject();
    for (String key : List.of("format", "width", "height", "durationSeconds", "pageCount", "rendered", "preview", "hls"))
      shown.add(key, Objects.requireNonNullElse(content.get(key), JsonNull.INSTANCE));
    JsonObject info = new JsonObject();
    info.add("id", asset.get("id"));
    info.add("projectId", asset.get("projectId"));
    info.add("type", asset.get("type"));
    info.add("externalUrl", Objects.requireNonNullElse(asset.get("externalUrl"), JsonNull.INSTANCE));
    info.add("content", shown);
    info.addProperty("availability", availability);
    return served(request, Json.write(info).getBytes(StandardCharsets.UTF_8), "application/json",
        "Cache-Control", ("public".equals(str(asset, "visibility")) ? "public" : "private") + ", max-age=60",
        "Cache-Tag", "asset-" + str(asset, "id"));
  }

  /** A 200 CDN response with its length and request ID; {@code HEAD} gets no body. */
  private static Transport.Response served(MockCalmLensServerClient.Request request, byte[] bytes, String type, String... headers) {
    Transport.Response response = respond(200, type, bytes, headers);
    return request.method().equals("HEAD") ? new Transport.Response(200, response.headers(), new byte[0]) : response;
  }

  private boolean canDownload(String folderId, String apiKey) {
    // A request without the API key, as a browser sends it, has no grants.
    if (apiKey == null) return false;
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
