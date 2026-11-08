package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.MockCalmLensServerClient.Options;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** The typed builders, which the shared fixtures bypass by decoding options, and what the mock keeps. */
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

  private static Models.EnsureUploadPresets ensure(Models.UploadPresetDefinition... definitions) {
    return new Models.EnsureUploadPresets(List.of(definitions));
  }

  @Test void anApiKeyOutsidePrintableAsciiIsRefusedBeforeAnyRequest() {
    for (String key : List.of("k\u00e9y", "key\u007f", "key\u0000"))
      assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class, () -> new CalmLensServerClient(key, "project-1")).getCode());
  }

  @Test void everyPresetSetterReachesTheStoredPreset() {
    MockCalmLensServerClient mock = mock();
    Models.ProcessingOptions processing = new Models.ProcessingOptions().keepContentAfterProcessing(true);
    Models.UploadPreset preset = mock.client.uploadPresets.ensure(ensure(new Models.UploadPresetDefinition("form", "Form")
        .revision(0).access("anyone").enabled(false).allowedContentTypes(List.of("image/*", "image/*")).maxSizeInBytes(5_000_000_000L)
        .folderId("fldr_1").policyId("pol_1").visibility(Models.Visibility.PUBLIC).processingOptions(processing)
        .revealDecision(true).dailyUploadLimit(20).allowedOrigins(List.of("https://example.com")))).uploadPresets().get(0);
    assertEquals("form", preset.key());
    assertEquals(1, preset.revision());
    assertEquals("Form", preset.name());
    assertEquals("anyone", preset.access());
    assertEquals(false, preset.enabled());
    assertEquals(List.of("image/*"), preset.allowedContentTypes());
    assertEquals(5_000_000_000L, preset.maxSizeInBytes());
    assertEquals("fldr_1", preset.folderId());
    assertEquals("pol_1", preset.policyId());
    assertEquals(Models.Visibility.PUBLIC, preset.visibility());
    assertEquals(processing, preset.processingOptions());
    assertEquals(true, preset.revealDecision());
    assertEquals(20, preset.dailyUploadLimit());
    assertEquals(List.of("https://example.com"), preset.allowedOrigins());
  }

  @Test void aPresetReplacedWithoutAFieldReturnsItToItsDefault() {
    MockCalmLensServerClient mock = mock();
    mock.client.uploadPresets.ensure(ensure(new Models.UploadPresetDefinition("avatars", "Avatars").folderId("fldr_1").revealDecision(true)));
    Models.UploadPreset replaced = mock.client.uploadPresets.ensure(ensure(new Models.UploadPresetDefinition("avatars", "Avatars"))).uploadPresets().get(0);
    assertEquals(2, replaced.revision());
    assertNull(replaced.folderId());
    assertEquals(false, replaced.revealDecision());
  }

  @Test void aNullPresetFieldIsSentAsNull() {
    MockCalmLensServerClient mock = mock();
    mock.client.uploadPresets.ensure(ensure(new Models.UploadPresetDefinition("avatars", "Avatars").folderId(null)));
    JsonObject sent = lastBody(mock).getAsJsonArray("uploadPresets").get(0).getAsJsonObject();
    assertTrue(sent.get("folderId").isJsonNull());
    assertFalse(sent.has("policyId"));
  }

  @Test void aRevisionConflictNamesThePresetAndItsRevision() {
    MockCalmLensServerClient mock = mock();
    mock.client.uploadPresets.ensure(ensure(new Models.UploadPresetDefinition("avatars", "Avatars")));
    CalmLensException conflict = assertThrows(CalmLensException.class,
        () -> mock.client.uploadPresets.ensure(ensure(new Models.UploadPresetDefinition("avatars", "Renamed").revision(5))));
    assertEquals(ErrorCodes.UPLOAD_PRESET_REVISION_CONFLICT, conflict.getCode());
    assertEquals("avatars", conflict.getDetails().get("key"));
    assertEquals(1, ((Number) conflict.getDetails().get("revision")).intValue());
  }

  @Test void noPresetIsSavedWhenALaterOneIsRefused() {
    MockCalmLensServerClient mock = mock();
    CalmLensException refused = assertThrows(CalmLensException.class, () -> mock.client.uploadPresets.ensure(ensure(
        new Models.UploadPresetDefinition("good", "Good"), new Models.UploadPresetDefinition("open", "Open").access("anyone"))));
    assertEquals(ErrorCodes.UPLOAD_PRESET_DAILY_LIMIT_REQUIRED, refused.getCode());
    assertEquals(List.of(), mock.client.uploadPresets.list().items());
  }

  @Test void iterateYieldsEveryPresetOldestFirst() {
    MockCalmLensServerClient mock = mock();
    for (String key : List.of("first", "second", "third")) mock.client.uploadPresets.ensure(ensure(new Models.UploadPresetDefinition(key, key)));
    List<String> keys = new ArrayList<>();
    mock.client.uploadPresets.iterate(new Models.ListUploadPresets().pageSize(2)).forEach(preset -> keys.add(preset.key()));
    assertEquals(List.of("first", "second", "third"), keys);
    assertEquals("third", mock.client.uploadPresets.list(new Models.ListUploadPresets().sort("-createdAt")).items().get(0).key());
  }

  @Test void updatingSettingsReplacesThemAndOnlyARealChangeTakesARevision() {
    MockCalmLensServerClient mock = mock();
    Models.ProjectSettingsInput input = new Models.ProjectSettingsInput()
        .optOutJurisdictions(List.of("EU")).blockUnmoderatedAssets(false).storeSensitiveMetadata(true).streamingEnabled(true)
        .aiMediaSearchEnabled(true).remoteUrlRule(new Models.RemoteUrlRule("allow", List.of("example.com"))).websiteSubmissionsPerMinute(3)
        .humanReview(new Models.HumanReviewSettings().allowedSamplePercent(1.5).reviewMissingEvidence(true));
    Models.ProjectSettingsResource saved = mock.client.projectSettings.update(new Models.UpdateProjectSettings(input).revision(1).searchIndexingBudgetUnits(120.0));
    assertEquals(120, lastBody(mock).get("searchIndexingBudgetUnits").getAsInt());
    assertEquals(2, saved.revision());
    assertEquals(List.of("EU"), saved.settings().optOutJurisdictions());
    assertEquals(false, saved.settings().blockUnmoderatedAssets());
    assertEquals(true, saved.settings().storeSensitiveMetadata());
    assertEquals(true, saved.settings().streamingEnabled());
    assertEquals(true, saved.settings().aiMediaSearchEnabled());
    assertEquals(new Models.RemoteUrlRule("allow", List.of("example.com")), saved.settings().remoteUrlRule());
    assertEquals(3, saved.settings().websiteSubmissionsPerMinute());
    assertEquals(new Models.HumanReviewSettings(1.5, 0.0, 0.0, true), saved.settings().humanReview());
    assertEquals(2, mock.client.projectSettings.update(new Models.UpdateProjectSettings(input)).revision());

    Models.ProjectSettingsResource reset = mock.client.projectSettings.update(new Models.UpdateProjectSettings(new Models.ProjectSettingsInput().remoteUrlRule(null)));
    assertTrue(lastBody(mock).getAsJsonObject("settings").get("remoteUrlRule").isJsonNull());
    assertEquals(3, reset.revision());
    assertEquals(List.of(), reset.settings().optOutJurisdictions());
    assertEquals(true, reset.settings().blockUnmoderatedAssets());
    assertNull(reset.settings().remoteUrlRule());
    assertEquals(new Models.HumanReviewSettings(0.0, 0.0, 0.0, false), reset.settings().humanReview());
  }

  @Test void metadataFieldsAreReplacedByIdAndKeepTheOthers() {
    MockCalmLensServerClient mock = mock();
    Models.MetadataField order = new Models.MetadataField("orderId", "Order", "string", "tag", "#16a34a");
    mock.client.metadataFields.ensure(new Models.EnsureMetadataFields(List.of(new Models.MetadataField("userId", "User", "string", "user", "#2563eb"), order)));
    Models.MetadataField renamed = new Models.MetadataField("userId", "Member", "Who posted", "string", "user", "#2563eb");
    Models.MetadataFieldsResource saved = mock.client.metadataFields.ensure(new Models.EnsureMetadataFields(List.of(renamed)).revision(2));
    assertEquals(3, saved.revision());
    assertEquals(List.of(renamed, order), saved.fields());
    // The field set shares the settings' revision.
    assertEquals(3, mock.client.projectSettings.get().revision());

    CalmLensException stale = assertThrows(CalmLensException.class,
        () -> mock.client.metadataFields.delete(new Models.DeleteMetadataField("userId").revision(2)));
    assertEquals(ErrorCodes.PROJECT_SETTINGS_REVISION_CONFLICT, stale.getCode());
    assertEquals(List.of(renamed, order), mock.client.metadataFields.list().fields());

    mock.client.metadataFields.delete(new Models.DeleteMetadataField("userId").revision(3));
    assertEquals(Map.of("revision", "3"), mock.requests().get(mock.requests().size() - 1).query());
    assertEquals(List.of(order), mock.client.metadataFields.list().fields());
  }
}
