package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of the project's lenses, newest first unless {@code sort} says otherwise. The built-in
 * lenses are always available and aren't listed.
 */
public final class LensPage extends CalmLensObject implements CursorPage<Lens> {
  @Required private List<Lens> items;
  private String nextCursor;
  @Required private Boolean hasMore;

  private LensPage() {}

  /** @return lenses on this page */
  public List<Lens> getItems() { return required(items, "items"); }

  /** @return pass as {@code cursor} to get the next page; null on the last page; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
