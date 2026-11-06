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

  @Test void uploadsSendTheirTagsAndTheAssetKeepsThem() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Models.Asset uploaded = mock.client.assets.classify(kept("photo.png").tags(List.of("catalogue", "backpacks")));
    assertEquals(List.of("catalogue", "backpacks"), uploaded.tags());
    // A raw upload carries its tags as a JSON array in the query, like metadata.
    assertEquals(JsonParser.parseString("[\"catalogue\",\"backpacks\"]"), JsonParser.parseString(mock.requests().get(0).query().get("tags")));
    Models.Asset text = mock.client.text.classify(new Models.ClassifyText("hello").tags(List.of("comments")));
    assertEquals(List.of("comments"), text.tags());
    Models.Asset linked = mock.client.assets.create(new Models.SubmitAsset().name("site").url("https://example.com").tags(List.of("links")));
    assertEquals(List.of("links"), linked.tags());
    JsonObject body = JsonParser.parseString(new String(mock.requests().get(2).body(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
    assertEquals(JsonParser.parseString("[\"links\"]"), body.get("tags"));
    assertEquals(List.of("catalogue", "backpacks"), mock.client.assets.retrieve(new Models.AssetId(uploaded.id())).tags());
    // Like the API, the processing options an asset was uploaded with are not returned.
    mock.withStorage(storage -> assertFalse(storage.assets.get(uploaded.id()).has("processingOptions")));
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

    Models.AssetPage first = mock.client.assets.list(new Models.ListAssets().filter("folderId==" + folder.id()).pageSize(2).sort("createdAt"));
    assertEquals(List.of("cat-1.png", "cat-2.png"), first.items().stream().map(Models.Asset::name).toList());
    assertTrue(first.hasMore());
    Models.AssetPage second = mock.client.assets.list(new Models.ListAssets().filter("folderId==" + folder.id()).pageSize(2).sort("createdAt").cursor(first.nextCursor()));
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
    assertEquals(hashed.id(), entry.assetId());
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

  /** A schema refusal: {@code validation/invalid-request} whose one issue names the field and its issue code. */
  private static void assertIssue(JsonObject refused, String path, String code) {
    assertEquals(ErrorCodes.INVALID_REQUEST, refused.get("code").getAsString(), path);
    com.google.gson.JsonArray issues = refused.getAsJsonObject("details").getAsJsonArray("issues");
    assertEquals(1, issues.size(), path);
    assertEquals(path, issues.get(0).getAsJsonObject().get("path").getAsString());
    assertEquals(code, issues.get(0).getAsJsonObject().get("code").getAsString(), path);
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
      assertEquals(415, refused.get("status").getAsInt(), type);
      assertEquals(ErrorCodes.UNSUPPORTED_UPLOAD_TYPE, refused.get("code").getAsString(), type);
      assertEquals(type, refused.getAsJsonObject("details").get("mimeType").getAsString(), type);
      assertEquals("calmlens", refused.getAsJsonObject("details").get("source").getAsString(), type);
    }
    assertEquals(200, raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("name", "x", "contentType", "TEXT/Markdown"), "content", null)
        .get("status").getAsInt());
    // A URL upload has no content type to check.
    assertEquals(200, raw(api, "POST", "/projects/project-1/assets", java.util.Map.of(), null, "{\"name\":\"x\",\"url\":\"https://example.com/\"}")
        .get("status").getAsInt());

    JsonObject dict = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of(), null, "{\"name\":\"x\",\"url\":\"https://example.com/\",\"metadata\":{\"a\":1}}");
    assertIssue(dict, "metadata", "validation/invalid-type");
    JsonObject query = raw(api, "POST", "/projects/project-1/assets", java.util.Map.of("name", "x", "contentType", "text/plain", "metadata", "[{\"id\":\"a\"}]"), "content", null);
    assertIssue(query, "metadata.0.value", "validation/invalid-value");
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
    Models.ListEvents uploads = new Models.ListEvents().types(List.of("asset.uploaded", "asset.deleted")).pageSize(1);
    String start = mock.client.events.list(uploads).nextCursor();
    Models.Asset first = mock.client.assets.classify(kept("first.png"));
    Models.Asset second = mock.client.assets.classify(kept("second.png"));
    mock.client.assets.delete(new Models.AssetId(first.id()));
    List<String> seen = new java.util.ArrayList<>();
    for (Models.EventsPage page : mock.client.events.pages(uploads.cursor(start)))
      page.items().forEach(event -> seen.add(event.type() + " " + event.assetId()));
    assertEquals(List.of("asset.uploaded " + first.id(), "asset.uploaded " + second.id(), "asset.deleted " + first.id()), seen);

    MockApi api = new MockApi("project-1", "https://api.calmlens.com/v1", "https://cdn.calmlens.com/v1", deterministic());
    for (String types : List.of("", "asset.uploaded,", "Asset.Uploaded", "uploaded"))
      assertIssue(raw(api, "GET", "/projects/project-1/events", java.util.Map.of("types", types), null, null), "types", "validation/invalid-value");
    assertIssue(raw(api, "GET", "/projects/project-1/events", java.util.Map.of("assetId", "fldr_7Nc4Wq2Lm8Xt5Rk9Bv3P"), null, null),
        "assetId", "validation/invalid-format");
  }

  /** The client sends the types as one comma-separated value, and none when the list is empty. */
  @Test void eventTypesAreSentAsOneCommaSeparatedValue() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    mock.client.events.list(new Models.ListEvents().types(List.of("asset.blocked", "asset.purged")));
    mock.client.events.list(new Models.ListEvents().types(List.of()));
    assertEquals("asset.blocked,asset.purged", mock.requests().get(0).query().get("types"));
    assertFalse(mock.requests().get(1).query().containsKey("types"));
  }

  @Test void enqueuedEventsAreTheApiKeysUnlessGivenAnActor() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    String start = mock.client.events.list(new Models.ListEvents()).nextCursor();
    Models.EventActor reviewer = new Models.EventActor("user", "user_5Rt8Xm3Lq9Vk2Wb7Np4C");
    mock.enqueueEvent("asset.allowed", null);
    mock.enqueueEvent("asset.blocked", null, reviewer);
    assertEquals(List.of(new Models.EventActor("api-key", null), reviewer),
        mock.client.events.list(new Models.ListEvents().cursor(start)).items().stream().map(Models.Event::actor).toList());
  }

  /**
   * The shared scenarios cover a video's embed page and missing stream; this is a text file's and
   * audio's embed page, audio's missing HLS stream, a selector after the embed page, which the SDK refuses to build and the mock refuses before
   * the asset lookup, and blocked content's embed page.
   */
  @Test void theMockServesTheEmbedPageOfAnyAssetButNoHlsStream() throws Exception {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Models.Asset audio = mock.client.assets.classify(new Models.SubmitAsset("song.wav", Models.Content.bytes("wav".getBytes(java.nio.charset.StandardCharsets.UTF_8), "audio/wav"))
        .processingOptions(new Models.ProcessingOptions(true, null, new Models.ProcessingFeatures().streaming(new Models.FeatureOptions(true))))
        .visibility(Models.Visibility.PUBLIC));
    assertSame(Models.AssetRenderedKind.AUDIO, audio.content().rendered().kind());
    assertNull(audio.content().hls());
    Models.Asset note = mock.client.assets.classify(new Models.SubmitAsset("note.txt", Models.Content.bytes("hello".getBytes(java.nio.charset.StandardCharsets.UTF_8), "text/plain"))
        .processingOptions(new Models.ProcessingOptions(true, null, null)).visibility(Models.Visibility.PUBLIC));
    for (Models.Asset asset : List.of(audio, note)) {
      try (CdnResponse embed = mock.client.cdn.serve(new Models.CdnRequest(asset.id()).resource("embed"))) {
        assertEquals(200, embed.status(), asset.name());
        assertEquals("text/html; charset=utf-8", embed.header("Content-Type"));
        assertTrue(new String(embed.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8).startsWith("<!doctype html>"));
      }
    }
    try (CdnResponse hls = mock.client.cdn.serve(new Models.CdnRequest(audio.id()).resource("hls"))) {
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
    mock.decide(note.id(), Outcome.BLOCKED);
    try (CdnResponse blocked = mock.client.cdn.serve(new Models.CdnRequest(note.id()).resource("embed"))) {
      assertEquals(403, blocked.status());
    }
  }

  /** The mock's clock moves a second per reading, so a one-second grant has expired by its first use. */
  @Test void anExpiredGrantIsRefusedByEveryResourceAndTheInfo() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Models.Asset asset = mock.client.assets.classify(kept("private.png").visibility(Models.Visibility.PRIVATE));
    Models.SignedAssetUrl signed = mock.client.cdn.signAssetUrl(new Models.SignAssetUrlOptions(asset.id()).expiresIn(1L));
    try (CdnResponse expired = mock.fetchCdn(signed.url() + "/rendered")) {
      assertEquals(403, expired.status());
      assertEquals(ErrorCodes.SIGNED_URL_EXPIRED, JsonParser.parseString(new String(expired.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8))
          .getAsJsonObject().get("code").getAsString());
    }
    ApiException info = assertThrows(ApiException.class, () -> mock.client.cdn.getAssetInfo(signed.url()));
    assertEquals(ErrorCodes.SIGNED_URL_EXPIRED, info.getCode());
    assertEquals(403, info.getStatus());
  }

  /** getAssetInfo reads the claims the URL carries, sends no API key, and given claims replace the URL's. */
  @Test void assetInfoUsesTheUrlsViewerClaimsUnlessOthersAreGiven() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Models.Asset asset = mock.client.assets.classify(kept("public.png").visibility(Models.Visibility.PUBLIC));
    mock.decide(asset.id(), Outcome.AGE_RESTRICTED);
    String confirmed = mock.client.cdn.getAssetUrl(new Models.CdnRequest(asset.id()).viewerClaims(new Models.ViewerClaims().ageConfirmed(true)));
    mock.clearRequests();
    assertSame(Models.AssetAvailability.AVAILABLE, mock.client.cdn.getAssetInfo(confirmed).availability());
    MockCalmLensServerClient.Request sent = mock.requests().get(0);
    assertEquals("/assets/project-1/" + asset.id() + "/info", sent.path());
    assertEquals("{\"ageConfirmed\":true}", sent.query().get("viewerClaims"));
    assertNull(sent.header("X-Api-Key"));
    assertSame(Models.AssetAvailability.AGE_RESTRICTED, mock.client.cdn.getAssetInfo(confirmed, new Models.ViewerClaims()).availability());
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> mock.client.cdn.getAssetInfo("/assets/project-1/x")).getCode());
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
    for (String resource : List.of("original", "rendered", "preview", "hls", "embed", "placeholder")) {
      try (CdnResponse served = mock.client.cdn.serve(new Models.CdnRequest(asset.id()).resource(resource))) {
        assertEquals(403, served.status(), resource);
        assertEquals("asset/not-available", JsonParser.parseString(new String(served.readAllBytes(1 << 16), java.nio.charset.StandardCharsets.UTF_8))
            .getAsJsonObject().get("code").getAsString(), resource);
      }
    }
    ApiException held = assertThrows(ApiException.class, () -> mock.client.assets.listTimeline(new Models.ListTimeline(asset.id())));
    assertEquals(ErrorCodes.ASSET_HELD, held.getCode());
    assertEquals(java.util.Map.of("hold", "safety"), held.getDetails());
    assertEquals(ErrorCodes.ASSET_HELD, assertThrows(ApiException.class,
        () -> mock.client.cdn.signAssetUrl(new Models.SignAssetUrlOptions(asset.id()))).getCode());
    assertSame(Models.AssetAvailability.UNAVAILABLE, mock.client.cdn.getAssetInfo(mock.client.cdn.getAssetUrl(new Models.CdnRequest(asset.id()))).availability());
    Models.Asset decided = mock.decide(asset.id(), Outcome.LIMITED);
    assertNull(decided.content().rendered());
    assertNull(decided.content().preview());
  }
}
