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
        {
  "id": "asset-1",
  "uploadPresetId": "preset-1",
  "content": {
    "status": "removed",
    "removalReason": "retention",
    "updatedAt": 1700000000400,
    "safetyHold": null,
    "format": "image/png",
    "extension": "png",
    "sizeInBytes": 9007199254740993,
    "checksums": {
      "sha256": "abc",
      "md5": null
    },
    "image": {
      "perceptualHash": "p",
      "width": 4,
      "height": 3
    },
    "previewImage": {
      "fileFormat": "webp",
      "thumbhash": "t",
      "averageColor": "#fff",
      "width": 2,
      "height": 1
    },
    "extractedText": null
  },
  "processingOptions": {
    "keepContentAfterProcessing": true,
    "flaggedContentPolicy": {
      "action": "purge"
    }
  },
  "upload": {
    "status": "completed",
    "updatedAt": 1700000000100,
    "partsReceived": 3
  },
  "classification": {
    "status": "completed",
    "updatedAt": 1700000000100,
    "moderation": {
      "action": "hide",
      "reviewerAction": "approved",
      "reviewerNote": "fine",
      "reviewerUserId": "user-2",
      "reviewedAt": 1700000000200,
      "decision": "approved",
      "categories": {
        "harassment": {
          "status": "evaluated",
          "score": 0.7
        }
      },
      "score": 0.7
    },
    "completedAt": 1700000000300
  }
}
        """, Models.Asset.class);
    assertEquals("preset-1", asset.uploadPresetId());
    assertSame(Models.AssetClassificationStatus.COMPLETED, asset.classification().status());
    assertEquals(Instant.ofEpochMilli(1700000000100L), asset.classification().updatedAt());
    assertEquals(3, asset.upload().partsReceived());
    Models.AssetModeration moderation = asset.classification().moderation();
    assertSame(Models.AssetModerationStatus.APPROVED, moderation.decision());
    assertEquals("hide", moderation.action());
    assertEquals("approved", moderation.reviewerAction());
    assertEquals("fine", moderation.reviewerNote());
    assertEquals("user-2", moderation.reviewerUserId());
    assertEquals(Instant.ofEpochMilli(1700000000200L), moderation.reviewedAt());
    assertEquals(Instant.ofEpochMilli(1700000000300L), asset.classification().completedAt());
    assertEquals(0.7, moderation.categories().get("harassment").score());
    Models.AssetContent content = asset.content();
    assertSame(Models.AssetContentStatus.REMOVED, content.status());
    assertEquals("retention", content.removalReason());
    assertEquals(Instant.ofEpochMilli(1700000000400L), content.updatedAt());
    assertNull(content.safetyHold());
    assertEquals("image/png", content.format());
    assertEquals("png", content.extension());
    assertEquals(9007199254740993L, content.sizeInBytes());
    assertEquals(new Models.Checksums(null, null, "abc", null, null), content.checksums());
    assertEquals(new Models.ImageData("p", 4, 3), content.image());
    assertEquals(new Models.PreviewImage("webp", "t", "#fff", 2, 1), content.previewImage());
    assertNull(content.extractedText());
    assertEquals(new Models.FlaggedContentPolicy("purge"), asset.processingOptions().flaggedContentPolicy());
    assertEquals(Boolean.TRUE, asset.processingOptions().keepContentAfterProcessing());
  }

  @Test void eventAssetSnapshotsDecodeTheirNestedStatuses() {
    Models.Event event = Json.GSON.fromJson("""
        {
  "id": "event-1",
  "type": "asset.rejected",
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
      "moderation": {
        "action": "purge",
        "decision": "rejected"
      }
    }
  }
}
        """, Models.Event.class);
    assertEquals(new Models.EventAsset("asset-1", "ext-1", "preset-1",
        new Models.EventAssetUpload("completed"),
        new Models.EventAssetClassification(Models.AssetClassificationStatus.COMPLETED, new Models.EventAssetModeration(Models.AssetModerationStatus.REJECTED, "purge")),
        new Models.EventAssetContent(Models.AssetContentStatus.REMOVED)), event.asset());
  }

  @Test void flaggedContentPolicyEncodesAsAnObject() {
    Models.ProcessingOptions options = new Models.ProcessingOptions().flaggedContentPolicy(new Models.FlaggedContentPolicy("hide"));
    assertEquals(JsonParser.parseString("{\"flaggedContentPolicy\":{\"action\":\"hide\"}}"), Json.GSON.toJsonTree(options));
  }

  @Test void lensTransformsDecodeTypedImageOptions() {
    Models.Lens lens = Json.GSON.fromJson("""
        {"identifier": "card", "type": "image", "transforms": [
          {"type": "imageTransform", "options": {
            "format": "webp", "width": 640,
            "border": {"color": "#000", "width": 2},
            "gravity": {"mode": "box-center", "x": 0.5},
            "trim": {"top": 4, "border": {"tolerance": 0.2}}}},
          {"type": "imageTransform", "options": {"gravity": "face", "trim": "border"}},
          {"type": "videoTransform", "options": {"fps": 12}}]}
        """, Models.Lens.class);
    Models.ImageTransformOptions first = lens.transforms().get(0).options();
    assertEquals("webp", first.format());
    assertEquals(640, first.width());
    assertEquals(new Models.ImageBorder("#000", 2.0), first.border());
    assertEquals(Models.Gravity.point("box-center", 0.5, null), first.gravity());
    assertEquals(Models.Trim.edges(new Models.TrimEdges().top(4.0).border(Models.TrimBorder.options(null, 0.2, null))), first.trim());

    Models.ImageTransformOptions second = lens.transforms().get(1).options();
    assertEquals(Models.Gravity.position("face"), second.gravity());
    assertEquals(Models.Trim.border(), second.trim());

    Models.Transform unknown = lens.transforms().get(2);
    assertEquals("videoTransform", unknown.type());
    assertNull(unknown.options());
  }

  @Test void typedTransformsEncodeToWireOptionsAndSelectors() {
    Models.Transform transform = Models.Transform.image(new Models.ImageTransformOptions()
        .format("avif")
        .gravity(Models.Gravity.position("entropy"))
        .trim(Models.Trim.edges(new Models.TrimEdges().left(3.0).border(Models.TrimBorder.enabled(true)))));
    assertEquals(JsonParser.parseString("""
        {"type": "imageTransform", "options": {"format": "avif", "gravity": "entropy", "trim": {"left": 3.0, "border": true}}}
        """), Json.GSON.toJsonTree(transform));
    assertEquals(transform, Json.GSON.fromJson(Json.GSON.toJson(transform), Models.Transform.class));

    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").build();
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/content/imageTransform[format=avif,gravity=entropy,trim%5Bborder%5D=true,trim%5Bleft%5D=3]",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(transform)));
    Models.Transform point = Models.Transform.image(new Models.ImageTransformOptions().gravity(Models.Gravity.point("remainder", 0.25, 1.0)));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/content/imageTransform[gravity%5Bmode%5D=remainder,gravity%5Bx%5D=0.25,gravity%5By%5D=1]",
        client.cdn.getAssetUrl(new Models.CdnRequest("a").transform(List.of(point))));
  }
  @Test void reportPolicySnapshotDecodesIntoTypedRecords() {
    Models.ReportPolicy policy = Json.GSON.fromJson("""
        {"score":0.9,"categories":{"violence":{"score":0.9,"action":"hide","source":{"kind":"restriction","index":0},"settings":{"threshold":0.6,"categoryAction":"hide","allowances":[],"restrictions":[{"name":"snapshot-rule","when":["violence-graphic"],"action":"hide"}]}}},"decision":{"source":"asset-override","action":"purge","flaggedCategories":["violence"]}}
        """, Models.ReportPolicy.class);
    Models.CategoryPolicyScore category = policy.categories().get("violence");
    assertEquals(0.6, category.settings().threshold());
    assertEquals("snapshot-rule", category.settings().restrictions().get(0).name());
    assertEquals(0, category.source().index());
    assertEquals("asset-override", policy.decision().source());
    assertEquals("purge", policy.decision().action());
    assertEquals(List.of("violence"), policy.decision().flaggedCategories());
  }
}
