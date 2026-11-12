package com.calmlens.models;

import java.util.List;
import java.util.Optional;

/**
 * One page of a cursor list: pass {@link #getNextCursor()} as the next request's {@code cursor}
 * while {@link #getHasMore()}. The lists' {@code iterate} methods do this for you.
 *
 * @param <T> the listed item
 */
public interface CursorPage<T> {
  /** @return the items on this page */
  List<T> getItems();

  /** @return the next page's cursor; empty on the last page */
  Optional<String> getNextCursor();

  /** @return whether another page follows */
  boolean getHasMore();
}
