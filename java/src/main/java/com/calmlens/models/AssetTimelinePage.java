package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of an audio or video asset's findings timeline, in time order.
 */
public final class AssetTimelinePage extends CalmLensObject implements CursorPage<MediaClassificationSegment> {
  @Required private List<MediaClassificationSegment> items;
  private String nextCursor;
  @Required private Boolean hasMore;

  private AssetTimelinePage() {}

  /** @return segments on this page */
  public List<MediaClassificationSegment> getItems() { return required(items, "items"); }

  /** @return continuation cursor; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
