package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * Earlier posts in the conversation, oldest first. CalmLens moderates only the content and uses
 * these to read who it addresses, what it refers to and whether it quotes, reports, counters or
 * mocks something.
 */
public final class ModerationContext extends CalmLensObject {
  @Required private List<ModerationContextItem> items;

  private ModerationContext() {}

  /** @return the earlier posts, oldest first */
  public List<ModerationContextItem> getItems() { return required(items, "items"); }
}
