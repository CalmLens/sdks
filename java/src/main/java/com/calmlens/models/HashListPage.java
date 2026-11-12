package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of a project's hash lists.
 */
public final class HashListPage extends CalmLensObject implements CursorPage<HashList> {
  @Required private List<HashList> items;
  private String nextCursor;
  @Required private Boolean hasMore;

  private HashListPage() {}

  /** @return hash lists on this page */
  public List<HashList> getItems() { return required(items, "items"); }

  /** @return pass as {@code cursor} to get the next page; null on the last page; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
