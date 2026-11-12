package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of a hash list's entries, newest first unless {@code sort} says otherwise.
 */
public final class HashListEntryPage extends CalmLensObject implements CursorPage<HashListEntry> {
  @Required private List<HashListEntry> items;
  private String nextCursor;
  @Required private Boolean hasMore;

  private HashListEntryPage() {}

  /** @return entries on this page */
  public List<HashListEntry> getItems() { return required(items, "items"); }

  /** @return continuation cursor; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
