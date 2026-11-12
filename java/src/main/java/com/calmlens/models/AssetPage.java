package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of assets. Use {@code assets.iterate} to go through every page.
 */
public final class AssetPage extends CalmLensObject implements CursorPage<Asset> {
  @Required private List<Asset> items;
  private String nextCursor;
  @Required private Boolean hasMore;

  private AssetPage() {}

  /** @return assets on this page */
  public List<Asset> getItems() { return required(items, "items"); }

  /** @return continuation cursor; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
