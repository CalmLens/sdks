package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * What the policy's link safety settings made of an asset's links (preview).
 */
public final class LinkSafetyDecision extends CalmLensObject {
  private String action;
  private List<CheckedLink> links;
  private LinkSafetySettings settings;

  private LinkSafetyDecision() {}

  // NOTE: no facts (not in types.json)
  /** @return the strongest action the asset's links take: {@code allow}, {@code limit}, {@code age-restrict} or {@code block}; empty when the API sends none */
  public Optional<String> getAction() { return Optional.ofNullable(action); }

  // NOTE: no facts (not in types.json)
  /** @return the checked links that take that action, as in {@code classification.linkSafety.links}; empty when the API sends none */
  public Optional<List<CheckedLink>> getLinks() { return Optional.ofNullable(links); }

  // NOTE: no facts (not in types.json)
  /** @return the link safety settings the decision used; empty when the API sends none */
  public Optional<LinkSafetySettings> getSettings() { return Optional.ofNullable(settings); }
}
