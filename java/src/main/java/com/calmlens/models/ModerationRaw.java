package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Map;

/**
 * Detection findings before policy evaluation.
 */
public final class ModerationRaw extends CalmLensObject {
  @Required private Map<String, CategoryResult> categories;
  @Required private List<HashMatch> hashMatches;

  private ModerationRaw() {}

  /** @return categories */
  public Map<String, CategoryResult> getCategories() { return required(categories, "categories"); }

  /** @return hashMatches */
  public List<HashMatch> getHashMatches() { return required(hashMatches, "hashMatches"); }
}
