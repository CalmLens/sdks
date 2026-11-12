package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.CalmLensException;
import com.calmlens.exception.ConfigurationException;
import com.calmlens.exception.InvalidArgumentException;
import com.calmlens.internal.Json;
import com.calmlens.models.Jurisdiction;
import com.calmlens.models.MetadataField;
import com.calmlens.models.MetadataFieldIcon;
import com.calmlens.models.MetadataFieldType;
import com.calmlens.models.MetadataFieldsResource;
import com.calmlens.models.ProjectSettingsResource;
import com.calmlens.models.RemoteUrlMode;
import com.calmlens.models.UploadPreset;
import com.calmlens.models.UploadPresetAccess;
import com.calmlens.models.Visibility;
import com.calmlens.params.AssetUpdateParams;
import com.calmlens.params.HumanReviewSettingsParams;
import com.calmlens.params.MetadataFieldParams;
import com.calmlens.params.MetadataFieldsDeleteParams;
import com.calmlens.params.MetadataFieldsEnsureParams;
import com.calmlens.params.ProcessingOptionsParams;
import com.calmlens.params.ProjectSettingsParams;
import com.calmlens.params.ProjectSettingsUpdateParams;
import com.calmlens.params.RemoteUrlRuleParams;
import com.calmlens.params.UploadPresetListParams;
import com.calmlens.params.UploadPresetParams;
import com.calmlens.testing.MockCalmLensServerClient;
import com.calmlens.testing.MockCalmLensServerClient.Options;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** Client setup, the typed builders, which the shared fixtures bypass by decoding options, and what the mock keeps. */
class ConfigurationTest {
  private static MockCalmLensServerClient mock() {
    AtomicInteger ids = new AtomicInteger();
    AtomicLong clock = new AtomicLong(1_700_000_000_000L);
    return new MockCalmLensServerClient(new Options()
        .createId(prefix -> prefix + "_" + String.format("%020d", ids.incrementAndGet())).now(() -> clock.addAndGet(1000)));
  }

  private static JsonObject lastBody(MockCalmLensServerClient mock) {
    List<MockCalmLensServerClient.Request> requests = mock.requests();
    return JsonParser.parseString(requests.get(requests.size() - 1).bodyText()).getAsJsonObject();
  }

  private static UploadPresetParams.Builder preset(String key, String name) { return UploadPresetParams.builder().setKey(key).setName(name); }

  private static List<UploadPreset> ensure(MockCalmLensServerClient mock, UploadPresetParams.Builder... presets) {
    List<UploadPresetParams> params = new ArrayList<>();
    for (UploadPresetParams.Builder builder : presets) params.add(builder.build());
    return mock.client().uploadPresets().ensure(params).getUploadPresets();
  }

  private static MetadataFieldParams field(String id, String title, String description, MetadataFieldIcon icon, String color) {
    return MetadataFieldParams.builder().setId(id).setTitle(title).setDescription(description).setType(MetadataFieldType.STRING)
        .setIcon(icon).setColor(color).build();
  }

  /** The fields as JSON: params as they are sent, models as the API returned them. */
  private static List<JsonElement> fieldsJson(List<?> fields) {
    List<JsonElement> json = new ArrayList<>();
    for (Object field : fields)
      json.add(field instanceof MetadataField model ? model.getRawJsonObject() : Json.GSON.toJsonTree(field));
    return json;
  }

  /** One request as a custom transport received it, with its body read. */
  private record Captured(Transport.Request request, String body) {}

  /** A transport that records each request and answers with a completed asset. */
  private static Transport capturing(List<Captured> sent) {
    return request -> {
      String body = null;
      if (request.body() != null) try (InputStream in = request.body().open()) { body = new String(in.readAllBytes(), StandardCharsets.UTF_8); }
      sent.add(new Captured(request, body));
      return Fixtures.json(200, Fixtures.assetJson("asset-1", "completed", "allowed"));
    };
  }

  private static String header(Transport.Request request, String name) {
    for (Map.Entry<String, String> entry : request.headers().entrySet()) if (entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
    return null;
  }

  @Test void anApiKeyOutsidePrintableAsciiIsRefusedBeforeAnyRequest() {
    for (String key : List.of("kéy", "key\u007f", "key\u0000"))
      assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class, () -> new CalmLensServerClient(key, "project-1")).getCode());
  }

  @Test void buildRefusesAMissingApiKeyOrProject() {
    List<CalmLensServerClient.Builder> incomplete = List.of(CalmLensServerClient.builder(), CalmLensServerClient.builder().apiKey("key"),
        CalmLensServerClient.builder().projectId("project-1"), CalmLensServerClient.builder().apiKey(" ").projectId("project-1"),
        CalmLensServerClient.builder().apiKey("key").projectId(""));
    for (CalmLensServerClient.Builder builder : incomplete)
      assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(ConfigurationException.class, builder::build, builder.toString()).getCode());
  }

  @Test void fromEnvReadsTheApiKeyProjectAndBaseUrlFromSystemProperties() {
    Map<String, String> settings = Map.of("calmlens.apiKey", "prop-key", "calmlens.projectId", "prop-project", "calmlens.baseUrl", "http://localhost:6110/v1");
    Map<String, String> previous = new java.util.HashMap<>();
    settings.keySet().forEach(name -> previous.put(name, System.getProperty(name)));
    try {
      settings.forEach(System::setProperty);
      List<Captured> sent = new ArrayList<>();
      CalmLensServerClient client = CalmLensServerClient.builder().fromEnv().transport(capturing(sent)).build();
      assertEquals("prop-project", client.getProjectId());
      assertEquals("http://localhost:6110/v1", client.getBaseUrl());
      client.assets().retrieve("asset-1");
      assertEquals("http://localhost:6110/v1/assets/asset-1", sent.get(0).request().uri().toString());
      assertEquals("prop-key", header(sent.get(0).request(), "X-Api-Key"));
    } finally {
      previous.forEach((name, value) -> { if (value == null) System.clearProperty(name); else System.setProperty(name, value); });
    }
  }

  @Test void appInfoIsAppendedToTheUserAgent() {
    List<Captured> sent = new ArrayList<>();
    CalmLensServerClient.builder().apiKey("key").projectId("project-1").appInfo("acme-plugin", "1.2.3", "https://acme.example")
        .transport(capturing(sent)).build().assets().retrieve("asset-1");
    CalmLensServerClient.builder().apiKey("key").projectId("project-1").appInfo("acme-plugin", null, null)
        .transport(capturing(sent)).build().assets().retrieve("asset-1");
    String sdk = "calmlens-java/" + CalmLensServerClient.VERSION + " (java/" + Runtime.version() + ")";
    assertEquals(sdk + " acme-plugin/1.2.3 (https://acme.example)", header(sent.get(0).request(), "User-Agent"));
    assertEquals(sdk + " acme-plugin", header(sent.get(1).request(), "User-Agent"));
  }

  @Test void requestOptionHeadersAreSentButSdkHeadersAreRefused() {
    List<Captured> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1").transport(capturing(sent)).build();
    client.assets().retrieve("asset-1", RequestOptions.builder().putHeader("X-Trace-Id", "trace-7").build());
    assertEquals("trace-7", header(sent.get(0).request(), "X-Trace-Id"));
    assertEquals("key", header(sent.get(0).request(), "X-Api-Key"));
    for (String name : List.of("X-Api-Key", "Idempotency-Key", "Content-Type")) {
      RequestOptions options = RequestOptions.builder().putHeader(name, "value").build();
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT,
          assertThrows(InvalidArgumentException.class, () -> client.assets().retrieve("asset-1", options), name).getCode());
    }
    assertEquals(1, sent.size());
  }

  @Test void extraQueryAndBodyAreMergedIntoTheRequest() {
    List<Captured> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project-1").transport(capturing(sent)).build();
    client.assets().update("asset-1", AssetUpdateParams.builder().setName("renamed").build(),
        RequestOptions.builder().putExtraQuery("trace", "on").putExtraBody("beta", true).build());
    Transport.Request request = sent.get(0).request();
    assertEquals("/v1/assets/asset-1", request.uri().getRawPath());
    assertEquals("trace=on", request.uri().getRawQuery());
    assertEquals(JsonParser.parseString("{\"name\":\"renamed\",\"beta\":true}"), JsonParser.parseString(sent.get(0).body()));
  }

  @Test void anUnknownLogLevelIsRefused() {
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(ConfigurationException.class,
        () -> CalmLensServerClient.builder().apiKey("key").projectId("project-1").logLevel("loud").build()).getCode());
  }

  @Test void everyPresetSetterReachesTheStoredPreset() {
    MockCalmLensServerClient mock = mock();
    ProcessingOptionsParams processing = ProcessingOptionsParams.builder().setRetainContent(true).build();
    UploadPreset preset = ensure(mock, preset("form", "Form")
        .setRevision(0).setAccess(UploadPresetAccess.ANYONE).setEnabled(false).setAllowedContentTypes(List.of("image/*", "image/*")).setMaxSizeInBytes(5_000_000_000L)
        .setFolderId("fldr_1").setPolicyId("pol_1").setVisibility(Visibility.PUBLIC).setProcessingOptions(processing)
        .setRevealDecision(true).setDailyUploadLimit(20).setAllowedOrigins(List.of("https://example.com"))).get(0);
    assertEquals("form", preset.getKey());
    assertEquals(1, preset.getRevision());
    assertEquals("Form", preset.getName());
    assertEquals(UploadPresetAccess.ANYONE, preset.getAccess());
    assertFalse(preset.getEnabled());
    assertEquals(List.of("image/*"), preset.getAllowedContentTypes().orElseThrow());
    assertEquals(5_000_000_000L, preset.getMaxSizeInBytes().orElseThrow());
    assertEquals("fldr_1", preset.getFolderId().orElseThrow());
    assertEquals("pol_1", preset.getPolicyId().orElseThrow());
    assertEquals(Visibility.PUBLIC, preset.getVisibility());
    assertEquals(Json.GSON.toJsonTree(processing), preset.getProcessingOptions().orElseThrow().getRawJsonObject());
    assertTrue(preset.getRevealDecision());
    assertEquals(20, preset.getDailyUploadLimit().orElseThrow());
    assertEquals(List.of("https://example.com"), preset.getAllowedOrigins().orElseThrow());
  }

  @Test void aPresetReplacedWithoutAFieldReturnsItToItsDefault() {
    MockCalmLensServerClient mock = mock();
    ensure(mock, preset("avatars", "Avatars").setFolderId("fldr_1").setRevealDecision(true));
    UploadPreset replaced = ensure(mock, preset("avatars", "Avatars")).get(0);
    assertEquals(2, replaced.getRevision());
    assertEquals(java.util.Optional.empty(), replaced.getFolderId());
    assertFalse(replaced.getRevealDecision());
  }

  @Test void aClearedPresetFieldIsSentAsNull() {
    MockCalmLensServerClient mock = mock();
    ensure(mock, preset("avatars", "Avatars").clearFolderId());
    JsonObject sent = lastBody(mock).getAsJsonArray("uploadPresets").get(0).getAsJsonObject();
    assertTrue(sent.get("folderId").isJsonNull());
    assertFalse(sent.has("policyId"));
  }

  @Test void aRevisionConflictNamesThePresetAndItsRevision() {
    MockCalmLensServerClient mock = mock();
    ensure(mock, preset("avatars", "Avatars"));
    CalmLensException conflict = assertThrows(CalmLensException.class, () -> ensure(mock, preset("avatars", "Renamed").setRevision(5)));
    assertEquals(ErrorCodes.UPLOAD_PRESET_REVISION_CONFLICT, conflict.getCode());
    assertEquals("avatars", conflict.getDetails().get("key"));
    assertEquals(1, ((Number) conflict.getDetails().get("revision")).intValue());
  }

  @Test void noPresetIsSavedWhenALaterOneIsRefused() {
    MockCalmLensServerClient mock = mock();
    CalmLensException refused = assertThrows(CalmLensException.class,
        () -> ensure(mock, preset("good", "Good"), preset("open", "Open").setAccess(UploadPresetAccess.ANYONE)));
    assertEquals(ErrorCodes.UPLOAD_PRESET_DAILY_LIMIT_REQUIRED, refused.getCode());
    assertEquals(List.of(), mock.client().uploadPresets().list().getItems());
  }

  @Test void iterateYieldsEveryPresetOldestFirst() {
    MockCalmLensServerClient mock = mock();
    for (String key : List.of("first", "second", "third")) ensure(mock, preset(key, key));
    List<String> keys = new ArrayList<>();
    mock.client().uploadPresets().iterate(UploadPresetListParams.builder().setPageSize(2).build()).forEach(preset -> keys.add(preset.getKey()));
    assertEquals(List.of("first", "second", "third"), keys);
    assertEquals("third", mock.client().uploadPresets().list(UploadPresetListParams.builder().setSort("-createdAt").build()).getItems().get(0).getKey());
  }

  @Test void updatingSettingsReplacesThemAndOnlyARealChangeTakesARevision() {
    MockCalmLensServerClient mock = mock();
    ProjectSettingsParams input = ProjectSettingsParams.builder()
        .setOptOutJurisdictions(List.of(Jurisdiction.EU)).setBlockUnmoderatedAssets(false).setStoreSensitiveMetadata(true).setStreamingEnabled(true)
        .setAiMediaSearchEnabled(true).setRemoteUrlRule(RemoteUrlRuleParams.builder().setMode(RemoteUrlMode.ALLOW).setDomains(List.of("example.com")).build())
        .setWebsiteSubmissionsPerMinute(3)
        .setHumanReview(HumanReviewSettingsParams.builder().setAllowedSamplePercent(1.5).setReviewMissingEvidence(true).build()).build();
    ProjectSettingsResource saved = mock.client().projectSettings().update(ProjectSettingsUpdateParams.builder().setSettings(input).setRevision(1)
        .setSearchIndexingBudgetUnits(120.0).build());
    assertEquals(120, lastBody(mock).get("searchIndexingBudgetUnits").getAsInt());
    assertEquals(2, saved.getRevision());
    assertEquals(List.of(Jurisdiction.EU), saved.getSettings().getOptOutJurisdictions());
    assertFalse(saved.getSettings().getBlockUnmoderatedAssets());
    assertTrue(saved.getSettings().getStoreSensitiveMetadata());
    assertTrue(saved.getSettings().getStreamingEnabled());
    assertTrue(saved.getSettings().getAiMediaSearchEnabled());
    assertEquals(RemoteUrlMode.ALLOW, saved.getSettings().getRemoteUrlRule().orElseThrow().getMode());
    assertEquals(List.of("example.com"), saved.getSettings().getRemoteUrlRule().orElseThrow().getDomains());
    assertEquals(3, saved.getSettings().getWebsiteSubmissionsPerMinute().orElseThrow());
    var review = saved.getSettings().getHumanReview();
    assertEquals(List.of(1.5, 0.0, 0.0, true),
        List.of(review.getAllowedSamplePercent(), review.getRestrictedSamplePercent(), review.getUncertaintyMarginPercent(), review.getReviewMissingEvidence()));
    assertEquals(2, mock.client().projectSettings().update(ProjectSettingsUpdateParams.builder().setSettings(input).build()).getRevision());

    ProjectSettingsResource reset = mock.client().projectSettings().update(ProjectSettingsUpdateParams.builder()
        .setSettings(ProjectSettingsParams.builder().clearRemoteUrlRule().build()).build());
    assertTrue(lastBody(mock).getAsJsonObject("settings").get("remoteUrlRule").isJsonNull());
    assertEquals(3, reset.getRevision());
    assertEquals(List.of(), reset.getSettings().getOptOutJurisdictions());
    assertTrue(reset.getSettings().getBlockUnmoderatedAssets());
    assertEquals(java.util.Optional.empty(), reset.getSettings().getRemoteUrlRule());
    var cleared = reset.getSettings().getHumanReview();
    assertEquals(List.of(0.0, 0.0, 0.0, false),
        List.of(cleared.getAllowedSamplePercent(), cleared.getRestrictedSamplePercent(), cleared.getUncertaintyMarginPercent(), cleared.getReviewMissingEvidence()));
  }

  @Test void metadataFieldsAreReplacedByIdAndKeepTheOthers() {
    MockCalmLensServerClient mock = mock();
    MetadataFieldParams order = field("orderId", "Order", null, MetadataFieldIcon.TAG, "#16a34a");
    mock.client().metadataFields().ensure(MetadataFieldsEnsureParams.builder()
        .setFields(List.of(field("userId", "User", null, MetadataFieldIcon.USER, "#2563eb"), order)).build());
    MetadataFieldParams renamed = field("userId", "Member", "Who posted", MetadataFieldIcon.USER, "#2563eb");
    MetadataFieldsResource saved = mock.client().metadataFields().ensure(MetadataFieldsEnsureParams.builder().setFields(List.of(renamed)).setRevision(2).build());
    assertEquals(3, saved.getRevision());
    assertEquals(fieldsJson(List.of(renamed, order)), fieldsJson(saved.getFields()));
    // The field set shares the settings' revision.
    assertEquals(3, mock.client().projectSettings().get().getRevision());

    CalmLensException stale = assertThrows(CalmLensException.class,
        () -> mock.client().metadataFields().delete("userId", MetadataFieldsDeleteParams.builder().setRevision(2).build()));
    assertEquals(ErrorCodes.PROJECT_SETTINGS_REVISION_CONFLICT, stale.getCode());
    assertEquals(fieldsJson(List.of(renamed, order)), fieldsJson(mock.client().metadataFields().list().getFields()));

    mock.client().metadataFields().delete("userId", MetadataFieldsDeleteParams.builder().setRevision(3).build());
    assertEquals(Map.of("revision", "3"), mock.requests().get(mock.requests().size() - 1).query());
    assertEquals(fieldsJson(List.of(order)), fieldsJson(mock.client().metadataFields().list().getFields()));
  }
}
