package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

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
    return new Options().createId(() -> "id-" + ids.incrementAndGet()).now(() -> clock.addAndGet(1000));
  }

  private static Models.SubmitAsset kept(String name) {
    return new Models.SubmitAsset(name, Models.Content.bytes(PNG, "image/png"))
        .processingOptions(new Models.ProcessingOptions().keepContentAfterProcessing(true));
  }

  @Test void explainCompletesTheEvidenceAndRerunModeratesAgain() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient(deterministic().analyzedOutcome(Outcome.BLOCKED));
    Models.Asset asset = mock.client.assets.classify(kept("photo.png"));
    mock.withStorage(storage -> storage.assets.get(asset.id()).getAsJsonObject("classification").getAsJsonObject("moderation")
        .add("policy", JsonParser.parseString("{\"score\":0.9,\"categories\":{},\"evidence\":\"decision\"}")));
    Models.Asset explained = mock.client.assets.explain(new Models.ExplainAsset(asset.id()));
    assertEquals("full", explained.classification().moderation().policy().evidence());
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
        .ordering(List.of(new Models.Order().field("createdAt").direction("ASC"))));
    assertEquals(List.of("cat-1.png", "cat-2.png"), first.items().stream().map(Models.Asset::name).toList());
    assertTrue(first.hasMore());
    Models.AssetPage second = mock.client.assets.list(new Models.ListAssets().folderId(folder.id()).pageSize(2).cursor(first.nextCursor())
        .ordering(List.of(new Models.Order().field("createdAt").direction("ASC"))));
    assertEquals(List.of("cat-3.png"), second.items().stream().map(Models.Asset::name).toList());
    assertFalse(second.hasMore());

    ApiException missing = assertThrows(ApiException.class, () -> mock.client.assets.retrieve(new Models.AssetId("nope")));
    assertTrue(missing.getRequestId().startsWith("req_mock_"), missing.getRequestId());
  }
}
