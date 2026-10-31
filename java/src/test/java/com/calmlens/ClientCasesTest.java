package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

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
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").build();
    Map<String, Object> values = new HashMap<>();
    values.put("baseUrl", client.baseUrl());
    values.put("cdnBaseUrl", client.cdnBaseUrl());
    values.put("timeoutMs", client.timeout().toMillis());
    values.put("uploadTimeoutMs", client.uploadTimeout());
    values.put("maxRetries", (long) client.maxRetries());
    values.put("retryBaseDelayMs", CalmLensServerClient.RETRY_BASE_DELAY.toMillis());
    values.put("retryMaxDelayMs", CalmLensServerClient.RETRY_MAX_DELAY.toMillis());
    values.put("retryAfterMaxMs", CalmLensServerClient.RETRY_AFTER_MAX.toMillis());
    values.put("maxResponseBytes", client.maxResponseBytes());
    values.put("signedUrlExpiresInSeconds", CalmLensServerClient.DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS);
    values.put("uploadTokenExpiresInSeconds", (long) CalmLensServerClient.DEFAULT_UPLOAD_TOKEN_EXPIRES_IN_SECONDS);
    values.put("waitForDecisionTimeoutMs", CalmLensServerClient.DEFAULT_DECISION_TIMEOUT.toMillis());
    values.put("waitForDecisionFirstIntervalMs", CalmLensServerClient.DECISION_POLL_FIRST_DELAY.toMillis());
    values.put("waitForDecisionIntervalFactor", CalmLensServerClient.DECISION_POLL_DELAY_FACTOR);
    values.put("waitForDecisionMaxIntervalMs", CalmLensServerClient.DECISION_POLL_MAX_DELAY.toMillis());
    values.put("ensureLensesBatchSize", (long) CalmLensServerClient.ENSURE_LENSES_MAX_PER_REQUEST);
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

  @TestFactory Stream<DynamicTest> clientCases() throws Exception {
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
        run(fixture, clientCase);
      }));
    }
    assertFalse(tests.isEmpty());
    return tests.stream();
  }

  private static void run(JsonObject fixture, JsonObject clientCase) throws Exception {
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
    try {
      CalmLensServerClient.Builder builder = CalmLensServerClient.builder(string(options, "apiKey"), string(options, "projectId"));
      if (options.has("baseUrl")) builder.baseUrl(options.get("baseUrl").getAsString());
      if (options.has("cdnBaseUrl")) builder.cdnBaseUrl(options.get("cdnBaseUrl").getAsString());
      if (options.has("maxRetries")) builder.maxRetries(options.get("maxRetries").getAsInt());
      if (options.has("timeoutMs")) builder.timeout(Duration.ofMillis(options.get("timeoutMs").getAsLong()));
      if (options.has("maxResponseBytes")) builder.maxResponseBytes(options.get("maxResponseBytes").getAsLong());
      // Waits are recorded and skipped; the client's clock moves on by each one.
      client = builder.build(transport, delay -> { sleeps.add(delay.toMillis()); slept[0] += delay.toNanos(); }, () -> System.nanoTime() + slept[0]);
    } catch (CalmLensException refused) {
      constructionError = refused;
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
            result = invoke(client, operation, step.has("args") ? step.getAsJsonObject("args") : new JsonObject());
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
          if (expect.has("partialResult")) assertEquals(Fixtures.withoutNulls(expect.get("partialResult")), Fixtures.withoutNulls(partial), label + ": yielded");
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
          JsonElement want = expect.has("result") ? expect.get("result") : JsonNull.INSTANCE;
          JsonElement actual = result instanceof JsonElement json ? json : ContractTest.tree(result);
          // Typed results omit unset fields, so null members are compared as absent.
          assertEquals(Fixtures.withoutNulls(want), Fixtures.withoutNulls(actual), label);
        }
      }
    } finally {
      // A cancelled call keeps the interrupt flag, as the client promises; clear it for the next case.
      Thread.interrupted();
    }

    JsonArray wanted = clientCase.getAsJsonArray("requests");
    assertEquals(wanted.size(), received.size(), name + ": requests sent");
    Map<String, String> uuids = new HashMap<>();
    JsonObject every = fixture.getAsJsonObject("everyRequest").getAsJsonObject("headers");
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
      } else {
        assertEquals(want.get("bodyLength").getAsLong(), got.body().length, label + ": body length");
        assertEquals(want.get("bodySha256").getAsString(), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(got.body())), label + ": body SHA-256");
        if (want.has("bodyBase64")) assertEquals(want.get("bodyBase64").getAsString(), Base64.getEncoder().encodeToString(got.body()), label + ": body");
      }
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
  private static Models.Content content(JsonObject json) {
    JsonObject plain = json.deepCopy();
    byte[] bytes = null;
    byte[] stream = null;
    for (String key : List.of("uint8Array", "buffer")) {
      if (!plain.has(key)) continue;
      bytes = bytes(plain.remove(key).getAsJsonObject());
    }
    if (plain.has("data")) stream = bytes(plain.remove("data").getAsJsonObject());
    Models.Content content = Json.GSON.fromJson(plain, Models.Content.class);
    if (bytes != null) content.data = bytes;
    if (stream != null) content.stream = new ByteArrayInputStream(stream);
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

  private static Object invoke(CalmLensServerClient client, String operation, JsonObject args) throws Throwable {
    JsonObject options = args.deepCopy();
    RequestOptions request = options.has("idempotencyKey") ? new RequestOptions().idempotencyKey(options.remove("idempotencyKey").getAsString()) : null;
    switch (operation) {
      case "assets.create", "assets.classify": {
        JsonObject content = options.has("content") ? options.remove("content").getAsJsonObject() : null;
        JsonObject part = options.has("part") ? options.remove("part").getAsJsonObject() : null;
        Models.SubmitAsset submit = Fixtures.decode(options, Models.SubmitAsset.class);
        if (content != null) setField(submit, "content", content(content));
        if (part != null) setField(submit, "part", content(part));
        return operation.equals("assets.create") ? client.assets.create(submit, request) : client.assets.classify(submit, request);
      }
      case "assets.uploadPart": {
        JsonObject part = options.remove("part").getAsJsonObject();
        Models.UploadPart upload = Fixtures.decode(options, Models.UploadPart.class);
        setField(upload, "part", content(part));
        return client.assets.uploadPart(upload, request);
      }
      case "text.classify":
        return client.text.classify(Fixtures.decode(options, Models.ClassifyText.class), request);
      case "assets.waitForDecision": {
        Models.WaitForDecision wait = new Models.WaitForDecision(options.get("assetId").getAsString());
        if (options.has("timeoutMs")) wait.timeout(Duration.ofMillis(options.get("timeoutMs").getAsLong()));
        return client.assets.waitForDecision(wait);
      }
      case "assets.iterate": return collect(client.assets.iterate(Fixtures.decode(options, Models.ListAssets.class)));
      case "assets.iterateChildren": return collect(client.assets.iterateChildren(Fixtures.decode(options, Models.ListChildren.class)));
      case "events.iterate": return collect(client.events.pages(Fixtures.decode(options, Models.ListEvents.class)));
      case "cdn.serve": return client.cdn.serve(Fixtures.decode(options, Models.CdnRequest.class));
      default: return Fixtures.invoke(client, operation, options);
    }
  }

  private static void setField(Object target, String name, Object value) throws ReflectiveOperationException {
    var field = target.getClass().getDeclaredField(name);
    field.setAccessible(true);
    field.set(target, value);
  }

}
