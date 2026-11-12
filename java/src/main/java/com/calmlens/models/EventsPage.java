package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * One page of the events feed.
 */
public final class EventsPage extends CalmLensObject {
  @Required private List<Event> items;
  @Required private String nextCursor;
  @Required private Boolean hasMore;
  @Required private List<EventType> excludedTypes;

  private EventsPage() {}

  /** @return events, oldest first */
  public List<Event> getItems() { return required(items, "items"); }

  /** @return pass as {@code cursor} to get newer events; never null, so persist it to resume */
  public String getNextCursor() { return required(nextCursor, "nextCursor"); }

  /** @return whether more events are available now */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }

  /** @return event types this feed never includes, because the API key lacks the permission to see them; give the key that permission to receive them */
  public List<EventType> getExcludedTypes() { return required(excludedTypes, "excludedTypes"); }
}
