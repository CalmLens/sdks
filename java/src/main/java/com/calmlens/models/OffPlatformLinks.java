package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * The action for links outside a list of domains (preview).
 */
public final class OffPlatformLinks extends CalmLensObject {
  private String action;
  private List<String> allowedDomains;

  private OffPlatformLinks() {}

  // NOTE: no facts (not in types.json)
  /** @return {@code limit}, {@code age-restrict} or {@code block}; empty when the API sends none */
  public Optional<String> getAction() { return Optional.ofNullable(action); }

  // NOTE: no facts (not in types.json)
  /** @return bare lowercase domains whose links are on-platform; a domain also covers its subdomains; empty when the API sends none */
  public Optional<List<String>> getAllowedDomains() { return Optional.ofNullable(allowedDomains); }
}
