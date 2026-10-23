package com.calmlens;

import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Spliterator;
import java.util.Spliterators;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

/**
 * Iterates over every item of a paginated list, requesting the next page only when the current one
 * is used up. Each {@link #iterator()} starts again from the first page. Request failures surface as
 * {@link CalmLensException}s from {@link Iterator#hasNext()}.
 *
 * <pre>{@code
 * for (Asset asset : client.assets.iterate(new ListAssets().filter("classification.moderation.status==blocked"))) { ... }
 * }</pre>
 *
 * @param <T> the item type
 */
public final class AutoPager<T> implements Iterable<T> {
  /** One fetched page: its items, the token for the next page, and whether one follows. */
  record Chunk<T>(List<T> items, String next, boolean hasMore) {}

  @FunctionalInterface
  interface Source<T> { Chunk<T> fetch(String token); }

  private final Source<T> source;
  private final String start;
  private volatile String cursor;

  AutoPager(Source<T> source, String start) {
    this.source = source;
    this.start = start;
    this.cursor = start;
  }

  /**
   * For {@code events.pages}: the cursor after the last page fetched, to persist and pass as
   * {@code after} later. It advances only after a whole page was fetched.
   *
   * @return the latest cursor
   */
  public String cursor() { return cursor; }

  /** @return a sequential stream over every item */
  public Stream<T> stream() {
    return StreamSupport.stream(Spliterators.spliteratorUnknownSize(iterator(), Spliterator.ORDERED | Spliterator.NONNULL), false);
  }

  @Override public Iterator<T> iterator() {
    return new Iterator<>() {
      private Iterator<T> page = List.<T>of().iterator();
      private String token = start;
      private boolean more = true;

      @Override public boolean hasNext() {
        while (!page.hasNext() && more) {
          Chunk<T> chunk = source.fetch(token);
          token = chunk.next();
          cursor = chunk.next();
          // A page without items ends iteration unless the API says more are ready (event cursors).
          more = chunk.hasMore() && token != null;
          page = chunk.items().iterator();
        }
        return page.hasNext();
      }

      @Override public T next() {
        if (!hasNext()) throw new NoSuchElementException();
        return page.next();
      }
    };
  }
}
