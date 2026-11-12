package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One reputation check of a link, every address it redirects through and its destination
 * (preview).
 */
public final class LinkSafetyEvidence extends CalmLensObject {
  private String check;
  private String status;
  private List<String> labels;

  private LinkSafetyEvidence() {}

  // NOTE: no facts (not in types.json)
  /** @return {@code domain-categories} or {@code threat-lists}; empty when the API sends none */
  public Optional<String> getCheck() { return Optional.ofNullable(check); }

  // NOTE: no facts (not in types.json)
  /** @return {@code checked}, or {@code failed} when the check could not answer, which makes the link {@code unresolved}; empty when the API sends none */
  public Optional<String> getStatus() { return Optional.ofNullable(status); }

  // NOTE: no facts (not in types.json)
  /** @return what the check reported for any of the addresses, such as the domains' content categories and security risks or the threat types listed; empty when the API sends none */
  public Optional<List<String>> getLabels() { return Optional.ofNullable(labels); }
}
