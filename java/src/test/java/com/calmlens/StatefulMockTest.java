package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.calmlens.MockCalmLensServerClient.Options;
import com.calmlens.MockCalmLensServerClient.Outcome;
import java.util.List;
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

  private static Models.SubmitAsset kept(String name) {
    return new Models.SubmitAsset(name, Models.Content.bytes(PNG, "image/png"))
        .processingOptions(new Models.ProcessingOptions().keepContentAfterProcessing(true));
  }

  @Test void explainCompletesTheEvidenceAndRerunModeratesAgain() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic().moderate(input -> MockDecision.of(input.queued() ? "pending" : "blocked")));
    Models.Asset asset = mock.client.assets.classify(kept("photo.png"));
    mock.withStorage(storage -> storage.assets.get(asset.id()).getAsJsonObject("classification").getAsJsonObject("moderation")
        .addProperty("explanationComplete", false));
    Models.Asset explained = mock.client.assets.explain(new Models.ExplainAsset(asset.id()));
    assertEquals(true, explained.classification().moderation().explanationComplete());
    assertEquals(Models.AssetModerationStatus.BLOCKED, explained.classification().moderation().status());

    Models.Asset rerun = mock.client.assets.explain(new Models.ExplainAsset(asset.id()).rerun(true));
    assertSame(Models.AssetClassificationStatus.PROCESSING, rerun.classification().status());
    assertEquals(Models.AssetModerationStatus.PENDING, rerun.classification().moderation().status());
    assertEquals(ErrorCodes.ASSET_NOT_DECIDED, assertThrows(ApiException.class,
        () -> mock.client.assets.explain(new Models.ExplainAsset(asset.id()))).getCode());

    mock.decide(asset.id(), Outcome.ALLOWED);
    assertEquals(ErrorCodes.ASSET_REVIEWED, assertThrows(ApiException.class,
        () -> mock.client.assets.explain(new Models.ExplainAsset(asset.id()).rerun(true))).getCode());
  }

  @Test void moderateGetsAMultipartUploadOnceItsFinalPartArrives() {
    List<MockCalmLensServerClient.ModerationInput> inputs = new java.util.ArrayList<>();
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic().moderate(input -> {
      inputs.add(input);
      return MockDecision.of("blocked");
    }));
    byte[] first = new byte[5 * 1024 * 1024];
    first[0] = 'a';
    Models.Asset started = mock.client.assets.create(new Models.SubmitAsset().name("notes.txt").part(Models.Content.bytes(first, "text/plain").partNumber(1).isFinal(false)));
    assertEquals(List.of(), inputs);
    Models.Asset finished = mock.client.assets.uploadPart(new Models.UploadPart(started.id(), Models.Content.bytes("bc".getBytes(java.nio.charset.StandardCharsets.UTF_8), "text/plain").partNumber(2).isFinal(true)));
    assertEquals(Models.AssetModerationStatus.BLOCKED, finished.classification().moderation().status());
    assertEquals(1, inputs.size());
    MockCalmLensServerClient.ModerationInput input = inputs.get(0);
    assertSame(MockCalmLensServerClient.Trigger.UPLOAD, input.trigger());
    assertTrue(input.queued());
    assertSame(Models.AssetClassificationStatus.PROCESSING, input.asset().classification().status());
    byte[] joined = java.util.Arrays.copyOf(first, first.length + 2);
    joined[first.length] = 'b';
    joined[first.length + 1] = 'c';
    assertEquals(new String(joined, java.nio.charset.StandardCharsets.UTF_8), input.content().text());
  }

  @Test void textClassifyStoresAPlaintextDocument() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    assertEquals("plaintext-document", mock.client.text.classify("hello").type());
  }

  /** The shared purge scenario covers the statuses and the CDN refusal; this is the stored bytes being dropped. */
  @Test void purgingDropsTheStoredBytes() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Models.Asset asset = mock.client.assets.create(kept("photo.png"));
    mock.withStorage(storage -> assertTrue(storage.content.containsKey(asset.id())));
    mock.decide(asset.id(), Outcome.PURGED);
    mock.withStorage(storage -> assertFalse(storage.content.containsKey(asset.id())));
  }

  @Test void listPagesWithinAFolderAndErrorsCarryMockRequestIds() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(CalmLensServerClient.builder("mock-key", "project-1").maxRetries(0), deterministic());
    Models.Folder folder = mock.client.folders.create(new Models.CreateFolder("Uploads"));
    for (int i = 1; i <= 3; i++) mock.client.assets.create(new Models.SubmitAsset("cat-" + i + ".png", Models.Content.bytes(PNG, "image/png")).folderId(Models.Patch.value(folder.id())));
    mock.client.assets.create(new Models.SubmitAsset("dog.png", Models.Content.bytes(PNG, "image/png")));

    Models.AssetPage first = mock.client.assets.list(new Models.ListAssets().folderId(folder.id()).pageSize(2)
        .ordering(List.of(new Models.Order().field("createdAt").direction("asc"))));
    assertEquals(List.of("cat-1.png", "cat-2.png"), first.items().stream().map(Models.Asset::name).toList());
    assertTrue(first.hasMore());
    Models.AssetPage second = mock.client.assets.list(new Models.ListAssets().folderId(folder.id()).pageSize(2).cursor(first.nextCursor())
        .ordering(List.of(new Models.Order().field("createdAt").direction("asc"))));
    assertEquals(List.of("cat-3.png"), second.items().stream().map(Models.Asset::name).toList());
    assertFalse(second.hasMore());

    ApiException missing = assertThrows(ApiException.class, () -> mock.client.assets.retrieve(new Models.AssetId("nope")));
    assertTrue(missing.getRequestId().startsWith("req_mock_"), missing.getRequestId());
  }

  /** The shared scenario covers create, update, listing and deletion; this is adding from an asset and the cascade. */
  @Test void hashListEntriesComeFromAnAssetsHashAndGoWithTheirList() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    String hash = "ab".repeat(32);
    Models.Asset hashed = mock.client.assets.classify(kept("hashed.png"));
    Models.Asset unhashed = mock.client.assets.classify(kept("unhashed.png"));
    mock.withStorage(storage -> {
      var content = storage.assets.get(hashed.id()).getAsJsonObject("content");
      content.addProperty("perceptualHash", hash);
      content.addProperty("perceptualHashQuality", 80);
    });
    Models.HashList list = mock.client.hashLists.create(new Models.CreateHashList("Removed", Models.HashListAction.BLOCK));

    Models.HashListEntry entry = mock.client.hashLists.addEntry(new Models.AddHashListEntry(list.id()).assetId(hashed.id()).label("Report 1"));
    assertEquals(hash, entry.hash());
    assertEquals(80, entry.quality());
    assertEquals(hashed.id(), entry.sourceAssetId());
    assertEquals(entry.id(), mock.client.hashLists.addEntry(new Models.AddHashListEntry(list.id()).hash(hash.toUpperCase())).id());
    assertEquals(ErrorCodes.HASH_LIST_ASSET_NOT_HASHED, assertThrows(ApiException.class,
        () -> mock.client.hashLists.addEntry(new Models.AddHashListEntry(list.id()).assetId(unhashed.id()))).getCode());

    Models.HashListEntry second = mock.client.hashLists.addEntry(new Models.AddHashListEntry(list.id()).hash("cd".repeat(32)));
    Models.HashListEntryPage first = mock.client.hashLists.listEntries(new Models.ListHashListEntries(list.id()).pageSize(1));
    assertEquals(List.of(second.id()), first.items().stream().map(Models.HashListEntry::id).toList());
    assertTrue(first.hasMore());
    Models.HashListEntryPage next = mock.client.hashLists.listEntries(new Models.ListHashListEntries(list.id()).pageSize(1).cursor(first.nextCursor()));
    assertEquals(List.of(entry.id()), next.items().stream().map(Models.HashListEntry::id).toList());
    assertFalse(next.hasMore());

    mock.client.hashLists.delete(new Models.HashListId(list.id()));
    assertEquals(ErrorCodes.HASH_LIST_ENTRY_NOT_FOUND, assertThrows(ApiException.class,
        () -> mock.client.hashLists.removeEntry(new Models.HashListEntryId(entry.id()))).getCode());
    assertEquals(List.of(), mock.client.hashLists.list().items());
  }

  /** A request sent straight to the in-memory API, as a client other than this SDK's could send it. */
  private static JsonObject raw(MockApi api, String method, String path, java.util.Map<String, String> query, String upload, String json) throws Exception {
    java.util.Map<String, String> headers = new java.util.LinkedHashMap<>();
    headers.put("Content-Type", upload == null ? "application/json" : "text/plain");
    if (upload != null) headers.put("X-CalmLens-Upload", upload);
    byte[] body = (json == null ? "hello" : json).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    Transport.Response response = api.answer(new MockCalmLensServerClient.Request(method, "https://api.calmlens.com/v1" + path, path, query, headers, body, null));
    JsonObject reply = JsonParser.parseString(new String(response.body().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
    reply.addProperty("status", response.status());
    return reply;
  }

  @Test void theMockRefusesUploadTypesAndMetadataTheApiRefuses() throws Exception {
    MockApi api = new MockApi("project-1", "https://api.calmlens.com/v1", "https://cdn.calmlens.com/v1", deterministic());
    for (String type : List.of("application/zip", "application/octet-stream", "font/woff2")) {
      JsonObject refused = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("name", "x", "contentType", type), "content", null);
      assertEquals(400, refused.get("status").getAsInt(), type);
      assertEquals(ErrorCodes.INVALID_UPLOAD_MIME_TYPE, refused.get("code").getAsString(), type);
      assertEquals(type, refused.getAsJsonObject("details").get("mimeType").getAsString(), type);
    }
    assertEquals(200, raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("name", "x", "contentType", "TEXT/Markdown"), "content", null)
        .get("status").getAsInt());
    // A URL upload has no content type to check.
    assertEquals(200, raw(api, "POST", "/projects/project-1/assets", java.util.Map.of(), null, "{\"name\":\"x\",\"url\":\"https://example.com/\"}")
        .get("status").getAsInt());

    JsonObject dict = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of(), null, "{\"name\":\"x\",\"url\":\"https://example.com/\",\"metadata\":{\"a\":1}}");
    assertEquals("validation/invalid-type", dict.get("code").getAsString());
    assertEquals("metadata", dict.getAsJsonObject("details").get("path").getAsString());
    JsonObject query = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("name", "x", "contentType", "text/plain", "metadata", "[{\"id\":\"a\"}]"), "content", null);
    assertEquals("validation/invalid-value", query.get("code").getAsString());
    assertEquals("metadata.0.value", query.getAsJsonObject("details").get("path").getAsString());
    // Schema checks come before the asset lookup.
    JsonObject update = raw(api, "PATCH", "/assets/asset_missing", java.util.Map.of(), null, "{\"metadata\":[{\"id\":7,\"value\":1}]}");
    assertEquals(400, update.get("status").getAsInt());
    assertEquals("metadata.0.id", update.getAsJsonObject("details").get("path").getAsString());
    JsonObject name = raw(api, "PATCH", "/assets/asset_missing", java.util.Map.of(), null, "{\"name\":null}");
    assertEquals("validation/invalid-type", name.get("code").getAsString());
    assertEquals("name", name.getAsJsonObject("details").get("path").getAsString());
    JsonObject signed = raw(api, "POST", "/assets/asset_missing/signed-url", java.util.Map.of(), null, "{\"resource\":null}");
    assertEquals("validation/invalid-value", signed.get("code").getAsString());
    assertEquals("resource", signed.getAsJsonObject("details").get("path").getAsString());
    // A resource outside the signed ones is refused before the asset lookup too.
    JsonObject placeholder = raw(api, "POST", "/assets/asset_missing/signed-url", java.util.Map.of(), null, "{\"resource\":\"placeholder\"}");
    assertEquals("validation/invalid-value", placeholder.get("code").getAsString());
    assertEquals("resource", placeholder.getAsJsonObject("details").get("path").getAsString());
  }

  /** No shared scenario can place a safety hold, so this one is placed in storage. */
  @Test void aSafetyHoldWithholdsTheRenderingAndRefusesEveryResourceAndTheTimeline() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Models.Asset asset = mock.client.assets.classify(kept("held.png").visibility(Models.Visibility.PUBLIC));
    assertEquals(MockApi.MOCK_THUMBHASH, asset.content().preview().thumbhash());
    mock.withStorage(storage -> {
      JsonObject hold = new JsonObject();
      hold.addProperty("reason", "suspected-illegal-content");
      hold.addProperty("placedAt", 1_700_000_000_000L);
      storage.assets.get(asset.id()).getAsJsonObject("content").add("safetyHold", hold);
    });
    for (String resource : List.of("original", "rendered", "preview", "placeholder")) {
      try (CdnResponse served = mock.client.cdn.serve(new Models.CdnRequest(asset.id()).resource(resource))) {
        assertEquals(403, served.status(), resource);
        assertEquals("asset/not-available", JsonParser.parseString(new String(served.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8))
            .getAsJsonObject().get("code").getAsString(), resource);
      }
    }
    assertEquals(ErrorCodes.ASSET_SAFETY_HELD, assertThrows(ApiException.class,
        () -> mock.client.assets.listTimeline(new Models.ListTimeline(asset.id()))).getCode());
    Models.Asset decided = mock.decide(asset.id(), Outcome.LIMITED);
    assertNull(decided.content().rendered());
    assertNull(decided.content().preview());
  }
}
