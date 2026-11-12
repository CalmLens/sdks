package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * An upload's match against a hash list entry.
 */
public final class HashMatch extends CalmLensObject {
  @Required private HashMatchSource source;
  @Required private String hashListId;
  @Required private String hashListEntryId;
  @Required private Integer distance;
  @Required private HashListAction action;

  private HashMatch() {}

  /** @return {@code hash-list} */
  public HashMatchSource getSource() { return required(source, "source"); }

  /** @return the hash list */
  public String getHashListId() { return required(hashListId, "hashListId"); }

  /** @return the matching entry */
  public String getHashListEntryId() { return required(hashListEntryId, "hashListEntryId"); }

  /** @return Hamming distance between the hashes */
  public int getDistance() { return required(distance, "distance"); }

  /** @return the list's action when matched: {@code flag} or {@code block} */
  public HashListAction getAction() { return required(action, "action"); }
}
