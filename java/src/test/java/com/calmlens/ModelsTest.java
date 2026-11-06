package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonParser;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Typed decoding and encoding of nested models. */
class ModelsTest {
  @Test void assetNestedObjectsDecodeIntoTypedRecords() {
    Models.Asset asset = Json.GSON.fromJson("""
        {"id":"asset-1","uploadPresetId":"preset-1","content":{"status":"removed","removalReason":"retention","updatedAt":1700000000400,"safetyHold":null,"format":"image/png","extension":"png","sizeInBytes":9007199254740993,"checksums":{"sha256":"abc","md5":null},"width":4,"height":3,"durationSeconds":12.5,"pageCount":2,"perceptualHash":"p","perceptualHashQuality":90,"metadata":{"capturedAt":"2026-05-01T12:30:00","cameraMake":"Canon","containsLocation":true,"location":{"latitude":51.5,"longitude":-0.1}},"extractedText":null,"rendered":{"kind":"audio","format":"audio/mp4","width":null,"height":null,"peaks":[0.25,1]},"hls":{"renditions":[{"kind":"audio","width":null,"height":null,"bandwidth":128000,"codecs":"mp4a.40.2"}]},"preview":{"width":1200,"height":300,"thumbhash":"t","averageColor":"#fff"}},"upload":{"status":"completed","updatedAt":1700000000100,"partsReceived":3},"classification":{"status":"completed","updatedAt":1700000000100,"moderation":{"manualReviews":[{"id":"review-1","decision":"age-restricted","note":"fine","decidedBy":{"type":"user","id":"user-1"},"reviewedAt":1700000000200,"applied":true}],"status":"age-restricted","flaggedCategories":[],"regions":[],"timeline":{"segmentCount":7},"raw":{"categories":{"harassment":{"status":"evaluated","score":0.7}},"hashMatches":[{"source":"hash-list","hashListId":"list-1","hashListEntryId":"entry-1","distance":12,"action":"block"}]}},"linkDetection":{"status":"evaluated","qrCodes":[{"value":"https://example.com","box":{"left":0.1,"top":0.2,"width":0.3,"height":0.4}}],"links":[{"url":"https://example.com","source":"qr-code"}]},"aiGeneratedDetection":{"status":"evaluated","provenance":"ai-generated","signals":[{"kind":"c2pa","value":"trainedAlgorithmicMedia"}]},"ocr":{"status":"evaluated","textRegions":[{"box":{"left":0.1,"top":0.2,"width":0.3,"height":0.4},"personalInformation":true}]},"completedAt":1700000000300}}
        """, Models.Asset.class);
    assertEquals("preset-1", asset.uploadPresetId());
    assertSame(Models.AssetClassificationStatus.COMPLETED, asset.classification().status());
    assertEquals(Instant.ofEpochMilli(1700000000100L), asset.classification().updatedAt());
    assertEquals(3, asset.upload().partsReceived());
    Models.AssetModeration moderation = asset.classification().moderation();
    assertSame(Models.AssetModerationStatus.AGE_RESTRICTED, moderation.status());
    assertSame(Models.AssetModerationDecision.AGE_RESTRICTED, moderation.manualReviews().get(0).decision());
    assertEquals("fine", moderation.manualReviews().get(0).note());
    assertEquals(Instant.ofEpochMilli(1700000000200L), moderation.manualReviews().get(0).reviewedAt());
    assertEquals(new Models.ReviewDecider("user", "user-1"), moderation.manualReviews().get(0).decidedBy());
    assertTrue(moderation.manualReviews().get(0).applied());
    assertEquals(Instant.ofEpochMilli(1700000000300L), asset.classification().completedAt());
    assertEquals(0.7, moderation.raw().categories().get("harassment").score());
    Models.AssetContent content = asset.content();
    assertSame(Models.AssetContentStatus.REMOVED, content.status());
    assertEquals("retention", content.removalReason());
    assertEquals(Instant.ofEpochMilli(1700000000400L), content.updatedAt());
    assertNull(content.safetyHold());
    assertEquals("image/png", content.format());
    assertEquals("png", content.extension());
    assertEquals(9007199254740993L, content.sizeInBytes());
    assertEquals(new Models.Checksums(null, null, "abc", null, null), content.checksums());
    assertEquals(List.of(4, 3, 2, 90), List.of(content.width(), content.height(), content.pageCount(), content.perceptualHashQuality()));
    assertEquals(12.5, content.durationSeconds());
    assertEquals("p", content.perceptualHash());
    assertEquals(new Models.FileMetadata("2026-05-01T12:30:00", "Canon", null, null, null, null, null, null, true,
        new Models.FileMetadataLocation(51.5, -0.1)), content.metadata());
    assertSame(Models.AssetRenderedKind.AUDIO, content.rendered().kind());
    assertEquals(new Models.AssetRendered(Models.AssetRenderedKind.AUDIO, "audio/mp4", null, null, List.of(0.25, 1.0)), content.rendered());
    assertEquals(new Models.AssetHls(List.of(new Models.AssetHlsRendition("audio", null, null, 128_000L, "mp4a.40.2"))), content.hls());
    assertEquals(new Models.AssetPreview(1200, 300, "t", "#fff"), content.preview());
    assertEquals(new Models.ModerationTimeline(7), moderation.timeline());
    Models.BoundingBox box = new Models.BoundingBox(0.1, 0.2, 0.3, 0.4);
    assertEquals(List.of(new Models.HashMatch("hash-list", "list-1", "entry-1", 12, Models.HashListAction.BLOCK)), moderation.raw().hashMatches());
    assertEquals(new Models.LinkDetectionResult("evaluated", null, List.of(new Models.DetectedQrCode("https://example.com", box)),
        List.of(new Models.DetectedLink("https://example.com", "qr-code"))), asset.classification().linkDetection());
    assertEquals(new Models.AiGeneratedDetectionResult("evaluated", null, "ai-generated",
        List.of(new Models.ProvenanceSignal("c2pa", "trainedAlgorithmicMedia"))), asset.classification().aiGeneratedDetection());
    assertEquals(new Models.OcrResult("evaluated", null, List.of(new Models.TextRegion(box, true))), asset.classification().ocr());
    assertNull(content.extractedText());
  }

  @Test void eventAssetSnapshotsDecodeTheirNestedStatuses() {
    Models.Event event = Json.GSON.fromJson("""
        {
  "id": "event-1",
  "type": "asset.purged",
  "asset": {
    "id": "asset-1",
    "externalId": "ext-1",
    "uploadPresetId": "preset-1",
    "content": {
      "status": "removed"
    },
    "upload": {
      "status": "completed"
    },
    "classification": {
      "status": "completed",
      "testInput": true,
      "moderation": {
        "status": "purged"
      }
    }
  }
}
        """, Models.Event.class);
    assertEquals(new Models.EventAsset("asset-1", "ext-1", "preset-1",
        new Models.EventAssetUpload("completed"),
        new Models.EventAssetClassification(Models.AssetClassificationStatus.COMPLETED, Boolean.TRUE, new Models.EventAssetModeration(Models.AssetModerationStatus.PURGED)),
        new Models.EventAssetContent(Models.AssetContentStatus.REMOVED)), event.asset());
  }

  @Test void lensTransformDecodesTypedImageOptions() {
    Models.Lens lens = Json.GSON.fromJson("""
        {"identifier": "card", "type": "image", "transform": {
          "format": "webp", "width": 640, "quality": "medium", "dpr": 1.5, "anim": false,
          "border": {"color": "#000", "width": 2},
          "gravity": {"mode": "box-center", "x": 0.5},
          "trim": {"top": 4, "border": {"tolerance": 0.2}}}}
        """, Models.Lens.class);
    Models.ImageTransformOptions options = lens.transform();
    assertEquals("webp", options.format());
    assertEquals(640, options.width());
    assertEquals(Models.Quality.level("medium"), options.quality());
    assertEquals(1.5, options.dpr());
    assertEquals(false, options.anim());
    assertEquals(new Models.ImageBorder("#000", 2.0), options.border());
    assertEquals(Models.Gravity.point("box-center", 0.5, null), options.gravity());
    assertEquals(Models.Trim.edges(new Models.TrimEdges().top(4.0).border(Models.TrimBorder.options(null, 0.2, null))), options.trim());

    Models.ImageTransformOptions named = Json.GSON.fromJson("""
        {"identifier": "face", "type": "image", "transform": {"gravity": "face", "trim": "border"}}
        """, Models.Lens.class).transform();
    assertEquals(Models.Gravity.position("face"), named.gravity());
    assertEquals(Models.Trim.border(), named.trim());
  }

  @Test void typedTransformsEncodeToWireOptionsAndSelectors() {
    Models.ImageTransformOptions transform = new Models.ImageTransformOptions()
        .format("avif")
        .gravity(Models.Gravity.position("entropy"))
        .trim(Models.Trim.edges(new Models.TrimEdges().left(3.0).border(Models.TrimBorder.enabled(true))));
    assertEquals(JsonParser.parseString("""
        {"format": "avif", "gravity": "entropy", "trim": {"left": 3.0, "border": true}}
        """), Json.GSON.toJsonTree(transform));
    assertEquals(transform, Json.GSON.fromJson(Json.GSON.toJson(transform), Models.ImageTransformOptions.class));

    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").build();
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/format=avif,gravity=entropy,trim.border=true,trim.left=3",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").resource("rendered").transform(transform)));
    Models.ImageTransformOptions point = new Models.ImageTransformOptions().gravity(Models.Gravity.point("remainder", 0.25, 1.0));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/gravity.mode=remainder,gravity.x=0.25,gravity.y=1",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").resource("rendered").transform(point)));
  }
  @Test void reportPolicySnapshotDecodesIntoTypedRecords() {
    Models.AssetModeration policy = Json.GSON.fromJson("""
        {"categories":{"violence":{"score":0.9,"action":"block","source":{"kind":"allowance","indexes":[0,1]},"settings":{"action":"block","allowances":[],"restrictions":[{"name":"snapshot-rule","when":["violence-graphic","violence-injury"],"unless":["violence-documentary"],"action":"block"}]}}},"explanationComplete":true,"source":"hash-list","flaggedCategories":["violence"],"automatedStatus":"purged","regions":[{"region":"GB","status":"blocked","rule":"regional-rule","category":"violence"}]}
        """, Models.AssetModeration.class);
    Models.CategoryPolicyScore category = policy.categories().get("violence");
    assertEquals("block", category.settings().action());
    assertEquals("snapshot-rule", category.settings().restrictions().get(0).name());
    assertEquals("hash-list", policy.source());
    assertSame(Models.AssetModerationStatus.PURGED, policy.automatedStatus());
    assertEquals(List.of(new Models.RegionalDecision("GB", Models.AssetModerationStatus.BLOCKED, "regional-rule", "violence")), policy.regions());
    assertEquals(List.of("violence"), policy.flaggedCategories());
    assertEquals(List.of("violence-documentary"), category.settings().restrictions().get(0).unless());
    assertEquals(List.of(0, 1), category.source().indexes());
  }
}
