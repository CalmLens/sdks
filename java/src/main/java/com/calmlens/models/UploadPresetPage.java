package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * One page of the project's upload presets, oldest first unless {@code sort} says otherwise.
 */
public final class UploadPresetPage extends CalmLensObject implements CursorPage<UploadPreset> {
  @Required private List<UploadPreset> items;
  private String nextCursor;
  @Required private Boolean hasMore;

  private UploadPresetPage() {}

  /** @return upload presets on this page */
  public List<UploadPreset> getItems() { return required(items, "items"); }

  /** @return pass as {@code cursor} to get the next page; null on the last page; empty when the API sends none */
  public Optional<String> getNextCursor() { return Optional.ofNullable(nextCursor); }

  /** @return whether another page follows */
  public boolean getHasMore() { return required(hasMore, "hasMore"); }
}
