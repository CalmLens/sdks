package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.InvalidArgumentException;
import com.calmlens.exception.InvalidResponseException;
import com.calmlens.internal.Json;
import com.calmlens.models.*;
import com.calmlens.params.AssetUpdateParams;
import com.calmlens.params.CdnRequestParams;
import com.calmlens.params.EventListParams;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Typed decoding and encoding of nested models, and the guarantees every model makes. */
class ModelsTest {
  /** The fields every asset has, around {@code classification} and {@code content}. */
  private static String asset(String extra) {
    return "{\"id\":\"asset-1\",\"name\":\"photo.png\",\"projectId\":\"project-1\",\"type\":\"image\",\"metadata\":[],\"parentPages\":[],"
        + "\"createdAt\":1700000000000,\"tags\":[\"a\"],\"visibility\":\"private\",\"upload\":{\"status\":\"completed\"},"
        + "\"classification\":{\"status\":\"completed\",\"testInput\":false,\"moderation\":{\"decision\":\"allowed\",\"manualReviews\":[],\"flaggedCategories\":[],\"regions\":[]}},"
        + "\"content\":{\"status\":\"stored\"}" + extra + "}";
  }

  @Test void assetNestedObjectsDecodeIntoTypedModels() {
    Asset asset = Json.GSON.fromJson("""
        {"id":"asset-1","name":"photo.png","projectId":"project-1","type":"image","metadata":[],"parentPages":[],"createdAt":1700000000000,"tags":[],"visibility":"private","uploadPresetId":"preset-1","content":{"status":"removed","removalReason":"retention","updatedAt":1700000000400,"safetyHold":null,"format":"image/png","extension":"png","sizeInBytes":9007199254740993,"checksums":{"sha256":"abc","md5":null},"width":4,"height":3,"durationSeconds":12.5,"pageCount":2,"perceptualHash":"p","perceptualHashQuality":90,"metadata":{"capturedAt":"2026-05-01T12:30:00","cameraMake":"Canon","containsLocation":true,"location":{"latitude":51.5,"longitude":-0.1}},"extractedText":null,"rendered":{"kind":"audio","format":"audio/mp4","width":null,"height":null,"peaks":[0.25,1]},"hls":{"status":"ready","reason":null,"renditions":[{"kind":"audio","width":null,"height":null,"bandwidth":128000,"codecs":"mp4a.40.2"}]},"preview":{"width":1200,"height":300,"thumbhash":"t","averageColor":"#fff"}},"upload":{"status":"completed","updatedAt":1700000000100,"partsReceived":3},"classification":{"status":"completed","testInput":false,"updatedAt":1700000000100,"moderation":{"manualReviews":[{"id":"review-1","decision":"age-restricted","note":"fine","decidedBy":{"type":"user","id":"user-1"},"reviewedAt":1700000000200,"applied":true}],"decision":"age-restricted","flaggedCategories":[],"regions":[],"timeline":{"segmentCount":7},"raw":{"categories":{"harassment":{"status":"evaluated","score":0.7}},"hashMatches":[{"source":"hash-list","hashListId":"list-1","hashListEntryId":"entry-1","distance":12,"action":"block"}]}},"linkDetection":{"status":"evaluated","qrCodes":[{"value":"https://example.com","box":{"left":0.1,"top":0.2,"width":0.3,"height":0.4}}],"links":[{"url":"https://example.com","source":"qr-code"}]},"aiGeneratedDetection":{"status":"evaluated","provenance":"ai-generated","signals":[{"kind":"c2pa","value":"trainedAlgorithmicMedia"}]},"ocr":{"status":"evaluated","textRegions":[{"box":{"left":0.1,"top":0.2,"width":0.3,"height":0.4},"personalInformation":true}]},"completedAt":1700000000300}}
        """, Asset.class);
    assertEquals("preset-1", asset.getUploadPresetId().orElseThrow());
    assertSame(AssetType.IMAGE, asset.getType());
    assertEquals(Instant.ofEpochMilli(1700000000000L), asset.getCreatedAt());
    AssetClassification classification = asset.getClassification();
    assertSame(AssetClassificationStatus.COMPLETED, classification.getStatus());
    assertEquals(Instant.ofEpochMilli(1700000000100L), classification.getUpdatedAt().orElseThrow());
    assertEquals(3, asset.getUpload().getPartsReceived().orElseThrow());
    AssetModeration moderation = classification.getModeration();
    assertSame(AssetModerationDecision.AGE_RESTRICTED, moderation.getDecision().orElseThrow());
    AssetReview review = moderation.getManualReviews().get(0);
    assertSame(AssetModerationDecision.AGE_RESTRICTED, review.getDecision());
    assertEquals("fine", review.getNote().orElseThrow());
    assertEquals(Instant.ofEpochMilli(1700000000200L), review.getReviewedAt());
    assertSame(ReviewerType.USER, review.getDecidedBy().getType());
    assertEquals("user-1", review.getDecidedBy().getId().orElseThrow());
    assertTrue(review.getApplied());
    assertEquals(Instant.ofEpochMilli(1700000000300L), classification.getCompletedAt().orElseThrow());
    assertEquals(0.7, moderation.getRaw().orElseThrow().getCategories().get("harassment").getScore().orElseThrow());
    assertSame(CategoryEvaluationStatus.EVALUATED, moderation.getRaw().orElseThrow().getCategories().get("harassment").getStatus());
    AssetContent content = asset.getContent();
    assertSame(AssetContentStatus.REMOVED, content.getStatus());
    assertSame(ContentRemovalReason.RETENTION, content.getRemovalReason().orElseThrow());
    assertEquals(Instant.ofEpochMilli(1700000000400L), content.getUpdatedAt().orElseThrow());
    assertTrue(content.getSafetyHold().isEmpty());
    assertEquals("image/png", content.getFormat().orElseThrow());
    assertEquals("png", content.getExtension().orElseThrow());
    assertEquals(9007199254740993L, content.getSizeInBytes().orElseThrow());
    Checksums checksums = content.getChecksums().orElseThrow();
    assertEquals("abc", checksums.getSha256().orElseThrow());
    assertTrue(checksums.getMd5().isEmpty());
    assertTrue(checksums.getSha1().isEmpty());
    assertEquals(List.of(4, 3, 2, 90), List.of(content.getWidth().orElseThrow(), content.getHeight().orElseThrow(),
        content.getPageCount().orElseThrow(), content.getPerceptualHashQuality().orElseThrow()));
    assertEquals(12.5, content.getDurationSeconds().orElseThrow());
    assertEquals("p", content.getPerceptualHash().orElseThrow());
    FileMetadata metadata = content.getMetadata().orElseThrow();
    assertEquals("2026-05-01T12:30:00", metadata.getCapturedAt().orElseThrow());
    assertEquals("Canon", metadata.getCameraMake().orElseThrow());
    assertTrue(metadata.getCameraModel().isEmpty());
    assertTrue(metadata.getContainsLocation());
    assertEquals(51.5, metadata.getLocation().orElseThrow().getLatitude());
    assertEquals(-0.1, metadata.getLocation().orElseThrow().getLongitude());
    AssetRendered rendered = content.getRendered().orElseThrow();
    assertSame(AssetRenderedKind.AUDIO, rendered.getKind());
    assertEquals("audio/mp4", rendered.getFormat());
    assertTrue(rendered.getWidth().isEmpty());
    assertEquals(List.of(0.25, 1.0), rendered.getPeaks().orElseThrow());
    AssetHls hls = content.getHls().orElseThrow();
    assertSame(HlsStatus.READY, hls.getStatus());
    assertTrue(hls.getReason().isEmpty());
    AssetHlsRendition rendition = hls.getRenditions().get(0);
    assertEquals(1, hls.getRenditions().size());
    assertSame(HlsRenditionKind.AUDIO, rendition.getKind());
    assertTrue(rendition.getWidth().isEmpty());
    assertEquals(128_000L, rendition.getBandwidth());
    assertEquals("mp4a.40.2", rendition.getCodecs());
    AssetPreview preview = content.getPreview().orElseThrow();
    assertEquals(List.of(1200, 300), List.of(preview.getWidth().orElseThrow(), preview.getHeight().orElseThrow()));
    assertEquals("t", preview.getThumbhash().orElseThrow());
    assertEquals("#fff", preview.getAverageColor().orElseThrow());
    assertEquals(7, moderation.getTimeline().orElseThrow().getSegmentCount());
    HashMatch match = moderation.getRaw().orElseThrow().getHashMatches().get(0);
    assertSame(HashMatchSource.HASH_LIST, match.getSource());
    assertEquals(List.of("list-1", "entry-1"), List.of(match.getHashListId(), match.getHashListEntryId()));
    assertEquals(12, match.getDistance());
    assertSame(HashListAction.BLOCK, match.getAction());
    LinkDetectionResult links = classification.getLinkDetection().orElseThrow();
    assertSame(EvaluationStatus.EVALUATED, links.getStatus());
    DetectedQrCode qr = links.getQrCodes().orElseThrow().get(0);
    assertEquals("https://example.com", qr.getValue());
    assertEquals(List.of(0.1, 0.2, 0.3, 0.4), List.of(qr.getBox().getLeft(), qr.getBox().getTop(), qr.getBox().getWidth(), qr.getBox().getHeight()));
    assertEquals("https://example.com", links.getLinks().orElseThrow().get(0).getUrl());
    assertSame(LinkSource.QR_CODE, links.getLinks().orElseThrow().get(0).getSource());
    AiGeneratedDetectionResult ai = classification.getAiGeneratedDetection().orElseThrow();
    assertEquals("evaluated", ai.getStatus().orElseThrow());
    assertEquals("ai-generated", ai.getProvenance().orElseThrow());
    assertEquals("c2pa", ai.getSignals().orElseThrow().get(0).getKind().orElseThrow());
    assertEquals("trainedAlgorithmicMedia", ai.getSignals().orElseThrow().get(0).getValue().orElseThrow());
    OcrResult ocr = classification.getOcr().orElseThrow();
    assertSame(EvaluationStatus.EVALUATED, ocr.getStatus());
    assertTrue(ocr.getTextRegions().orElseThrow().get(0).getPersonalInformation());
    assertEquals(qr.getBox(), ocr.getTextRegions().orElseThrow().get(0).getBox());
    assertTrue(content.getExtractedText().isEmpty());
  }

  @Test void eventAssetSnapshotsDecodeTheirNestedStatuses() {
    Event event = Json.GSON.fromJson("""
        {
  "id": "event-1",
  "projectId": "project-1",
  "actor": {"type": "automated"},
  "type": "asset.purged",
  "severity": "high",
  "title": "Asset purged",
  "facts": [],
  "createdAt": 1700000000000,
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
        "decision": "purged"
      }
    }
  }
}
        """, Event.class);
    assertSame(EventType.ASSET_PURGED, event.getType());
    assertSame(ActorType.AUTOMATED, event.getActor().getType());
    EventAsset asset = event.getAsset().orElseThrow();
    assertEquals("asset-1", asset.getId());
    assertEquals("ext-1", asset.getExternalId().orElseThrow());
    assertEquals("preset-1", asset.getUploadPresetId().orElseThrow());
    assertSame(UploadStatus.COMPLETED, asset.getUpload().getStatus());
    assertSame(AssetClassificationStatus.COMPLETED, asset.getClassification().getStatus());
    assertTrue(asset.getClassification().getTestInput());
    assertSame(AssetModerationDecision.PURGED, asset.getClassification().getModeration().getDecision().orElseThrow());
    assertSame(AssetContentStatus.REMOVED, asset.getContent().getStatus());
  }

  @Test void lensTransformDecodesTypedImageOptions() {
    Lens lens = Json.GSON.fromJson("""
        {"id": "lens-1", "identifier": "card", "name": "Card", "type": "image", "active": true, "createdAt": 1700000000000, "transform": {
          "format": "webp", "width": 640, "quality": "medium", "dpr": 1.5, "anim": false,
          "border": {"color": "#000", "width": 2},
          "gravity": {"mode": "box-center", "x": 0.5},
          "trim": {"top": 4, "border": {"tolerance": 0.2}}}}
        """, Lens.class);
    ImageTransformOptions options = lens.getTransform().orElseThrow();
    assertEquals("webp", options.format());
    assertEquals(640, options.width());
    assertEquals(Quality.level("medium"), options.quality());
    assertEquals(1.5, options.dpr());
    assertEquals(false, options.anim());
    assertEquals(new ImageBorder("#000", 2.0), options.border());
    assertEquals(Gravity.point("box-center", 0.5, null), options.gravity());
    assertEquals(Trim.edges(new TrimEdges().top(4.0).border(TrimBorder.options(null, 0.2, null))), options.trim());

    ImageTransformOptions named = Json.GSON.fromJson("""
        {"id": "lens-2", "identifier": "face", "name": "Face", "type": "image", "active": true, "createdAt": 1700000000000,
         "transform": {"gravity": "face", "trim": "border"}}
        """, Lens.class).getTransform().orElseThrow();
    assertEquals(Gravity.position("face"), named.gravity());
    assertEquals(Trim.border(), named.trim());
  }

  @Test void typedTransformsEncodeToWireOptionsAndSelectors() {
    ImageTransformOptions transform = new ImageTransformOptions()
        .format("avif")
        .gravity(Gravity.position("entropy"))
        .trim(Trim.edges(new TrimEdges().left(3.0).border(TrimBorder.enabled(true))));
    assertEquals(JsonParser.parseString("""
        {"format": "avif", "gravity": "entropy", "trim": {"left": 3.0, "border": true}}
        """), Json.GSON.toJsonTree(transform));
    assertEquals(transform, Json.GSON.fromJson(Json.GSON.toJson(transform), ImageTransformOptions.class));

    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1").build();
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/format=avif,gravity=entropy,trim.border=true,trim.left=3",
        client.cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("a").setResource("rendered").setTransform(transform).build()));
    ImageTransformOptions point = new ImageTransformOptions().gravity(Gravity.point("remainder", 0.25, 1.0));
    assertEquals("https://cdn.calmlens.com/v1/assets/project-1/a/rendered/gravity.mode=remainder,gravity.x=0.25,gravity.y=1",
        client.cdn().getAssetUrl(CdnRequestParams.builder().setAssetId("a").setResource("rendered").setTransform(point).build()));
  }

  @Test void reportPolicySnapshotDecodesIntoTypedModels() {
    AssetModeration policy = Json.GSON.fromJson("""
        {"manualReviews":[],"categories":{"violence":{"score":0.9,"action":"block","source":{"kind":"allowance","indexes":[0,1]},"settings":{"action":"block","allowances":[],"restrictions":[{"name":"snapshot-rule","when":["violence-graphic","violence-injury"],"unless":["violence-documentary"],"action":"block"}]}}},"explanationComplete":true,"source":"hash-list","flaggedCategories":["violence"],"automatedStatus":"purged","regions":[{"region":"GB","status":"blocked","rule":"regional-rule","category":"violence"}]}
        """, AssetModeration.class);
    CategoryPolicyScore category = policy.getCategories().orElseThrow().get("violence");
    assertEquals(0.9, category.getScore());
    assertSame(PolicyAction.BLOCK, category.getSettings().orElseThrow().getAction());
    PolicyRuleSnapshot restriction = category.getSettings().orElseThrow().getRestrictions().get(0);
    assertEquals("snapshot-rule", restriction.getName().orElseThrow());
    assertEquals(List.of("violence-graphic", "violence-injury"), restriction.getWhen());
    assertSame(ModerationSource.HASH_LIST, policy.getSource().orElseThrow());
    assertSame(AssetModerationDecision.PURGED, policy.getAutomatedStatus().orElseThrow());
    assertTrue(policy.getExplanationComplete().orElseThrow());
    RegionalDecision region = policy.getRegions().get(0);
    assertEquals(1, policy.getRegions().size());
    assertSame(Region.GB, region.getRegion());
    assertSame(RegionalRestriction.BLOCKED, region.getStatus());
    assertEquals("regional-rule", region.getRule());
    assertSame(ModerationCategory.VIOLENCE, region.getCategory().orElseThrow());
    assertEquals(List.of(ModerationCategory.VIOLENCE), policy.getFlaggedCategories());
    assertEquals(List.of("violence-documentary"), restriction.getUnless().orElseThrow());
    assertSame(PolicySourceKind.ALLOWANCE, category.getSource().orElseThrow().getKind());
    assertEquals(List.of(0, 1), category.getSource().orElseThrow().getIndexes().orElseThrow());
    // Not sent: empty, not decoded.
    assertTrue(policy.getDecision().isEmpty());
    assertFalse(policy.hasField("decision"));
  }

  @Test void aMissingRequiredFieldIsAnInvalidResponseWhenRead() {
    // Decoding is lenient; reading the missing field, or validating, fails.
    Lens lens = Json.GSON.fromJson("{\"id\":\"lens-1\",\"name\":\"Card\",\"type\":\"image\",\"active\":true,\"createdAt\":1}", Lens.class);
    assertEquals("lens-1", lens.getId());
    InvalidResponseException top = assertThrows(InvalidResponseException.class, lens::getIdentifier);
    assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, top.getCode());
    assertEquals(Map.of("field", "identifier"), top.getDetails());
    assertEquals(Map.of("field", "identifier"), assertThrows(InvalidResponseException.class, lens::validate).getDetails());
    // A required field of a nested model, too.
    String noModeration = asset("").replace(",\"moderation\":{\"decision\":\"allowed\",\"manualReviews\":[],\"flaggedCategories\":[],\"regions\":[]}", "");
    Asset asset = Json.GSON.fromJson(noModeration, Asset.class);
    InvalidResponseException nested = assertThrows(InvalidResponseException.class, () -> asset.getClassification().getModeration());
    assertEquals(Map.of("field", "moderation"), nested.getDetails());
    assertEquals(Map.of("field", "moderation"), assertThrows(InvalidResponseException.class, asset::validate).getDetails());
    // Sent as null is missing as well.
    Asset nulled = Json.GSON.fromJson(asset("").replace("\"name\":\"photo.png\"", "\"name\":null"), Asset.class);
    assertEquals(Map.of("field", "name"), assertThrows(InvalidResponseException.class, nulled::getName).getDetails());
    // A complete model validates.
    assertSame(Json.GSON.fromJson(asset(""), Asset.class).getClass(), Json.GSON.fromJson(asset(""), Asset.class).validate().getClass());
  }

  /** A client built with responseValidation(true) checks every response as it reads it. */
  @Test void responseValidationChecksResponsesAtOnce() {
    String noName = asset("").replace("\"name\":\"photo.png\",", "");
    Transport transport = request -> new Transport.Response(200, Map.of("content-type", List.of("application/json")), noName.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    CalmLensServerClient lenient = CalmLensServerClient.builder().apiKey("key").projectId("project-1").transport(transport).build();
    assertEquals("asset-1", lenient.assets().retrieve("asset-1").getId());
    CalmLensServerClient strict = CalmLensServerClient.builder().apiKey("key").projectId("project-1").transport(transport).responseValidation(true).build();
    assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, assertThrows(InvalidResponseException.class, () -> strict.assets().retrieve("asset-1")).getCode());
  }

  @Test void unknownFieldsAreKeptInTheRawJsonAndAdditionalProperties() {
    Asset asset = Json.GSON.fromJson(asset(",\"futureField\":{\"a\":1},\"futureFlag\":true"), Asset.class);
    assertEquals(Map.of("futureField", JsonParser.parseString("{\"a\":1}"), "futureFlag", JsonParser.parseString("true")),
        asset.getAdditionalProperties());
    JsonObject raw = asset.getRawJsonObject();
    assertEquals(JsonParser.parseString("{\"a\":1}"), raw.get("futureField"));
    assertEquals("asset-1", raw.get("id").getAsString());
    // Copies: changing them doesn't change the model.
    raw.addProperty("id", "changed");
    assertEquals("asset-1", asset.getRawJsonObject().get("id").getAsString());
    assertThrows(UnsupportedOperationException.class, () -> asset.getAdditionalProperties().put("x", raw));
    // Re-encoding a model keeps the unknown fields.
    assertEquals(JsonParser.parseString("{\"a\":1}"), JsonParser.parseString(asset.toJson()).getAsJsonObject().get("futureField"));
    assertEquals(asset, Json.GSON.fromJson(Json.GSON.toJson(asset), Asset.class));
    // A model without unknown fields has none.
    assertEquals(Map.of(), Json.GSON.fromJson(asset(""), Asset.class).getAdditionalProperties());
  }

  @Test void hasFieldTellsAnAbsentFieldFromOneSentAsNull() {
    Asset absent = Json.GSON.fromJson(asset(""), Asset.class);
    Asset sentNull = Json.GSON.fromJson(asset(",\"description\":null"), Asset.class);
    Asset sent = Json.GSON.fromJson(asset(",\"description\":\"hello\""), Asset.class);
    assertFalse(absent.hasField("description"));
    assertTrue(absent.getDescription().isEmpty());
    assertTrue(sentNull.hasField("description"));
    assertTrue(sentNull.getDescription().isEmpty());
    assertTrue(sent.hasField("description"));
    assertEquals("hello", sent.getDescription().orElseThrow());
    assertNotEquals(absent, sentNull);
  }

  private static String describe(AssetType type) {
    switch (type) {
      case IMAGE: return "image";
      case UNKNOWN: return "unknown";
      default: return "other";
    }
  }

  @Test void unknownEnumValuesDecodeAsUnknown() {
    Asset asset = Json.GSON.fromJson(asset("").replace("\"type\":\"image\"", "\"type\":\"hologram\"")
        .replace("\"visibility\":\"private\"", "\"visibility\":\"unlisted\""), Asset.class);
    assertSame(AssetType.UNKNOWN, asset.getType());
    assertSame(Visibility.UNKNOWN, asset.getVisibility());
    assertEquals("unknown", describe(asset.getType()));
    assertEquals("image", describe(Json.GSON.fromJson(asset(""), Asset.class).getType()));
    // The raw value stays available.
    assertEquals("hologram", asset.getRawJsonObject().get("type").getAsString());
    assertNull(AssetType.UNKNOWN.getValue());
    assertSame(AssetType.UNKNOWN, AssetType.fromValue("hologram"));
    assertSame(AssetType.UNKNOWN, AssetType.fromValue(null));
    assertSame(AssetType.PLAINTEXT_DOCUMENT, AssetType.fromValue("plaintext-document"));
  }

  @Test void unknownEnumValuesCannotBeSent() {
    AssetUpdateParams unknown = AssetUpdateParams.builder().setVisibility(Visibility.UNKNOWN).build();
    InvalidArgumentException error = assertThrows(InvalidArgumentException.class, () -> Json.GSON.toJson(unknown));
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
    EventListParams types = EventListParams.builder().setTypes(List.of(EventType.ASSET_ALLOWED, EventType.UNKNOWN)).build();
    assertThrows(InvalidArgumentException.class, () -> Json.GSON.toJsonTree(types));
    assertEquals(JsonParser.parseString("{\"visibility\":\"public\"}"),
        Json.GSON.toJsonTree(AssetUpdateParams.builder().setVisibility(Visibility.PUBLIC).build()));
  }

  @Test void modelListsAndMapsAreUnmodifiable() {
    Asset asset = Json.GSON.fromJson(asset(",\"metadata\":[{\"id\":\"m\",\"value\":1}]").replace("\"metadata\":[],", ""), Asset.class);
    assertEquals("m", asset.getMetadata().get(0).getId());
    assertThrows(UnsupportedOperationException.class, () -> asset.getTags().add("b"));
    assertThrows(UnsupportedOperationException.class, () -> asset.getMetadata().remove(0));
    assertThrows(UnsupportedOperationException.class, () -> asset.getClassification().getModeration().getRegions().clear());
    AssetModeration moderation = Json.GSON.fromJson(
        "{\"manualReviews\":[],\"flaggedCategories\":[],\"regions\":[],\"raw\":{\"categories\":{},\"hashMatches\":[]}}", AssetModeration.class);
    assertThrows(UnsupportedOperationException.class, () -> moderation.getRaw().orElseThrow().getCategories().put("x", null));
  }

  @Test void modelsReadThroughAClientCarryTheirResponse() {
    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1")
        .transport(request -> new Transport.Response(200, Map.of("Content-Type", List.of("application/json"), "X-Request-Id", List.of("req_models")),
            asset("").getBytes(StandardCharsets.UTF_8)))
        .build();
    Asset asset = client.assets().retrieve("asset-1");
    ApiResponse response = asset.getLastResponse().orElseThrow();
    assertEquals("req_models", response.getRequestId().orElseThrow());
    assertEquals(200, response.getStatus());
    assertEquals("req_models", response.getHeader("x-request-id").orElseThrow());
    // A nested model, or one decoded directly, has none.
    assertTrue(asset.getClassification().getLastResponse().isEmpty());
    assertTrue(Json.GSON.fromJson(asset(""), Asset.class).getLastResponse().isEmpty());
  }
}
