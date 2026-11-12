package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of the organisation's policies, oldest first unless {@code sort} says otherwise.
 */
public final class PolicyPage extends CalmLensObject implements CursorPage<Policy> {
  @Required private List<Policy> items;
  private String nextCursor;
  @Required private Boolean hasMore;

  private PolicyPage() {}

  /** @return policies on this page */
  public List<Policy> getItems() { return required(items, "items"); }

  /** @return pass as {@code cursor} to get the next page; null on the last page; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
