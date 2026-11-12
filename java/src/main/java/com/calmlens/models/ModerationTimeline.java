package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * An audio or video asset's findings timeline, listed with {@code assets.listTimeline}.
 */
public final class ModerationTimeline extends CalmLensObject {
  @Required private Integer segmentCount;

  private ModerationTimeline() {}

  /** @return how many segments the timeline has */
  public int getSegmentCount() { return required(segmentCount, "segmentCount"); }
}
