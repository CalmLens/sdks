package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.*;
import com.calmlens.internal.Json;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.*;
import com.calmlens.params.*;
import com.calmlens.testing.*;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Replays testdata/client-cases.json and surface.json's defaults (packages/sdk-contract/README.md,
 * "Scripted client cases"); {@link ContractTest} replays the other fixtures, all read through
 * {@link Fixtures#read}. Each client case drives the real client through a scripted transport and
 * checks every request it sends, the waits between attempts and what it returns or raises.
 */
class ClientCasesTest {
  /** Client options the Java builder's types cannot hold: the type itself refuses the value. */
  private static final Map<String, String> OPTIONS_REJECTED_BY_TYPE = Map.of(
      "a fractional maxRetries is refused before any request", "Builder.maxRetries takes an int, which cannot hold 1.5");

  /**
   * Scripted responses whose items the Java models cannot hold, so only how many items the call
   * returned is compared: the typed record drops the fixture's fields.
   */
  private static final Map<String, String> ITEMS_THE_MODEL_CANNOT_HOLD = Map.of(
      "assets.iterateTimeline follows nextCursor across pages, keeping the options", "MediaClassificationSegment has no id");

  private static final Pattern UUID_V4 = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);

  private record Received(String method, URI uri, Map<String, String> headers, byte[] body) {}

  /** A failing iteration, with what it yielded first. */
  private static final class IterationFailed extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final transient JsonArray partial;
    final CalmLensException error;

    IterationFailed(JsonArray partial, CalmLensException error) {
      super(error);
      this.partial = partial;
      this.error = error;
    }
  }

  /** surface.json defaults: the client defaults every SDK follows, and the client cases that observe each. */
  @TestFactory Stream<DynamicTest> clientDefaultsMatchTheSurface() throws Exception {
    JsonObject surface = Fixtures.read("surface.json").getAsJsonObject();
    java.util.Set<String> caseNames = new java.util.HashSet<>();
    Fixtures.read("client-cases.json").getAsJsonObject().getAsJsonArray("cases").forEach(c -> caseNames.add(c.getAsJsonObject().get("name").getAsString()));
    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1").build();
    Map<String, Object> values = new HashMap<>();
    values.put("baseUrl", client.getBaseUrl());
    values.put("cdnBaseUrl", client.getCdnBaseUrl());
    values.put("timeoutMs", client.getTimeout().toMillis());
    values.put("uploadTimeoutMs", client.getUploadTimeout().orElse(null));
    values.put("maxRetries", (long) client.getMaxRetries());
    values.put("retryBaseDelayMs", CalmLensServerClient.RETRY_BASE_DELAY.toMillis());
    values.put("retryMaxDelayMs", CalmLensServerClient.RETRY_MAX_DELAY.toMillis());
    values.put("retryAfterMaxMs", CalmLensServerClient.RETRY_AFTER_MAX.toMillis());
    values.put("maxResponseBytes", client.getMaxResponseBytes());
    values.put("signedUrlExpiresIn", CalmLensServerClient.DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS);
    values.put("uploadTokenExpiresInSeconds", (long) CalmLensServerClient.DEFAULT_UPLOAD_TOKEN_EXPIRES_IN_SECONDS);
    values.put("waitForDecisionTimeoutMs", CalmLensServerClient.DEFAULT_DECISION_TIMEOUT.toMillis());
    values.put("waitForDecisionFirstIntervalMs", CalmLensServerClient.DECISION_POLL_FIRST_DELAY.toMillis());
    values.put("waitForDecisionIntervalFactor", CalmLensServerClient.DECISION_POLL_DELAY_FACTOR);
    values.put("waitForDecisionMaxIntervalMs", CalmLensServerClient.DECISION_POLL_MAX_DELAY.toMillis());
    values.put("ensureLensesBatchSize", (long) CalmLensServerClient.ENSURE_LENSES_MAX_PER_REQUEST);
    values.put("partSizeBytes", client.getPartSizeBytes());
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonElement element : surface.getAsJsonArray("defaults")) {
      JsonObject entry = element.getAsJsonObject();
      String id = entry.get("id").getAsString();
      tests.add(DynamicTest.dynamicTest(id, () -> {
        assertTrue(values.containsKey(id), id + " is known");
        assertEquals(ContractTest.normalize(entry.get("value")), ContractTest.tree(values.get(id)), id);
        for (JsonElement name : entry.getAsJsonArray("observedBy")) assertTrue(caseNames.contains(name.getAsString()), name.getAsString());
      }));
    }
    assertFalse(tests.isEmpty(), "surface.json has no defaults");
    return tests.stream();
  }

  @TestFactory Stream<DynamicTest> clientCases() throws Exception { return clientCases(false); }

  /** The client cases again through {@link CalmLensServerClient#async()}, with the same results. */
  @TestFactory Stream<DynamicTest> clientCasesThroughTheAsyncClient() throws Exception { return clientCases(true); }

  private static Stream<DynamicTest> clientCases(boolean async) throws Exception {
    JsonObject fixture = Fixtures.read("client-cases.json").getAsJsonObject();
    Map<String, JsonObject> capabilities = new HashMap<>();
    Fixtures.read("surface.json").getAsJsonObject().getAsJsonArray("capabilities")
        .forEach(c -> capabilities.put(c.getAsJsonObject().get("id").getAsString(), c.getAsJsonObject()));
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonElement element : fixture.getAsJsonArray("cases")) {
      JsonObject clientCase = element.getAsJsonObject();
      String name = clientCase.get("name").getAsString();
      tests.add(DynamicTest.dynamicTest(clientCase.get("area").getAsString() + ": " + name, () -> {
        if (clientCase.has("requires")) {
          JsonObject capability = capabilities.get(clientCase.get("requires").getAsString());
          assertNotNull(capability, "requires unknown capability " + clientCase.get("requires"));
          String reason = ContractTest.notApplicable(capability);
          if (reason != null) {
            System.out.println("Skipping " + name + " (not applicable: " + reason + ")");
            Assumptions.abort("not applicable: " + reason);
          }
        }
        run(fixture, clientCase, async);
      }));
    }
    assertFalse(tests.isEmpty());
    return tests.stream();
  }

  private static void run(JsonObject fixture, JsonObject clientCase, boolean async) throws Exception {
    String name = clientCase.get("name").getAsString();
    JsonObject options = fixture.getAsJsonObject("client").deepCopy();
    if (clientCase.has("client")) clientCase.getAsJsonObject("client").entrySet().forEach(e -> options.add(e.getKey(), e.getValue()));
    if (OPTIONS_REJECTED_BY_TYPE.containsKey(name)) {
      JsonElement value = options.get("maxRetries");
      assertNotEquals(value.getAsDouble(), Math.floor(value.getAsDouble()), OPTIONS_REJECTED_BY_TYPE.get(name));
      assertEquals(0, clientCase.getAsJsonArray("requests").size());
      return;
    }
    JsonArray responses = clientCase.getAsJsonArray("responses");
    int cancelAfter = clientCase.has("cancelAfterRequests") ? clientCase.get("cancelAfterRequests").getAsInt() : -1;
    List<Received> received = new ArrayList<>();
    List<Long> sleeps = new ArrayList<>();
    long[] slept = {0};
    Transport transport = request -> {
      byte[] body;
      if (request.body() == null) body = new byte[0];
      else try (InputStream in = request.body().open()) { body = in.readAllBytes(); }
      received.add(new Received(request.method(), request.uri(), request.headers(), body));
      int count = received.size();
      if (count > responses.size()) throw new AssertionError(name + ": request " + count + " has no scripted response");
      JsonObject scripted = responses.get(count - 1).getAsJsonObject();
      if (count == cancelAfter) {
        // The call is cancelled while this request's response hangs.
        Thread.currentThread().interrupt();
        throw new InterruptedException("cancelled");
      }
      if (scripted.has("hang")) {
        assertNotNull(request.timeout(), name + ": a hanging request needs a deadline");
        Thread.sleep(request.timeout().toMillis());
        throw new HttpTimeoutException("request timed out");
      }
      if (scripted.has("transportError")) throw new ConnectException("Connection reset");
      Map<String, List<String>> headers = new HashMap<>();
      if (scripted.has("headers")) scripted.getAsJsonObject("headers").entrySet().forEach(h -> headers.put(h.getKey(), List.of(h.getValue().getAsString())));
      int status = scripted.has("status") ? scripted.get("status").getAsInt() : 200;
      byte[] bytes = scripted.has("body") ? Json.write(scripted.get("body")).getBytes(StandardCharsets.UTF_8)
          : scripted.has("bodyBase64") ? Base64.getDecoder().decode(scripted.get("bodyBase64").getAsString())
          : scripted.has("bodyText") ? scripted.get("bodyText").getAsString().getBytes(StandardCharsets.UTF_8) : new byte[0];
      return new Transport.Response(status, headers, bytes);
    };

    CalmLensServerClient client = null;
    CalmLensException constructionError = null;
    List<RequestEvent> attempts = new ArrayList<>();
    List<String> logLines = new ArrayList<>();
    // The environment can't be set in Java; fromEnv's system properties stand for it, and an empty
    // property hides a variable the machine happens to have.
    Map<String, String> properties = Map.of("CALMLENS_API_KEY", "calmlens.apiKey", "CALMLENS_PROJECT_ID", "calmlens.projectId",
        "CALMLENS_BASE_URL", "calmlens.baseUrl");
    boolean fromEnv = clientCase.has("clientFromEnv") && clientCase.get("clientFromEnv").getAsBoolean();
    Map<String, String> saved = new HashMap<>();
    if (clientCase.has("env") || fromEnv) {
      JsonObject env = clientCase.has("env") ? clientCase.getAsJsonObject("env") : new JsonObject();
      properties.forEach((variable, property) -> {
        saved.put(property, System.getProperty(property));
        System.setProperty(property, env.has(variable) ? env.get(variable).getAsString() : "");
      });
    }
    try {
      CalmLensServerClient.Builder builder = CalmLensServerClient.builder();
      if (fromEnv) builder.fromEnv();
      else {
        if (string(options, "apiKey") != null) builder.apiKey(string(options, "apiKey"));
        if (string(options, "projectId") != null) builder.projectId(string(options, "projectId"));
      }
      if (options.has("appInfo")) {
        JsonObject app = options.getAsJsonObject("appInfo");
        builder.appInfo(app.get("name").getAsString(), string(app, "version"), string(app, "url"));
      }
      builder.requestListener(attempts::add);
      if (clientCase.has("logs")) {
        builder.logLevel(clientCase.getAsJsonObject("logs").get("level").getAsString());
        builder.logger(new CapturingLogger(logLines));
      }
      if (options.has("baseUrl")) builder.baseUrl(options.get("baseUrl").getAsString());
      if (options.has("cdnBaseUrl")) builder.cdnBaseUrl(options.get("cdnBaseUrl").getAsString());
      if (options.has("maxRetries")) builder.maxRetries(options.get("maxRetries").getAsInt());
      if (options.has("timeoutMs")) builder.timeout(Duration.ofMillis(options.get("timeoutMs").getAsLong()));
      if (options.has("maxResponseBytes")) builder.maxResponseBytes(options.get("maxResponseBytes").getAsLong());
      if (options.has("partSizeBytes")) builder.partSizeBytes(options.get("partSizeBytes").getAsLong());
      // Waits are recorded and skipped; the client's clock moves on by each one.
      client = com.calmlens.internal.ClientAccess.Holder.get().build(builder, transport, delay -> { sleeps.add(delay.toMillis()); slept[0] += delay.toNanos(); },
          () -> System.nanoTime() + slept[0], CalmLensServerClient.DEFAULT_MAX_RETRIES, false);
    } catch (CalmLensException refused) {
      constructionError = refused;
    } finally {
      saved.forEach((property, value) -> { if (value == null) System.clearProperty(property); else System.setProperty(property, value); });
    }

    try {
      int index = 0;
      for (JsonElement stepElement : clientCase.getAsJsonArray("steps")) {
        JsonObject step = stepElement.getAsJsonObject();
        String operation = step.get("operation").getAsString();
        String label = name + ": step " + ++index + " (" + operation + ")";
        JsonObject expect = step.has("expect") ? step.getAsJsonObject("expect") : new JsonObject();
        Object result = null;
        Throwable error = constructionError;
        if (error == null) {
          try {
            RequestOptions callOptions = step.has("requestOptions") ? requestOptions(step.getAsJsonObject("requestOptions")) : null;
            result = invoke(client, operation, step.has("args") ? step.getAsJsonObject("args") : new JsonObject(), async, callOptions);
          } catch (Throwable thrown) {
            error = thrown;
          }
        }
        if (expect.has("error")) {
          JsonArray partial = error instanceof IterationFailed failed ? failed.partial : null;
          Throwable cause = error instanceof IterationFailed failed ? failed.error : error;
          if (!(cause instanceof CalmLensException failure)) throw new AssertionError(label + ": expected an error, got " + cause, cause);
          JsonObject want = expect.getAsJsonObject("error").deepCopy();
          JsonObject actual = Fixtures.errorFields(failure);
          JsonElement retryAfter = want.get("retryAfter");
          if (retryAfter.isJsonObject() && retryAfter.getAsJsonObject().has("$gte")) {
            assertFalse(actual.get("retryAfter").isJsonNull(), label + ": retryAfter");
            assertTrue(actual.get("retryAfter").getAsLong() >= retryAfter.getAsJsonObject().get("$gte").getAsLong(), label + ": retryAfter");
            want.remove("retryAfter");
            actual.remove("retryAfter");
          }
          assertEquals(want, actual, label);
          if (expect.has("partialResult")) Fixtures.assertMatches(expect.get("partialResult"), partial, label + ": yielded");
          break;
        }
        if (error != null) throw new AssertionError(label + ": " + error, error);
        if (expect.has("cdn")) {
          JsonObject cdn = expect.getAsJsonObject("cdn");
          try (CdnResponse response = (CdnResponse) result) {
            JsonObject actual = new JsonObject();
            actual.addProperty("status", response.status());
            JsonObject headers = new JsonObject();
            for (String header : cdn.getAsJsonObject("headers").keySet()) {
              String value = response.header(header);
              headers.add(header, value == null ? JsonNull.INSTANCE : new JsonPrimitive(value));
            }
            actual.add("headers", headers);
            actual.addProperty("bodyBase64", Base64.getEncoder().encodeToString(response.readAllBytes(Integer.MAX_VALUE - 16)));
            assertEquals(cdn, actual, label);
          }
        } else {
          if (expect.has("lastResponse")) {
            JsonObject last = new JsonObject();
            ApiResponse response = result instanceof RawResponse raw ? null : ((CalmLensObject) result).getLastResponse().orElseThrow();
            last.addProperty("status", response.getStatus());
            last.addProperty("requestId", response.getRequestId().orElse(null));
            last.addProperty("idempotencyKey", response.getIdempotencyKey().orElse(null));
            assertEquals(expect.get("lastResponse"), Fixtures.WITH_NULLS.toJsonTree(last), label + ": lastResponse");
          }
          JsonElement want = expect.has("result") ? expect.get("result") : JsonNull.INSTANCE;
          JsonElement actual = result instanceof JsonElement json ? json : ContractTest.tree(result);
          if (ITEMS_THE_MODEL_CANNOT_HOLD.containsKey(name))
            assertEquals(want.getAsJsonArray().size(), actual.getAsJsonArray().size(), label + ": " + ITEMS_THE_MODEL_CANNOT_HOLD.get(name));
          else Fixtures.assertMatches(want, actual, label);
        }
      }
    } finally {
      // A cancelled call keeps the interrupt flag, as the client promises; clear it for the next case.
      Thread.interrupted();
    }

    JsonArray wanted = clientCase.getAsJsonArray("requests");
    assertEquals(wanted.size(), received.size(), name + ": requests sent");
    Map<String, String> uuids = new HashMap<>();
    JsonObject every = fixture.getAsJsonObject("everyRequest").getAsJsonObject("headers").deepCopy();
    // A case's own API key is the one every request carries.
    if (string(options, "apiKey") != null && every.has("x-api-key")) every.addProperty("x-api-key", string(options, "apiKey"));
    for (int i = 0; i < wanted.size(); i++) {
      JsonObject want = wanted.get(i).getAsJsonObject();
      Received got = received.get(i);
      String label = name + ": request " + (i + 1);
      URI uri = got.uri();
      String origin = uri.getScheme() + "://" + uri.getHost() + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
      assertEquals(want.get("method").getAsString(), got.method(), label + ": method");
      assertEquals(want.get("origin").getAsString(), origin, label + ": origin");
      assertEquals(want.get("path").getAsString(), uri.getRawPath(), label + ": path");
      // Queries compare decoded with form rules, as the API's parser reads them; pair order is free.
      assertEquals(sorted(want.getAsJsonArray("query")), sorted(pairs(uri.getRawQuery())), label + ": query");
      assertEquals(sorted(want.getAsJsonArray("query")), sorted(pairs(want.get("rawQuery").getAsString())), label + ": rawQuery");
      JsonObject headers = every.deepCopy();
      want.getAsJsonObject("headers").entrySet().forEach(e -> headers.add(e.getKey(), e.getValue()));
      for (Map.Entry<String, JsonElement> header : headers.entrySet())
        checkHeader(label, header.getKey(), header(got.headers(), header.getKey()), header.getValue(), uuids);
      if (want.has("body")) {
        if (want.get("body").isJsonNull()) assertEquals(0, got.body().length, label + ": no body");
        else assertEquals(want.get("body"), JsonParser.parseString(new String(got.body(), StandardCharsets.UTF_8)), label + ": body");
      } else if (want.has("form")) {
        // An upload form: exactly an options part, then a file part, under the request's boundary.
        JsonObject form = want.getAsJsonObject("form");
        UploadForm.Parsed parsed = UploadForm.read(got.body(), header(got.headers(), "Content-Type"));
        assertEquals(form.get("options"), JsonParser.parseString(parsed.options()), label + ": options");
        JsonObject file = form.getAsJsonObject("file");
        assertEquals(file.get("contentType").isJsonNull() ? null : file.get("contentType").getAsString(), parsed.fileType(), label + ": file type");
        assertRawBody(file, parsed.file(), label + ": file");
      } else assertRawBody(want, got.body(), label + ": body");
    }
    if (clientCase.has("attempts")) {
      JsonArray seen = new JsonArray();
      for (RequestEvent event : attempts) {
        JsonObject item = new JsonObject();
        item.add("operation", event.getOperation().<JsonElement>map(JsonPrimitive::new).orElse(JsonNull.INSTANCE));
        item.addProperty("method", event.getMethod());
        item.addProperty("path", event.getPath());
        item.addProperty("attempt", event.getAttempt());
        item.add("delayMs", event.getDelay().<JsonElement>map(d -> new JsonPrimitive(d.toMillis())).orElse(JsonNull.INSTANCE));
        item.addProperty("status", event.getStatus());
        item.add("requestId", event.getRequestId().<JsonElement>map(JsonPrimitive::new).orElse(JsonNull.INSTANCE));
        item.add("errorCode", event.getErrorCode().<JsonElement>map(JsonPrimitive::new).orElse(JsonNull.INSTANCE));
        seen.add(item);
      }
      assertEquals(clientCase.get("attempts"), seen, name + ": attempts");
    }
    if (clientCase.has("logs")) {
      assertFalse(logLines.isEmpty(), name + ": the client logged nothing");
      for (JsonElement secret : clientCase.getAsJsonObject("logs").getAsJsonArray("mustNotContain"))
        for (String line : logLines) assertFalse(line.contains(secret.getAsString()), name + ": a log line holds " + secret);
    }
    if (clientCase.has("sleepsMs")) {
      JsonArray expected = clientCase.getAsJsonArray("sleepsMs");
      assertEquals(expected.size(), sleeps.size(), name + ": waits " + sleeps);
      for (int i = 0; i < expected.size(); i++) {
        JsonElement sleep = expected.get(i);
        long actual = sleeps.get(i);
        if (sleep.isJsonArray())
          assertTrue(actual >= sleep.getAsJsonArray().get(0).getAsLong() && actual <= sleep.getAsJsonArray().get(1).getAsLong(), name + ": wait " + (i + 1) + " " + actual + " in " + sleep);
        else assertEquals(sleep.getAsLong(), actual, name + ": wait " + (i + 1));
      }
    }
  }

  /** Compares raw bytes with {@code bodyLength}, {@code bodySha256} and, when given, {@code bodyBase64}. */
  private static void assertRawBody(JsonObject want, byte[] bytes, String label) throws Exception {
    assertEquals(want.get("bodyLength").getAsLong(), bytes.length, label + " length");
    assertEquals(want.get("bodySha256").getAsString(), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)), label + " SHA-256");
    if (want.has("bodyBase64")) assertEquals(want.get("bodyBase64").getAsString(), Base64.getEncoder().encodeToString(bytes), label);
  }

  private static String string(JsonObject options, String key) {
    return options.has(key) && !options.get(key).isJsonNull() ? options.get(key).getAsString() : null;
  }

  private static String header(Map<String, String> headers, String name) {
    return headers.entrySet().stream().filter(e -> e.getKey().equalsIgnoreCase(name)).map(Map.Entry::getValue).findFirst().orElse(null);
  }

  /** Checks one header against its expectation; {@code $uuid} labels map one-to-one to values. */
  private static void checkHeader(String label, String name, String actual, JsonElement expected, Map<String, String> uuids) {
    if (expected.isJsonObject() && expected.getAsJsonObject().has("$absent")) assertNull(actual, label + ": " + name + " is absent");
    else if (expected.isJsonObject() && expected.getAsJsonObject().has("$regex"))
      assertTrue(actual != null && Pattern.compile(expected.getAsJsonObject().get("$regex").getAsString()).matcher(actual).find(), label + ": " + name + " " + actual);
    else if (expected.isJsonObject() && expected.getAsJsonObject().has("$uuid")) {
      assertTrue(actual != null && UUID_V4.matcher(actual).matches(), label + ": " + name + " is a UUID: " + actual);
      String tag = expected.getAsJsonObject().get("$uuid").getAsString();
      String known = uuids.get(tag);
      if (known == null) {
        assertFalse(uuids.containsValue(actual), label + ": " + name + " is a new value");
        uuids.put(tag, actual);
      } else assertEquals(known, actual, label + ": " + name + " reuses " + tag);
    } else assertEquals(expected.getAsString(), actual, label + ": " + name);
  }

  private static List<String> pairs(String rawQuery) {
    List<String> pairs = new ArrayList<>();
    if (rawQuery == null || rawQuery.isEmpty()) return pairs;
    for (String pair : rawQuery.split("&")) {
      if (pair.isEmpty()) continue;
      String[] parts = pair.split("=", 2);
      pairs.add(URLDecoder.decode(parts[0], StandardCharsets.UTF_8) + "\u0000" + (parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : ""));
    }
    return pairs;
  }

  private static List<String> sorted(JsonArray pairs) {
    List<String> list = new ArrayList<>();
    pairs.forEach(pair -> list.add(pair.getAsJsonArray().get(0).getAsString() + "\u0000" + pair.getAsJsonArray().get(1).getAsString()));
    list.sort(null);
    return list;
  }

  private static List<String> sorted(List<String> pairs) {
    List<String> list = new ArrayList<>(pairs);
    list.sort(null);
    return list;
  }

  // ------------------------------------------------------------------ Operations

  /** Every item an iterable yields as JSON; a failure carries what was yielded first. */
  private static JsonArray collect(Iterable<?> items) {
    JsonArray all = new JsonArray();
    Iterator<?> iterator = items.iterator();
    try {
      while (iterator.hasNext()) all.add(ContractTest.tree(iterator.next()));
    } catch (CalmLensException failure) {
      throw new IterationFailed(all, failure);
    }
    return all;
  }

  /**
   * Content or a part with the fixture's byte markers: {@code uint8Array}/{@code buffer} ({@code
   * $bytes} or {@code $fill}) are the SDK's byte input and {@code data} ({@code $stream}) its
   * one-shot stream input.
   */
  private static Content content(JsonObject json) {
    JsonObject plain = json.deepCopy();
    byte[] bytes = null;
    byte[] stream = null;
    for (String key : List.of("uint8Array", "buffer")) {
      if (!plain.has(key)) continue;
      bytes = bytes(plain.remove(key).getAsJsonObject());
    }
    if (plain.has("data")) stream = bytes(plain.remove("data").getAsJsonObject());
    Content content = Json.GSON.fromJson(plain, Content.class);
    try {
      if (bytes != null) setField(content, "data", bytes);
      if (stream != null) setField(content, "stream", new ByteArrayInputStream(stream));
    } catch (ReflectiveOperationException unreachable) {
      throw new IllegalStateException(unreachable);
    }
    return content;
  }

  private static byte[] bytes(JsonObject marker) {
    if (marker.has("$bytes")) return Base64.getDecoder().decode(marker.get("$bytes").getAsString());
    if (marker.has("$stream")) return Base64.getDecoder().decode(marker.get("$stream").getAsString());
    JsonObject fill = marker.getAsJsonObject("$fill");
    byte[] filled = new byte[fill.get("length").getAsInt()];
    Arrays.fill(filled, (byte) fill.get("byte").getAsInt());
    return filled;
  }

  /** A step's request options, from their JavaScript names. */
  private static RequestOptions requestOptions(JsonObject json) {
    RequestOptions.Builder options = RequestOptions.builder();
    if (json.has("timeoutMs")) options.setTimeout(Duration.ofMillis(json.get("timeoutMs").getAsLong()));
    if (json.has("maxRetries")) options.setMaxRetries(json.get("maxRetries").getAsInt());
    if (json.has("idempotencyKey")) options.setIdempotencyKey(json.get("idempotencyKey").getAsString());
    if (json.has("headers")) json.getAsJsonObject("headers").entrySet().forEach(e -> options.putHeader(e.getKey(), e.getValue().getAsString()));
    if (json.has("extraQuery")) json.getAsJsonObject("extraQuery").entrySet().forEach(e -> options.putExtraQuery(e.getKey(), Json.GSON.fromJson(e.getValue(), Object.class)));
    if (json.has("extraBody")) json.getAsJsonObject("extraBody").entrySet().forEach(e -> options.putExtraBody(e.getKey(), Json.GSON.fromJson(e.getValue(), Object.class)));
    return options.build();
  }

  /** Collects what the client logs, at every level it asks for. */
  private static final class CapturingLogger implements System.Logger {
    private final List<String> lines;

    CapturingLogger(List<String> lines) { this.lines = lines; }

    @Override public String getName() { return "capture"; }
    @Override public boolean isLoggable(Level level) { return true; }
    @Override public void log(Level level, java.util.ResourceBundle bundle, String message, Throwable thrown) { lines.add(message); }
    @Override public void log(Level level, java.util.ResourceBundle bundle, String format, Object... params) {
      lines.add(params == null || params.length == 0 ? format : java.text.MessageFormat.format(format, params));
    }
  }

  private static Object invoke(CalmLensServerClient client, String operation, JsonObject args, boolean async, RequestOptions stepOptions) throws Throwable {
    JsonObject options = args.deepCopy();
    RequestOptions request = stepOptions;
    if (options.has("idempotencyKey")) {
      String key = options.remove("idempotencyKey").getAsString();
      request = (request == null ? RequestOptions.builder() : request.toBuilder()).setIdempotencyKey(key).build();
    }
    if (request != null && !request.isEmpty() && !operation.equals("request")) {
      // A step's own options apply to that call only: through a client derived for it.
      client = request.getIdempotencyKey().isPresent() ? client : client.withRequestOptions(request);
    }
    Object root = async ? client.async() : client;
    switch (operation) {
      case "request": {
        RequestOptions.Builder raw = request == null ? RequestOptions.builder() : request.toBuilder();
        if (options.has("headers")) options.getAsJsonObject("headers").entrySet().forEach(e -> raw.putHeader(e.getKey(), e.getValue().getAsString()));
        Map<String, Object> query = options.has("query") ? Json.GSON.fromJson(options.get("query"), new com.google.gson.reflect.TypeToken<Map<String, Object>>() {}.getType()) : null;
        Object result = call(root, "request", options.get("method").getAsString(), options.get("path").getAsString(), query,
            options.has("body") ? options.get("body") : null, raw.build());
        return ((RawResponse) result).getBody();
      }
      case "assets.create", "assets.classify": {
        JsonObject content = options.has("content") ? options.remove("content").getAsJsonObject() : null;
        JsonObject part = options.has("part") ? options.remove("part").getAsJsonObject() : null;
        AssetCreateParams submit = Fixtures.decode(options, AssetCreateParams.class);
        if (content != null) setField(submit, "content", content(content));
        if (part != null) setField(submit, "part", content(part));
        return call(resource(root, "assets"), operation.substring("assets.".length()), submit, request);
      }
      case "assets.uploadPart": {
        JsonObject part = options.remove("part").getAsJsonObject();
        String assetId = options.has("assetId") ? options.remove("assetId").getAsString() : null;
        AssetUploadPartParams upload = Fixtures.decode(options, AssetUploadPartParams.class);
        setField(upload, "part", content(part));
        return call(resource(root, "assets"), "uploadPart", assetId, upload, request);
      }
      case "text.classify":
        return call(resource(root, "text"), "classify", Fixtures.decode(options, TextClassifyParams.class), request);
      case "cdn.serve": return call(resource(root, "cdn"), "serve", Fixtures.decode(options, CdnRequestParams.class), null);
      default: {
        // The async client has no lazy iterators: they run on the synchronous one.
        Object result = Fixtures.invoke(client, operation, options, async && !Fixtures.isIterator(operation));
        // Every list's iterator yields its items in order.
        return Fixtures.isIterator(operation) ? collect((Iterable<?>) result) : result;
      }
    }
  }

  private static Object resource(Object root, String name) throws ReflectiveOperationException { return root.getClass().getMethod(name).invoke(root); }

  /** Calls {@code name} on {@code target} with {@code args} (the last one {@link RequestOptions}), waiting for a future's result. */
  private static Object call(Object target, String name, Object... args) throws Throwable {
    for (java.lang.reflect.Method method : target.getClass().getMethods()) {
      if (!method.getName().equals(name) || method.getParameterCount() != args.length) continue;
      if (method.getParameterTypes()[args.length - 1] != RequestOptions.class) continue;
      try {
        Object result = method.invoke(target, args);
        if (result instanceof java.util.concurrent.CompletableFuture<?> future) {
          try {
            return future.get(30, java.util.concurrent.TimeUnit.SECONDS);
          } catch (java.util.concurrent.ExecutionException failed) {
            throw failed.getCause();
          }
        }
        return result;
      } catch (java.lang.reflect.InvocationTargetException failure) {
        throw failure.getCause();
      }
    }
    throw new AssertionError("no " + name + " taking " + args.length + " arguments");
  }

  private static void setField(Object target, String name, Object value) throws ReflectiveOperationException {
    var field = target.getClass().getDeclaredField(name);
    field.setAccessible(true);
    field.set(target, value);
  }

}
