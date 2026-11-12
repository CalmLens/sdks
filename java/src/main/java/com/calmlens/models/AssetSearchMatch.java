package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * One search match.
 */
public final class AssetSearchMatch extends CalmLensObject {
  @Required private Asset asset;
  @Required private Double score;
  @Required private List<SearchField> matchedFields;

  private AssetSearchMatch() {}

  /** @return the matching asset */
  public Asset getAsset() { return required(asset, "asset"); }

  /** @return relevance score */
  public double getScore() { return required(score, "score"); }

  /** @return fields that matched */
  public List<SearchField> getMatchedFields() { return required(matchedFields, "matchedFields"); }
}
