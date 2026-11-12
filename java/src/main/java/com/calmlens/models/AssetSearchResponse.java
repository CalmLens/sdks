package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * Search results.
 */
public final class AssetSearchResponse extends CalmLensObject {
  @Required private String query;
  @Required private List<AssetSearchMatch> items;
  @Required private SemanticSearchStatus semanticStatus;

  private AssetSearchResponse() {}

  /** @return the query */
  public String getQuery() { return required(query, "query"); }

  /** @return matches, best first */
  public List<AssetSearchMatch> getItems() { return required(items, "items"); }

  /** @return availability of semantic search */
  public SemanticSearchStatus getSemanticStatus() { return required(semanticStatus, "semanticStatus"); }
}
