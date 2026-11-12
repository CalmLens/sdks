package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.*;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.*;
import com.calmlens.params.*;
import com.calmlens.testing.MockCalmLensServerClient;
import com.calmlens.testing.MockCalmLensServerClient.Options;
import com.calmlens.testing.MockCalmLensServerClient.Outcome;
import com.calmlens.testing.MockDecision;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class StatefulMockTest {
  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 1, 2, 3};

  /** Sequential IDs and a clock that moves one second per reading. */
  private static Options deterministic() {
    AtomicInteger ids = new AtomicInteger();
    AtomicLong clock = new AtomicLong(1_700_000_000_000L);
    return new Options().createId(prefix -> prefix + "_" + String.format("%020d", ids.incrementAndGet())).now(() -> clock.addAndGet(1000));
  }

  private static CalmLensServerClient.Builder builder() { return CalmLensServerClient.builder().apiKey("mock-key").projectId("project-1"); }

  private static AssetCreateParams.Builder kept(String name) {
    return AssetCreateParams.builder().setName(name).setContent(Content.bytes(PNG, "image/png"))
        .setProcessingOptions(ProcessingOptionsParams.builder().setRetainContent(true).build());
  }

  private static AssetExplainParams rerun() { return AssetExplainParams.builder().setRerun(true).build(); }

  private static Optional<AssetModerationDecision> decision(Asset asset) { return asset.getClassification().getModeration().getDecision(); }

  /**
   * The mock's in-memory API, answering requests no SDK method sends. It is package-private in
   * {@code com.calmlens.testing}, so it is reached reflectively.
   */
  private static final class MockApi {
    static final String MOCK_THUMBHASH;
    private static final java.lang.reflect.Constructor<?> CREATE;
    private static final java.lang.reflect.Method ANSWER;

    static {
      try {
        Class<?> type = Class.forName("com.calmlens.testing.MockApi");
        java.lang.reflect.Field thumbhash = type.getDeclaredField("MOCK_THUMBHASH");
        thumbhash.setAccessible(true);
        MOCK_THUMBHASH = (String) thumbhash.get(null);
        CREATE = type.getDeclaredConstructor(String.class, String.class, String.class, Options.class);
        CREATE.setAccessible(true);
        ANSWER = type.getDeclaredMethod("answer", MockCalmLensServerClient.Request.class);
        ANSWER.setAccessible(true);
      } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
      }
    }

    private final Object api;

    MockApi(String projectId, String apiBase, String cdnBase, Options options) throws Exception {
      api = CREATE.newInstance(projectId, apiBase, cdnBase, options);
    }

    Transport.Response answer(MockCalmLensServerClient.Request request) throws Exception {
      try {
        return (Transport.Response) ANSWER.invoke(api, request);
      } catch (java.lang.reflect.InvocationTargetException e) {
        if (e.getCause() instanceof Exception cause) throw cause;
        throw e;
      }
    }
  }

  @Test void uploadsSendTheirTagsAndTheAssetKeepsThem() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Asset uploaded = mock.client().assets().classify(kept("photo.png").setTags(List.of("catalogue", "backpacks")).build());
    assertEquals(List.of("catalogue", "backpacks"), uploaded.getTags());
    // A file upload carries its tags in the form's options part, like metadata.
    assertEquals(JsonParser.parseString("[\"catalogue\",\"backpacks\"]"), Fixtures.formOptions(mock.requests().get(0)).get("tags"));
    Asset text = mock.client().text().classify(TextClassifyParams.builder().setText("hello").setTags(List.of("comments")).build());
    assertEquals(List.of("comments"), text.getTags());
    Asset linked = mock.client().assets().create(AssetCreateParams.builder().setName("site").setUrl("https://example.com").setTags(List.of("links")).build());
    assertEquals(List.of("links"), linked.getTags());
    JsonObject body = JsonParser.parseString(new String(mock.requests().get(2).body(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
    assertEquals(JsonParser.parseString("[\"links\"]"), body.get("tags"));
    assertEquals(List.of("catalogue", "backpacks"), mock.client().assets().retrieve(uploaded.getId()).getTags());
    // Like the API, the processing options an asset was uploaded with are not returned.
    mock.withStorage(storage -> assertFalse(storage.assets.get(uploaded.getId()).has("processingOptions")));
  }

  @Test void explainCompletesTheEvidenceAndRerunModeratesAgain() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic().moderate(input -> MockDecision.of(input.queued() ? "pending" : "blocked")));
    Asset asset = mock.client().assets().classify(kept("photo.png").build());
    mock.withStorage(storage -> storage.assets.get(asset.getId()).getAsJsonObject("classification").getAsJsonObject("moderation")
        .addProperty("explanationComplete", false));
    Asset explained = mock.client().assets().explain(asset.getId());
    assertEquals(Optional.of(true), explained.getClassification().getModeration().getExplanationComplete());
    assertEquals(Optional.of(AssetModerationDecision.BLOCKED), explained.getClassification().getModeration().getDecision());

    // A queued re-run keeps the decision until it is decided.
    Asset rerun = mock.client().assets().explain(asset.getId(), rerun());
    assertSame(AssetClassificationStatus.COMPLETED, rerun.getClassification().getStatus());
    assertEquals(Optional.of(AssetModerationDecision.BLOCKED), rerun.getClassification().getModeration().getDecision());

    // A reviewer's decision stands: the queued re-run no longer replaces it.
    mock.decide(asset.getId(), Outcome.ALLOWED);
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> mock.completeProcessing(asset.getId())).getCode());
    assertEquals(Optional.of(AssetModerationDecision.ALLOWED), mock.client().assets().retrieve(asset.getId()).getClassification().getModeration().getDecision());
    assertEquals(ErrorCodes.ASSET_REVIEWED, assertThrows(ApiException.class,
        () -> mock.client().assets().explain(asset.getId(), rerun())).getCode());
  }

  @Test void rerunReplacesTheDecisionOnlyWithANewOne() {
    AtomicInteger reruns = new AtomicInteger();
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic().moderate(input ->
        MockDecision.of(input.trigger() != MockCalmLensServerClient.Trigger.RERUN ? "allowed" : reruns.incrementAndGet() == 1 ? "blocked" : "failed")));
    Asset asset = mock.client().assets().classify(kept("photo.png").build());
    // The response is the asset as the re-run found it; the new decision follows.
    Asset rerun = mock.client().assets().explain(asset.getId(), rerun());
    assertEquals(Optional.of(AssetModerationDecision.ALLOWED), rerun.getClassification().getModeration().getDecision());
    assertEquals(Optional.of(AssetModerationDecision.BLOCKED), mock.client().assets().retrieve(asset.getId()).getClassification().getModeration().getDecision());
    // A failed re-run keeps the decision.
    mock.client().assets().explain(asset.getId(), rerun());
    Asset stored = mock.client().assets().retrieve(asset.getId());
    assertSame(AssetClassificationStatus.COMPLETED, stored.getClassification().getStatus());
    assertEquals(Optional.of(AssetModerationDecision.BLOCKED), stored.getClassification().getModeration().getDecision());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> mock.completeProcessing(asset.getId())).getCode());
  }

  @Test void moderateGetsAMultipartUploadOnceItsFinalPartArrives() {
    List<MockCalmLensServerClient.ModerationInput> inputs = new java.util.ArrayList<>();
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic().moderate(input -> {
      inputs.add(input);
      return MockDecision.of("blocked");
    }));
    byte[] first = new byte[5 * 1024 * 1024];
    first[0] = 'a';
    Asset started = mock.client().assets().create(AssetCreateParams.builder().setName("notes.txt").setPart(Content.bytes(first, "text/plain").withPartNumber(1).withIsFinal(false)).build());
    assertEquals(List.of(), inputs);
    Asset finished = mock.client().assets().uploadPart(started.getId(), AssetUploadPartParams.builder()
        .setPart(Content.bytes("bc".getBytes(java.nio.charset.StandardCharsets.UTF_8), "text/plain").withPartNumber(2).withIsFinal(true)).build());
    assertEquals(Optional.of(AssetModerationDecision.BLOCKED), finished.getClassification().getModeration().getDecision());
    assertEquals(1, inputs.size());
    MockCalmLensServerClient.ModerationInput input = inputs.get(0);
    assertSame(MockCalmLensServerClient.Trigger.UPLOAD, input.trigger());
    assertTrue(input.queued());
    assertSame(AssetClassificationStatus.PROCESSING, input.asset().getClassification().getStatus());
    byte[] joined = java.util.Arrays.copyOf(first, first.length + 2);
    joined[first.length] = 'b';
    joined[first.length + 1] = 'c';
    assertEquals(new String(joined, java.nio.charset.StandardCharsets.UTF_8), input.content().text());
  }

  @Test void textClassifyStoresAPlaintextDocument() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    assertSame(AssetType.PLAINTEXT_DOCUMENT, mock.client().text().classify("hello").getType());
  }

  /** The shared purge scenario covers the statuses and the CDN refusal; this is the stored bytes being dropped. */
  @Test void purgingDropsTheStoredBytes() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Asset asset = mock.client().assets().create(kept("photo.png").build());
    mock.withStorage(storage -> assertTrue(storage.content.containsKey(asset.getId())));
    mock.decide(asset.getId(), Outcome.PURGED);
    mock.withStorage(storage -> assertFalse(storage.content.containsKey(asset.getId())));
  }

  @Test void listPagesWithinAFolderAndErrorsCarryMockRequestIds() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(builder().maxRetries(0), deterministic());
    Folder folder = mock.client().folders().create(FolderCreateParams.builder().setName("Uploads").build());
    for (int i = 1; i <= 3; i++) mock.client().assets().create(AssetCreateParams.builder().setName("cat-" + i + ".png")
        .setContent(Content.bytes(PNG, "image/png")).setFolderId(folder.getId()).build());
    mock.client().assets().create("dog.png", PNG, "image/png");

    AssetListParams.Builder inFolder = AssetListParams.builder().setFilter("folderId==" + folder.getId()).setPageSize(2).setSort("createdAt");
    AssetPage first = mock.client().assets().list(inFolder.build());
    assertEquals(List.of("cat-1.png", "cat-2.png"), first.getItems().stream().map(Asset::getName).toList());
    assertTrue(first.getHasMore());
    AssetPage second = mock.client().assets().list(inFolder.setCursor(first.getNextCursor().orElseThrow()).build());
    assertEquals(List.of("cat-3.png"), second.getItems().stream().map(Asset::getName).toList());
    assertFalse(second.getHasMore());

    ApiException missing = assertThrows(ApiException.class, () -> mock.client().assets().retrieve("nope"));
    String requestId = missing.getRequestId().orElseThrow();
    assertTrue(requestId.startsWith("req_mock_"), requestId);
  }

  /** The shared scenario covers create, update, listing and deletion; this is adding from an asset and the cascade. */
  @Test void hashListEntriesComeFromAnAssetsHashAndGoWithTheirList() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    String hash = "ab".repeat(32);
    Asset hashed = mock.client().assets().classify(kept("hashed.png").build());
    Asset unhashed = mock.client().assets().classify(kept("unhashed.png").build());
    mock.withStorage(storage -> {
      var content = storage.assets.get(hashed.getId()).getAsJsonObject("content");
      content.addProperty("perceptualHash", hash);
      content.addProperty("perceptualHashQuality", 80);
    });
    HashList list = mock.client().hashLists().create(HashListCreateParams.builder().setName("Removed").setAction(HashListAction.BLOCK).build());

    HashListEntry entry = mock.client().hashLists().addEntry(list.getId(), HashListAddEntryParams.builder().setAssetId(hashed.getId()).setLabel("Report 1").build());
    assertEquals(hash, entry.getHash());
    assertEquals(Optional.of(80), entry.getQuality());
    assertEquals(Optional.of(hashed.getId()), entry.getAssetId());
    assertEquals(entry.getId(), mock.client().hashLists().addEntry(list.getId(), HashListAddEntryParams.builder().setHash(hash.toUpperCase()).build()).getId());
    assertEquals(ErrorCodes.HASH_LIST_ASSET_NOT_HASHED, assertThrows(ApiException.class,
        () -> mock.client().hashLists().addEntry(list.getId(), HashListAddEntryParams.builder().setAssetId(unhashed.getId()).build())).getCode());

    HashListEntry second = mock.client().hashLists().addEntry(list.getId(), HashListAddEntryParams.builder().setHash("cd".repeat(32)).build());
    HashListEntryPage first = mock.client().hashLists().listEntries(list.getId(), HashListListEntriesParams.builder().setPageSize(1).build());
    assertEquals(List.of(second.getId()), first.getItems().stream().map(HashListEntry::getId).toList());
    assertTrue(first.getHasMore());
    HashListEntryPage next = mock.client().hashLists().listEntries(list.getId(),
        HashListListEntriesParams.builder().setPageSize(1).setCursor(first.getNextCursor().orElseThrow()).build());
    assertEquals(List.of(entry.getId()), next.getItems().stream().map(HashListEntry::getId).toList());
    assertFalse(next.getHasMore());

    mock.client().hashLists().delete(list.getId());
    assertEquals(ErrorCodes.HASH_LIST_ENTRY_NOT_FOUND, assertThrows(ApiException.class,
        () -> mock.client().hashLists().removeEntry(entry.getId())).getCode());
    assertEquals(List.of(), mock.client().hashLists().list().getItems());
  }

  /** A schema refusal: {@code validation/invalid-request} whose one issue names the field and its issue code. */
  private static void assertIssue(JsonObject refused, String path, String code) {
    assertEquals(ErrorCodes.INVALID_REQUEST, refused.get("code").getAsString(), path);
    com.google.gson.JsonArray issues = refused.getAsJsonObject("details").getAsJsonArray("issues");
    assertEquals(1, issues.size(), path);
    assertEquals(path, issues.get(0).getAsJsonObject().get("path").getAsString());
    assertEquals(code, issues.get(0).getAsJsonObject().get("code").getAsString(), path);
  }

  /**
   * A request sent straight to the in-memory API, as a client other than this SDK's could send it.
   * With {@code upload}, it is an upload form: {@code json} (default {@code {"name":"x"}}) is its
   * options and {@code hello} its file, of the query's {@code contentType}.
   */
  private static JsonObject raw(MockApi api, String method, String path, java.util.Map<String, String> query, String upload, String json) throws Exception {
    java.util.Map<String, String> headers = new java.util.LinkedHashMap<>();
    byte[] body;
    if (upload == null) {
      headers.put("Content-Type", "application/json");
      body = (json == null ? "hello" : json).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    } else {
      UploadForm.Built form = UploadForm.build(JsonParser.parseString(json == null ? "{\"name\":\"x\"}" : json).getAsJsonObject(),
          query.getOrDefault("contentType", "text/plain"), Transport.Body.ofBytes("hello".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      headers.put("Content-Type", form.contentType());
      headers.put("X-CalmLens-Upload", upload);
      try (java.io.InputStream in = form.body().open()) { body = in.readAllBytes(); }
    }
    return send(api, method, path, query, headers, body);
  }

  private static JsonObject send(MockApi api, String method, String path, java.util.Map<String, String> query, java.util.Map<String, String> headers, byte[] body) throws Exception {
    Transport.Response response = api.answer(new MockCalmLensServerClient.Request(method, "https://api.calmlens.com/v1" + path, path, query, headers, body, null));
    JsonObject reply = JsonParser.parseString(new String(response.body().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
    reply.addProperty("status", response.status());
    return reply;
  }

  private static int assetCount(MockApi api) throws Exception {
    return send(api, "GET", "/projects/project-1/assets", java.util.Map.of(), java.util.Map.of(), null).getAsJsonArray("items").size();
  }

  @Test void theMockTakesUploadFieldsOnlyFromTheBody() throws Exception {
    MockApi api = new MockApi("project-1", "https://api.calmlens.com/v1", "https://cdn.calmlens.com/v1", deterministic());
    String assets = "/projects/project-1/assets";
    // Asset fields in the query are refused, for an upload form and a JSON body alike, before anything is stored.
    JsonObject form = raw(api, "POST", assets, java.util.Map.of("contentType", "text/plain", "authorId", "user-1", "description", "d"), "content", null);
    assertEquals(400, form.get("status").getAsInt());
    assertEquals(ErrorCodes.UPLOAD_OPTIONS_IN_QUERY, form.get("code").getAsString());
    assertEquals(JsonParser.parseString("[\"description\",\"authorId\"]"), form.getAsJsonObject("details").get("fields"));
    JsonObject json = raw(api, "POST", assets, java.util.Map.of("wait", "false", "context", "{}"), null,
        "{\"name\":\"x\",\"content\":{\"plainText\":\"hi\",\"type\":\"text/plain\"}}");
    assertEquals(ErrorCodes.UPLOAD_OPTIONS_IN_QUERY, json.get("code").getAsString());
    assertEquals(JsonParser.parseString("[\"context\"]"), json.getAsJsonObject("details").get("fields"));
    assertEquals(0, assetCount(api));

    // A raw upload must be an upload form.
    java.util.Map<String, String> plain = java.util.Map.of("Content-Type", "text/plain", "X-CalmLens-Upload", "content");
    JsonObject bare = send(api, "POST", assets, java.util.Map.of("contentType", "text/plain"), plain, "hello".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    assertEquals(415, bare.get("status").getAsInt());
    assertEquals(ErrorCodes.UNSUPPORTED_CONTENT_TYPE, bare.get("code").getAsString());
    // Options the API's strict schema doesn't know are refused.
    assertIssue(raw(api, "POST", assets, java.util.Map.of("contentType", "text/plain"), "content", "{\"name\":\"x\",\"wait\":true}"), "wait", ErrorCodes.UNKNOWN_FIELD);

    // The fields come from the options part and the file from the file part.
    JsonObject stored = raw(api, "POST", assets, java.util.Map.of("contentType", "text/plain"), "content", "{\"name\":\"note.txt\",\"authorId\":\"user-1\"}");
    assertEquals(200, stored.get("status").getAsInt());
    assertEquals("note.txt", stored.get("name").getAsString());
    assertEquals("user-1", stored.get("authorId").getAsString());
    assertEquals(5, stored.getAsJsonObject("content").get("sizeInBytes").getAsLong());
    // Plain text in a JSON body is stored as its UTF-8 bytes.
    JsonObject text = raw(api, "POST", assets, java.util.Map.of(), null,
        "{\"name\":\"t.txt\",\"description\":\"d\",\"content\":{\"plainText\":\"h\u00e9\",\"type\":\"text/plain\"}}");
    assertEquals("d", text.get("description").getAsString());
    assertEquals(3, text.getAsJsonObject("content").get("sizeInBytes").getAsLong());
  }

  @Test void anUploadFormRetriedUnderANewBoundaryReplaysAndOtherOptionsReuseTheKey() throws Exception {
    MockApi api = new MockApi("project-1", "https://api.calmlens.com/v1", "https://cdn.calmlens.com/v1", deterministic());
    String assets = "/projects/project-1/assets";
    java.util.function.Function<String, JsonObject> upload = options -> {
      UploadForm.Built form = UploadForm.build(JsonParser.parseString(options).getAsJsonObject(), "text/plain",
          Transport.Body.ofBytes("hello".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      try (java.io.InputStream in = form.body().open()) {
        return send(api, "POST", assets, java.util.Map.of("contentType", "text/plain"),
            java.util.Map.of("Content-Type", form.contentType(), "X-CalmLens-Upload", "content", "Idempotency-Key", "key-1"), in.readAllBytes());
      } catch (Exception e) { throw new IllegalStateException(e); }
    };
    JsonObject first = upload.apply("{\"name\":\"a.txt\"}");
    JsonObject again = upload.apply("{\"name\":\"a.txt\"}");
    assertEquals(first.get("id"), again.get("id"));
    assertEquals(1, assetCount(api));
    JsonObject other = upload.apply("{\"name\":\"b.txt\"}");
    assertEquals(ErrorCodes.IDEMPOTENCY_KEY_REUSED, other.get("code").getAsString());
  }

  @Test void theMockRefusesUploadTypesAndMetadataTheApiRefuses() throws Exception {
    MockApi api = new MockApi("project-1", "https://api.calmlens.com/v1", "https://cdn.calmlens.com/v1", deterministic());
    for (String type : List.of("application/zip", "application/octet-stream", "font/woff2")) {
      JsonObject refused = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("contentType", type), "content", null);
      assertEquals(415, refused.get("status").getAsInt(), type);
      assertEquals(ErrorCodes.UNSUPPORTED_UPLOAD_TYPE, refused.get("code").getAsString(), type);
      assertEquals(type, refused.getAsJsonObject("details").get("mimeType").getAsString(), type);
      assertEquals("calmlens", refused.getAsJsonObject("details").get("source").getAsString(), type);
    }
    assertEquals(200, raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("contentType", "TEXT/Markdown"), "content", null)
        .get("status").getAsInt());
    // A URL upload has no content type to check.
    assertEquals(200, raw(api, "POST", "/projects/project-1/assets", java.util.Map.of(), null, "{\"name\":\"x\",\"url\":\"https://example.com/\"}")
        .get("status").getAsInt());

    JsonObject dict = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of(), null, "{\"name\":\"x\",\"url\":\"https://example.com/\",\"metadata\":{\"a\":1}}");
    assertIssue(dict, "metadata", "validation/invalid-type");
    JsonObject options = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("contentType", "text/plain"), "content", "{\"name\":\"x\",\"metadata\":[{\"id\":\"a\"}]}");
    assertIssue(options, "metadata.0.value", "validation/invalid-value");
    // Schema checks come before the asset lookup.
    JsonObject update = raw(api, "PATCH", "/assets/asset_missing", java.util.Map.of(), null, "{\"metadata\":[{\"id\":7,\"value\":1}]}");
    assertEquals(400, update.get("status").getAsInt());
    assertIssue(update, "metadata.0.id", "validation/invalid-type");
    JsonObject name = raw(api, "PATCH", "/assets/asset_missing", java.util.Map.of(), null, "{\"name\":null}");
    assertIssue(name, "name", "validation/invalid-type");
    // A signed asset URL's body is checked before the asset is looked up.
    String sign = "/projects/project-1/signed-asset-urls";
    assertIssue(raw(api, "POST", sign, java.util.Map.of(), null, "{\"assetId\":\"asset_missing\",\"original\":null}"), "original", "validation/invalid-type");
    assertIssue(raw(api, "POST", sign, java.util.Map.of(), null, "{\"assetId\":\"asset_missing\",\"expiresIn\":1.5}"), "expiresIn", "validation/invalid-type");
    assertIssue(raw(api, "POST", sign, java.util.Map.of(), null, "{\"assetId\":\"asset_missing\",\"expiresIn\":0}"), "expiresIn", "validation/too-small");
    assertIssue(raw(api, "POST", sign, java.util.Map.of(), null, "{\"assetId\":\"asset_missing\",\"expiresIn\":86401}"), "expiresIn", "validation/too-big");
    assertIssue(raw(api, "POST", sign, java.util.Map.of(), null, "{\"assetId\":\"asset_missing\",\"externalId\":\"post-1\"}"), "", "custom");
    assertEquals(ErrorCodes.ASSET_NOT_FOUND, raw(api, "POST", sign, java.util.Map.of(), null, "{\"assetId\":\"asset_missing\"}").get("code").getAsString());
  }

  /** Pages of a filtered feed keep their filters: a cursor sent without them would be refused. */
  @Test void eventPagesKeepTheirFiltersAndMalformedFiltersAreRefused() throws Exception {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    EventListParams.Builder uploads = EventListParams.builder().setTypes(List.of(EventType.ASSET_UPLOADED, EventType.ASSET_DELETED)).setPageSize(1);
    String start = mock.client().events().list(uploads.build()).getNextCursor();
    Asset first = mock.client().assets().classify(kept("first.png").build());
    Asset second = mock.client().assets().classify(kept("second.png").build());
    mock.client().assets().delete(first.getId());
    List<String> seen = new java.util.ArrayList<>();
    for (EventsPage page : mock.client().events().pages(uploads.setCursor(start).build()))
      page.getItems().forEach(event -> seen.add(event.getType().getValue() + " " + event.getAssetId().orElseThrow()));
    assertEquals(List.of("asset.uploaded " + first.getId(), "asset.uploaded " + second.getId(), "asset.deleted " + first.getId()), seen);

    MockApi api = new MockApi("project-1", "https://api.calmlens.com/v1", "https://cdn.calmlens.com/v1", deterministic());
    for (String types : List.of("", "asset.uploaded,", "Asset.Uploaded", "uploaded"))
      assertIssue(raw(api, "GET", "/projects/project-1/events", java.util.Map.of("types", types), null, null), "types", "validation/invalid-value");
    assertIssue(raw(api, "GET", "/projects/project-1/events", java.util.Map.of("assetId", "fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P"), null, null),
        "assetId", "validation/invalid-format");
  }

  /** The client sends the types as one comma-separated value, and none when the list is empty. */
  @Test void eventTypesAreSentAsOneCommaSeparatedValue() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    mock.client().events().list(EventListParams.builder().setTypes(List.of(EventType.ASSET_BLOCKED, EventType.ASSET_PURGED)).build());
    mock.client().events().list(EventListParams.builder().setTypes(List.of()).build());
    assertEquals("asset.blocked,asset.purged", mock.requests().get(0).query().get("types"));
    assertFalse(mock.requests().get(1).query().containsKey("types"));
  }

  @Test void enqueuedEventsAreTheApiKeysUnlessGivenAnActor() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    String start = mock.client().events().list().getNextCursor();
    EventActor reviewer = EventActor.of(ActorType.USER, "user_5Rt8Xm3Lq9Vk2Wb7Np4C");
    mock.enqueueEvent("asset.allowed", null);
    mock.enqueueEvent("asset.blocked", null, reviewer);
    // Compared by type and ID: the API sends a null ID, which EventActor.of leaves out of its JSON.
    assertEquals(List.of(List.of(ActorType.API_KEY, Optional.empty()), List.of(ActorType.USER, reviewer.getId())),
        mock.client().events().list(EventListParams.builder().setCursor(start).build()).getItems().stream()
            .map(event -> List.of(event.getActor().getType(), event.getActor().getId())).toList());
  }

  /**
   * The shared scenarios cover a video's embed page and missing stream; this is a text file's and
   * audio's embed page, audio's missing HLS stream, a selector after the embed page, which the SDK refuses to build and the mock refuses before
   * the asset lookup, and blocked content's embed page.
   */
  @Test void theMockServesTheEmbedPageOfAnyAssetButNoHlsStream() throws Exception {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Asset audio = mock.client().assets().classify(AssetCreateParams.builder().setName("song.wav")
        .setContent(Content.bytes("wav".getBytes(java.nio.charset.StandardCharsets.UTF_8), "audio/wav"))
        .setProcessingOptions(ProcessingOptionsParams.builder().setRetainContent(true)
            .setFeatures(ProcessingFeaturesParams.builder().setStreaming(FeatureOptionsParams.of(true)).build()).build())
        .setVisibility(Visibility.PUBLIC).build());
    assertSame(AssetRenderedKind.AUDIO, audio.getContent().getRendered().orElseThrow().getKind());
    assertEquals(Optional.empty(), audio.getContent().getHls());
    Asset note = mock.client().assets().classify(AssetCreateParams.builder().setName("note.txt")
        .setContent(Content.bytes("hello".getBytes(java.nio.charset.StandardCharsets.UTF_8), "text/plain"))
        .setProcessingOptions(ProcessingOptionsParams.builder().setRetainContent(true).build()).setVisibility(Visibility.PUBLIC).build());
    for (Asset asset : List.of(audio, note)) {
      try (CdnResponse embed = mock.client().cdn().serve(CdnRequestParams.builder().setAssetId(asset.getId()).setResource("embed").build())) {
        assertEquals(200, embed.status(), asset.getName());
        assertEquals("text/html; charset=utf-8", embed.header("Content-Type"));
        assertTrue(new String(embed.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8).startsWith("<!doctype html>"));
      }
    }
    try (CdnResponse hls = mock.client().cdn().serve(CdnRequestParams.builder().setAssetId(audio.getId()).setResource("hls").build())) {
      assertEquals(404, hls.status());
      assertEquals(ErrorCodes.NO_RENDERED_VERSION, JsonParser.parseString(new String(hls.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8))
          .getAsJsonObject().get("code").getAsString());
    }
    MockApi api = new MockApi("project-1", "https://api.calmlens.com/v1", "https://cdn.calmlens.com/v1", deterministic());
    String path = "/assets/project-1/missing/embed/width=10";
    Transport.Response refused = api.answer(new MockCalmLensServerClient.Request("GET", "https://cdn.calmlens.com/v1" + path, path, java.util.Map.of(), java.util.Map.of(), new byte[0], null));
    assertEquals(400, refused.status());
    assertEquals("transform/invalid", JsonParser.parseString(new String(refused.body().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8))
        .getAsJsonObject().get("code").getAsString());
    mock.decide(note.getId(), Outcome.BLOCKED);
    try (CdnResponse blocked = mock.client().cdn().serve(CdnRequestParams.builder().setAssetId(note.getId()).setResource("embed").build())) {
      assertEquals(403, blocked.status());
    }
  }

  /** The mock's clock moves a second per reading, so a one-second grant has expired by its first use. */
  @Test void anExpiredGrantIsRefusedByEveryResourceAndTheInfo() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Asset asset = mock.client().assets().classify(kept("private.png").setVisibility(Visibility.PRIVATE).build());
    SignedAssetUrl signed = mock.client().cdn().signAssetUrl(CdnSignAssetUrlParams.builder().setAssetId(asset.getId()).setExpiresIn(1L).build());
    try (CdnResponse expired = mock.fetchCdn(signed.getUrl() + "/rendered")) {
      assertEquals(403, expired.status());
      assertEquals(ErrorCodes.SIGNED_URL_EXPIRED, JsonParser.parseString(new String(expired.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8))
          .getAsJsonObject().get("code").getAsString());
    }
    ApiException info = assertThrows(ApiException.class, () -> mock.client().cdn().getAssetInfo(signed.getUrl()));
    assertEquals(ErrorCodes.SIGNED_URL_EXPIRED, info.getCode());
    assertEquals(403, info.getStatus());
  }

  /** getAssetInfo reads the claims the URL carries, sends no API key, and given claims replace the URL's. */
  @Test void assetInfoUsesTheUrlsViewerClaimsUnlessOthersAreGiven() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Asset asset = mock.client().assets().classify(kept("public.png").setVisibility(Visibility.PUBLIC).build());
    mock.decide(asset.getId(), Outcome.AGE_RESTRICTED);
    String confirmed = mock.client().cdn().getAssetUrl(CdnRequestParams.builder().setAssetId(asset.getId())
        .setViewerClaims(ViewerClaims.builder().setAgeConfirmed(true).build()).build());
    mock.clearRequests();
    assertSame(AssetAvailability.AVAILABLE, mock.client().cdn().getAssetInfo(confirmed).getAvailability());
    MockCalmLensServerClient.Request sent = mock.requests().get(0);
    assertEquals("/assets/project-1/" + asset.getId() + "/info", sent.path());
    assertEquals("{\"ageConfirmed\":true}", sent.query().get("viewerClaims"));
    assertNull(sent.header("X-Api-Key"));
    assertSame(AssetAvailability.AGE_RESTRICTED, mock.client().cdn().getAssetInfo(confirmed, ViewerClaims.builder().build()).getAvailability());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> mock.client().cdn().getAssetInfo("/assets/project-1/x")).getCode());
  }

  /** No shared scenario can place a safety hold, so this one is placed in storage. */
  @Test void aSafetyHoldWithholdsTheRenderingAndRefusesEveryResourceAndTheTimeline() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Asset asset = mock.client().assets().classify(kept("held.png").setVisibility(Visibility.PUBLIC).build());
    assertEquals(Optional.of(MockApi.MOCK_THUMBHASH), asset.getContent().getPreview().orElseThrow().getThumbhash());
    mock.withStorage(storage -> {
      JsonObject hold = new JsonObject();
      hold.addProperty("reason", "suspected-illegal-content");
      hold.addProperty("placedAt", 1_700_000_000_000L);
      storage.assets.get(asset.getId()).getAsJsonObject("content").add("safetyHold", hold);
    });
    for (String resource : List.of("original", "rendered", "preview", "hls", "embed", "placeholder")) {
      try (CdnResponse served = mock.client().cdn().serve(CdnRequestParams.builder().setAssetId(asset.getId()).setResource(resource).build())) {
        assertEquals(403, served.status(), resource);
        assertEquals("asset/not-available", JsonParser.parseString(new String(served.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8))
            .getAsJsonObject().get("code").getAsString(), resource);
      }
    }
    ApiException held = assertThrows(ApiException.class, () -> mock.client().assets().listTimeline(asset.getId(), null));
    assertEquals(ErrorCodes.ASSET_HELD, held.getCode());
    assertEquals(java.util.Map.of("hold", "safety"), held.getDetails());
    assertEquals(ErrorCodes.ASSET_HELD, assertThrows(ApiException.class,
        () -> mock.client().cdn().signAssetUrl(CdnSignAssetUrlParams.builder().setAssetId(asset.getId()).build())).getCode());
    assertSame(AssetAvailability.UNAVAILABLE, mock.client().cdn().getAssetInfo(
        mock.client().cdn().getAssetUrl(CdnRequestParams.builder().setAssetId(asset.getId()).build())).getAvailability());
    Asset decided = mock.decide(asset.getId(), Outcome.LIMITED);
    assertEquals(Optional.empty(), decided.getContent().getRendered());
    assertEquals(Optional.empty(), decided.getContent().getPreview());
  }

  @Test void aPendingReviewIsRequestedWhenItsDecisionIsApplied() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Asset queued = mock.client().assets().create(kept("queued.png").build());
    Asset decided = mock.completeProcessing(queued.getId(), MockDecision.of("allowed").pendingReview("sampled"));
    assertEquals(decided.getClassification().getCompletedAt().orElseThrow().toEpochMilli(),
        decided.getClassification().getModeration().getPendingReview().orElseThrow().getRequestedAt());
  }

  @Test void aPresetWithoutAFolderKeepsTheUploadsOwn() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Folder folder = mock.client().folders().create(FolderCreateParams.builder().setName("Own").build());
    UploadPreset preset = mock.client().uploadPresets().ensure(List.of(
        UploadPresetParams.builder().setKey("plain").setName("Plain").build())).getUploadPresets().get(0);
    Asset asset = mock.client().assets().create(kept("own.png").setUploadPresetId(preset.getId()).setFolderId(folder.getId()).build());
    assertEquals(Optional.of(folder.getId()), asset.getFolderId());
    assertSame(Visibility.PRIVATE, asset.getVisibility());
  }

  @Test void aPresetSizeLimitChecksAMultipartUploadsDeclaredTotal() {
    long mib = 1 << 20;
    MockCalmLensServerClient mock = new MockCalmLensServerClient(builder().partSizeBytes(5 * mib), deterministic());
    UploadPreset preset = mock.client().uploadPresets().ensure(List.of(
        UploadPresetParams.builder().setKey("small").setName("Small").setMaxSizeInBytes(6 * mib).build())).getUploadPresets().get(0);
    ApiException refused = assertThrows(ApiException.class, () -> mock.client().assets().create(
        AssetCreateParams.builder().setName("clip.mp4").setContent(Content.bytes(new byte[(int) (11 * mib)], "video/mp4")).setUploadPresetId(preset.getId()).build()));
    assertEquals(ErrorCodes.UPLOAD_TOO_LARGE, refused.getCode());
    assertEquals("preset", refused.getDetails().get("source"));
  }
}
