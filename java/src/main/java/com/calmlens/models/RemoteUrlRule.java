package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * Restricts the domains a project accepts when content is submitted by URL, including websites.
 */
public final class RemoteUrlRule extends CalmLensObject {
  @Required private RemoteUrlMode mode;
  @Required private List<String> domains;

  private RemoteUrlRule() {}

  /** @return {@code allow} accepts only the listed domains; {@code deny} accepts every domain except them */
  public RemoteUrlMode getMode() { return required(mode, "mode"); }

  /** @return the domains */
  public List<String> getDomains() { return required(domains, "domains"); }
}
