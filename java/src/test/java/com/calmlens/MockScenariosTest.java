package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.MockCalmLensServerClient.Grant;
import com.calmlens.MockCalmLensServerClient.Options;
import com.calmlens.MockCalmLensServerClient.Outcome;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Replays the shared mock behaviour scenarios (packages/sdk-contract/mockScenarios.ts) against
 * {@link MockCalmLensServerClient}. The format is described in packages/sdk-contract/README.md.
 */
class MockScenariosTest {
  /** Follows a dotted path: numeric segments index arrays, {@code length} is an array's length. */
  private static JsonElement at(JsonElement value, String path) {
    for (String segment : path.split("\\.")) {
      if (value == null || value.isJsonNull()) return JsonNull.INSTANCE;
      if (value.isJsonArray()) {
        JsonArray items = value.getAsJsonArray();
        value = segment.equals("length") ? new JsonPrimitive(items.size()) : items.get(Integer.parseInt(segment));
      } else if (value.isJsonObject()) {
        value = value.getAsJsonObject().get(segment);
      } else {
        return JsonNull.INSTANCE;
      }
    }
    return value == null ? JsonNull.INSTANCE : value;
  }

  private static JsonElement resolve(JsonElement value, Map<String, JsonElement> saved) {
    if (value.isJsonObject()) {
      JsonObject object = value.getAsJsonObject();
      if (object.has("$ref")) {
        String[] reference = object.get("$ref").getAsString().split("\\.", 2);
        return at(saved.get(reference[0]), reference[1]);
      }
      JsonObject resolved = new JsonObject();
      object.entrySet().forEach(entry -> resolved.add(entry.getKey(), resolve(entry.getValue(), saved)));
      return resolved;
    }
    if (value.isJsonArray()) {
      JsonArray resolved = new JsonArray();
      value.getAsJsonArray().forEach(item -> resolved.add(resolve(item, saved)));
      return resolved;
    }
    return value;
  }

  /** A missing value compares as JSON null; Gson compares numbers by value. */
  private static JsonElement normalize(JsonElement value) { return value == null ? JsonNull.INSTANCE : value; }

  private static Outcome outcome(JsonObject mock, String key, Outcome fallback) {
    if (!mock.has(key)) return fallback;
    String value = mock.get(key).getAsString();
    return Arrays.stream(Outcome.values()).filter(outcome -> outcome.value().equals(value)).findFirst().orElseThrow();
  }

  private static JsonElement tree(Object result) { return result == null ? JsonNull.INSTANCE : Json.GSON.toJsonTree(result); }

  private static JsonElement run(MockCalmLensServerClient mock, String operation, JsonObject args) throws Throwable {
    switch (operation) {
      case "mock.decide":
        return tree(mock.decide(args.get("assetId").getAsString(), outcome(args, "outcome", null)));
      case "mock.enqueueEvent": {
        List<Models.EventFact> facts = new ArrayList<>();
        for (JsonElement fact : args.getAsJsonArray("facts")) facts.add(Json.GSON.fromJson(fact, Models.EventFact.class));
        return tree(mock.enqueueEvent(args.get("type").getAsString(), args.get("assetId").getAsString(), facts.toArray(Models.EventFact[]::new)));
      }
      case "cdn.serve": {
        try (CdnResponse response = mock.client.cdn.serve(Fixtures.decode(args, Models.CdnRequest.class))) {
          String body = new String(response.readAllBytes(1_000_000), StandardCharsets.UTF_8);
          JsonObject result = new JsonObject();
          result.addProperty("status", response.status());
          String type = response.header("content-type");
          result.add("code", type != null && type.startsWith("application/json") ? JsonParser.parseString(body).getAsJsonObject().get("code") : JsonNull.INSTANCE);
          result.addProperty("body", body);
          return result;
        }
      }
      case "assets.waitForDecision":
        return tree(mock.client.assets.waitForDecision(new Models.WaitForDecision(args.get("assetId").getAsString())
            .timeout(Duration.ofMillis(args.get("timeoutMs").getAsLong()))));
      default:
        if (args.has("idempotencyKey")) {
          RequestOptions request = new RequestOptions().idempotencyKey(args.remove("idempotencyKey").getAsString());
          Models.SubmitAsset submit = Fixtures.decode(args, Models.SubmitAsset.class);
          return tree(operation.equals("assets.create") ? mock.client.assets.create(submit, request) : mock.client.assets.classify(submit, request));
        }
        return tree(Fixtures.invoke(mock.client, operation, args));
    }
  }

  private static void check(MockCalmLensServerClient mock, String scenario, JsonObject step, Map<String, JsonElement> saved) throws Throwable {
    String operation = step.get("operation").getAsString();
    String label = scenario + ": " + operation + " " + step.get("args");
    JsonObject args = step.has("args") ? resolve(step.get("args"), saved).getAsJsonObject() : new JsonObject();
    JsonObject expect = step.has("expect") ? step.getAsJsonObject("expect") : new JsonObject();
    if (expect.has("error")) {
      CalmLensException error = assertThrows(CalmLensException.class, () -> run(mock, operation, args), label);
      JsonObject actual = new JsonObject();
      actual.addProperty("code", error.getCode());
      actual.add("status", error.getStatus() == 0 ? JsonNull.INSTANCE : new JsonPrimitive(error.getStatus()));
      assertEquals(normalize(expect.get("error")), normalize(actual), label);
      return;
    }
    JsonElement result = run(mock, operation, args);
    if (expect.has("cdn"))
      for (Map.Entry<String, JsonElement> entry : expect.getAsJsonObject("cdn").entrySet())
        assertEquals(normalize(entry.getValue()), normalize(at(result, entry.getKey())), label + ": cdn " + entry.getKey());
    if (expect.has("result"))
      for (Map.Entry<String, JsonElement> entry : expect.getAsJsonObject("result").entrySet()) {
        JsonElement raw = entry.getValue(), actual = at(result, entry.getKey());
        if (raw.isJsonObject() && raw.getAsJsonObject().has("$contains")) {
          JsonElement member = normalize(resolve(raw.getAsJsonObject().get("$contains"), saved));
          assertTrue(actual.isJsonArray(), label + ": " + entry.getKey() + " is not an array");
          boolean found = false;
          for (JsonElement item : actual.getAsJsonArray()) found |= normalize(item).equals(member);
          assertTrue(found, label + ": " + entry.getKey() + " " + actual + " lacks " + member);
        } else {
          assertEquals(normalize(resolve(raw, saved)), normalize(actual), label + ": " + entry.getKey());
        }
      }
    if (step.has("save")) saved.put(step.get("save").getAsString(), result);
  }

  @TestFactory Stream<DynamicTest> mockReplaysEverySharedScenario() throws Exception {
    JsonArray scenarios = Fixtures.read("mock-scenarios.json").getAsJsonObject().getAsJsonArray("scenarios");
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonElement element : scenarios) {
      JsonObject scenario = element.getAsJsonObject();
      String name = scenario.get("name").getAsString();
      tests.add(DynamicTest.dynamicTest(name, () -> {
        JsonObject options = scenario.getAsJsonObject("mock");
        List<Grant> grants = new ArrayList<>();
        if (options.has("apiKeyGrants"))
          for (JsonElement grant : options.getAsJsonArray("apiKeyGrants")) {
            JsonObject g = grant.getAsJsonObject();
            List<String> actions = new ArrayList<>();
            g.getAsJsonArray("actions").forEach(action -> actions.add(action.getAsString()));
            grants.add(new Grant(actions, g.get("folderId").isJsonNull() ? null : g.get("folderId").getAsString(), g.get("includeSubfolders").getAsBoolean()));
          }
        MockCalmLensServerClient mock = new MockCalmLensServerClient(
            CalmLensServerClient.builder(MockCalmLensServerClient.createMockApiKey(grants.toArray(Grant[]::new)), "project-1")
                .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1").maxRetries(0),
            new Options().queuedOutcome(outcome(options, "queuedOutcome", Outcome.PENDING))
                .analyzedOutcome(outcome(options, "analyzedOutcome", Outcome.ALLOWED)));
        Map<String, JsonElement> saved = new HashMap<>();
        long started = System.nanoTime();
        for (JsonElement step : scenario.getAsJsonArray("steps")) check(mock, name, step.getAsJsonObject(), saved);
        // Mock waits take no real time.
        assertTrue(System.nanoTime() - started < Duration.ofSeconds(5).toNanos(), name);
      }));
    }
    assertEquals(14, tests.size());
    return tests.stream();
  }
}
