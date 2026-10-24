package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonParser;
import com.calmlens.MockCalmLensServerClient.Grant;
import com.calmlens.MockCalmLensServerClient.Options;
import com.calmlens.MockCalmLensServerClient.Outcome;
import java.nio.charset.StandardCharsets;
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
    return new Options().createId(() -> "id-" + ids.incrementAndGet()).now(() -> clock.addAndGet(1000));
  }

  private static Models.SubmitAsset kept(String name) {
    return new Models.SubmitAsset(name, Models.Content.bytes(PNG, "image/png"))
        .processingOptions(new Models.ProcessingOptions().keepContentAfterProcessing(true));
  }

  private static MockCalmLensServerClient withDownloadKey(Options options) {
    return new MockCalmLensServerClient(CalmLensServerClient.builder(MockCalmLensServerClient.createMockApiKey(Grant.download()), "project-1")
        .baseUrl("https://api.calmlens.invalid/v1").cdnBaseUrl("https://cdn.calmlens.invalid/v1"), options);
  }

  private static String errorCode(CdnResponse response) {
    return JsonParser.parseString(new String(response.readAllBytes(10_000), StandardCharsets.UTF_8)).getAsJsonObject().get("code").getAsString();
  }

  @Test void createdAssetsStayPendingUntilAReviewerDecides() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic());
    Models.Asset created = mock.client.assets.create("photo.png", PNG, "image/png");
    Models.Asset other = mock.client.assets.create("other.png", PNG, "image/png");
    assertEquals(Models.AssetModerationStatus.PENDING, created.classification().moderation().status());
    assertSame(Models.AssetClassificationStatus.PROCESSING, created.classification().status());
    String cursor = mock.client.events.list(new Models.ListEvents()).cursor();

    mock.decide(created.id(), Outcome.BLOCKED);

    Models.Asset retrieved = mock.client.assets.retrieve(new Models.AssetId(created.id()));
    assertEquals(Models.AssetModerationStatus.BLOCKED, retrieved.classification().moderation().status());
    assertSame(Models.AssetClassificationStatus.COMPLETED, retrieved.classification().status());
    assertEquals(Models.AssetModerationDecision.BLOCKED, retrieved.classification().moderation().manualReviews().get(0).decision());
    assertEquals(Models.AssetModerationStatus.BLOCKED,
        mock.client.assets.waitForDecision(new Models.WaitForDecision(created.id())).classification().moderation().status());
    assertEquals(List.of(created.id()), mock.client.assets.list(new Models.ListAssets().filter("classification.moderation.status==blocked"))
        .items().stream().map(Models.Asset::id).toList());
    assertEquals(Models.AssetModerationStatus.PENDING,
        mock.client.assets.retrieve(new Models.AssetId(other.id())).classification().moderation().status());

    Models.EventsPage page = mock.client.events.list(new Models.ListEvents().after(cursor));
    assertEquals(1, page.events().size());
    Models.Event event = page.events().get(0);
    assertEquals("asset.blocked", event.type());
    assertEquals(created.id(), event.assetId());
    assertEquals(Models.AssetModerationStatus.BLOCKED, event.asset().classification().moderation().status());
    assertEquals(new Models.EventFact("decided-by", "reviewer", null), event.facts().get(0));
    assertEquals(List.of(), mock.client.events.list(new Models.ListEvents().after(page.cursor())).events());
  }

  @Test void classifyEndsAtTheAnalyzedOutcome() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic().analyzedOutcome(Outcome.AGE_RESTRICTED));
    Models.Asset image = mock.client.assets.classify(kept("photo.png"));
    assertEquals(Models.AssetModerationStatus.AGE_RESTRICTED, image.classification().moderation().status());
    assertSame(Models.AssetClassificationStatus.COMPLETED, image.classification().status());
    assertSame(Models.AssetContentStatus.STORED, image.content().status());
    Models.Asset text = mock.client.text.classify("hello");
    assertEquals(Models.AssetModerationStatus.AGE_RESTRICTED, text.classification().moderation().status());
    assertEquals("plaintext-document", text.type());
    // Content not kept is removed once processing finishes; queued uploads still use the queued outcome.
    assertSame(Models.AssetContentStatus.REMOVED, text.content().status());
    assertEquals("retention", text.content().removalReason());
    assertEquals(Models.AssetModerationStatus.PENDING, mock.client.assets.create(kept("queued.png")).classification().moderation().status());
  }

  @Test void cdnServesPrivateAndAgeRestrictedContentOnlyWithTheDownloadPermission() {
    MockCalmLensServerClient anonymous = new MockCalmLensServerClient(deterministic());
    Models.Asset hidden = anonymous.client.assets.classify(kept("photo.png"));
    try (CdnResponse denied = anonymous.client.cdn.serve(new Models.CdnRequest(hidden.id()))) {
      assertEquals(403, denied.status());
      assertEquals("asset/api-key-missing-permission", errorCode(denied));
    }

    MockCalmLensServerClient granted = withDownloadKey(deterministic());
    Models.Asset stored = granted.client.assets.classify(kept("photo.png"));
    try (CdnResponse served = granted.client.cdn.serve(new Models.CdnRequest(stored.id()))) {
      assertEquals(200, served.status());
      assertEquals("image/png", served.header("Content-Type"));
      assertArrayEquals(PNG, served.readAllBytes(100));
    }

    MockCalmLensServerClient restricted = new MockCalmLensServerClient(deterministic().analyzedOutcome(Outcome.AGE_RESTRICTED));
    Models.Asset adult = restricted.client.assets.classify(kept("adult.png").visibility(Models.Visibility.PUBLIC));
    try (CdnResponse denied = restricted.client.cdn.serve(new Models.CdnRequest(adult.id()))) {
      assertEquals(403, denied.status());
    }
    try (CdnResponse allowed = restricted.client.cdn.serve(new Models.CdnRequest(adult.id()).allowAgeRestricted(true))) {
      assertEquals(200, allowed.status());
      assertArrayEquals(PNG, allowed.readAllBytes(100));
    }
  }

  @Test void purgedRemovesTheContent() {
    MockCalmLensServerClient mock = withDownloadKey(deterministic());
    Models.Asset asset = mock.client.assets.create(kept("photo.png"));
    try (CdnResponse before = mock.client.cdn.serve(new Models.CdnRequest(asset.id()))) {
      assertEquals(200, before.status());
    }

    Models.Asset purged = mock.decide(asset.id(), Outcome.PURGED);

    assertSame(Models.AssetContentStatus.REMOVED, purged.content().status());
    assertEquals("policy", purged.content().removalReason());
    assertSame(Models.AssetContentStatus.REMOVED, mock.client.assets.retrieve(new Models.AssetId(asset.id())).content().status());
    mock.withStorage(storage -> assertFalse(storage.content.containsKey(asset.id())));
    try (CdnResponse after = mock.client.cdn.serve(new Models.CdnRequest(asset.id()))) {
      assertEquals(404, after.status());
      assertEquals(ErrorCodes.ASSET_CONTENT_UNAVAILABLE, errorCode(after));
    }

    MockCalmLensServerClient analyzed = withDownloadKey(deterministic().analyzedOutcome(Outcome.PURGED));
    Models.Asset classified = analyzed.client.assets.classify(kept("photo.png"));
    assertEquals(Models.AssetModerationStatus.PURGED, classified.classification().moderation().status());
    assertEquals("policy", classified.content().removalReason());
  }

  @Test void listsSearchesErrorsAndIdempotencyLookLikeTheApi() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(CalmLensServerClient.builder("mock-key", "project-1").maxRetries(0), deterministic());
    Models.Folder folder = mock.client.folders.create(new Models.CreateFolder("Uploads"));
    for (int i = 1; i <= 3; i++) mock.client.assets.create(new Models.SubmitAsset("cat-" + i + ".png", Models.Content.bytes(PNG, "image/png")).folderId(Models.Patch.value(folder.id())));
    mock.client.assets.create(new Models.SubmitAsset("dog.png", Models.Content.bytes(PNG, "image/png")).externalId("dog-1"));

    Models.AssetPage first = mock.client.assets.list(new Models.ListAssets().folderId(folder.id()).pageSize(2)
        .ordering(List.of(new Models.Order().field("createdAt").direction("ASC"))));
    assertEquals(List.of("cat-1.png", "cat-2.png"), first.items().stream().map(Models.Asset::name).toList());
    assertTrue(first.hasMore());
    Models.AssetPage second = mock.client.assets.list(new Models.ListAssets().folderId(folder.id()).pageSize(2).cursor(first.nextCursor())
        .ordering(List.of(new Models.Order().field("createdAt").direction("ASC"))));
    assertEquals(List.of("cat-3.png"), second.items().stream().map(Models.Asset::name).toList());
    assertFalse(second.hasMore());

    Models.AssetSearchResponse found = mock.client.assets.search(new Models.SearchAssets().query("dog-1"));
    assertEquals(List.of("dog.png"), found.items().stream().map(match -> match.asset().name()).toList());
    assertEquals(List.of("externalId"), found.items().get(0).matchedFields());

    ApiException missing = assertThrows(ApiException.class, () -> mock.client.assets.retrieve(new Models.AssetId("nope")));
    assertEquals(ErrorCodes.ASSET_NOT_FOUND, missing.getCode());
    assertEquals(404, missing.getStatus());
    assertTrue(missing.getRequestId().startsWith("req_mock_"), missing.getRequestId());
    assertEquals(ErrorCodes.DUPLICATE_EXTERNAL_ID, assertThrows(ApiException.class, () -> mock.client.assets.create(
        new Models.SubmitAsset("again.png", Models.Content.bytes(PNG, "image/png")).externalId("dog-1"))).getCode());
    assertEquals(ErrorCodes.FOLDER_NOT_EMPTY, assertThrows(ApiException.class, () -> mock.client.folders.delete(new Models.FolderId(folder.id()))).getCode());

    RequestOptions key = new RequestOptions().idempotencyKey("upload-1");
    Models.Asset once = mock.client.assets.create(new Models.SubmitAsset("same.png", Models.Content.bytes(PNG, "image/png")), key);
    Models.Asset replayed = mock.client.assets.create(new Models.SubmitAsset("same.png", Models.Content.bytes(PNG, "image/png")), key);
    assertEquals(once.id(), replayed.id());
    mock.withStorage(storage -> assertEquals(1, storage.assets.values().stream().filter(a -> a.get("name").getAsString().equals("same.png")).count()));
    assertEquals(ErrorCodes.IDEMPOTENCY_KEY_REUSED, assertThrows(ApiException.class,
        () -> mock.client.assets.create(new Models.SubmitAsset("different.png", Models.Content.bytes(PNG, "image/png")), key)).getCode());
  }
}
