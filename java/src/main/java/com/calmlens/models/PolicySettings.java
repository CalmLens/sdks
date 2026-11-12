package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Map;
import java.util.Optional;

/**
 * A policy's settings.
 */
public final class PolicySettings extends CalmLensObject {
  @Required private Map<String, PolicyCategorySettings> categorySettings;
  private LinkSafetySettings linkSafety;

  private PolicySettings() {}

  /** @return the settings of every category, by category: {@code sexual}, {@code violence}, {@code self-harm}, {@code harassment}, {@code hate}, {@code criminal-activity}, {@code personal-information} and {@code profanity} */
  public Map<String, PolicyCategorySettings> getCategorySettings() { return required(categorySettings, "categorySettings"); }

  // NOTE: no facts (not in types.json)
  /** @return what happens to assets that link to unsafe destinations (preview); empty when the API sends none */
  public Optional<LinkSafetySettings> getLinkSafety() { return Optional.ofNullable(linkSafety); }
}
