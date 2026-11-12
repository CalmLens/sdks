package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Map;
import java.util.Optional;

/**
 * What happens to assets that link to unsafe destinations (preview). Link checks never change a
 * moderation category's score.
 */
public final class LinkSafetySettings extends CalmLensObject {
  private Map<String, String> verdictActions;
  private OffPlatformLinks offPlatformLinks;

  private LinkSafetySettings() {}

  // NOTE: no facts (not in types.json)
  /** @return the action for an asset with a link of each verdict ({@code phishing}, {@code malware}, {@code adult}, {@code gambling} or {@code unresolved}); a verdict left out is allowed; empty when the API sends none */
  public Optional<Map<String, String>> getVerdictActions() { return Optional.ofNullable(verdictActions); }

  // NOTE: no facts (not in types.json)
  /** @return acts on every link whose destination is outside its allowed domains, whatever its verdict; null when off; empty when the API sends none */
  public Optional<OffPlatformLinks> getOffPlatformLinks() { return Optional.ofNullable(offPlatformLinks); }
}
