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
 * {@link CalmLensException}s from {@link Iterator#hasNext()}, and so does a page that says more
 * follow but hands back a cursor the iteration already sent ({@link ErrorCodes#SDK_INVALID_RESPONSE},
 * with the {@code cursor} in its details), so iteration never loops.
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
  private final boolean startSent;
  private volatile String cursor;

  /**
   * @param startSent whether {@code start} counts as a cursor already sent (the events feed's
   *     {@code cursor}), so a page handing it back with more to follow fails
   */
  AutoPager(Source<T> source, String start, boolean startSent) {
    this.source = source;
    this.start = start;
    this.startSent = startSent;
    this.cursor = start;
  }

  /**
   * For {@code events.pages}: the cursor after the last page fetched, to persist and pass as
   * {@code cursor} later. It advances only after a whole page was fetched.
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
      private final java.util.Set<String> sent = new java.util.HashSet<>();

      {
        if (startSent && start != null) sent.add(start);
      }

      @Override public boolean hasNext() {
        while (!page.hasNext() && more) {
          Chunk<T> chunk = source.fetch(token);
          // A page without items ends iteration unless the API says more are ready (event cursors).
          boolean next = chunk.hasMore() && chunk.next() != null;
          // Stop rather than loop: a page with more to follow must not hand back a cursor already sent.
          if (next && !sent.add(chunk.next())) {
            more = false;
            throw new CalmLensException(ErrorCodes.SDK_INVALID_RESPONSE,
                "The API returned a cursor it had already returned, with more pages to follow", java.util.Map.of("cursor", chunk.next()), null);
          }
          token = chunk.next();
          cursor = chunk.next();
          more = next;
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
