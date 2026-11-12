package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of folders and the visible paths needed to reveal them.
 */
public final class FolderPage extends CalmLensObject implements CursorPage<Folder> {
  @Required private List<Folder> items;
  @Required private List<Folder> ancestors;
  private String nextCursor;
  @Required private Boolean hasMore;

  private FolderPage() {}

  /** @return folders on this page */
  public List<Folder> getItems() { return required(items, "items"); }

  /** @return folders on the paths to the listed, selected and parent folders */
  public List<Folder> getAncestors() { return required(ancestors, "ancestors"); }

  /** @return pass as {@code cursor} to get the next page; null on the last page; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
