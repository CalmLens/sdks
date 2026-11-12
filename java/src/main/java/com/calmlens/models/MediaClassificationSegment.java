package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Map;

/**
 * One stretch of an audio or video asset's findings: its source, times and scores.
 */
public final class MediaClassificationSegment extends CalmLensObject {
  @Required private SegmentSource source;
  @Required private Double startSeconds;
  @Required private Double endSeconds;
  @Required private Map<String, CategoryResult> categories;

  private MediaClassificationSegment() {}

  /** @return {@code clip}, {@code frame}, {@code frame-text} or {@code speech} */
  public SegmentSource getSource() { return required(source, "source"); }

  /** @return segment start */
  public double getStartSeconds() { return required(startSeconds, "startSeconds"); }

  /** @return segment end */
  public double getEndSeconds() { return required(endSeconds, "endSeconds"); }

  /** @return results by category */
  public Map<String, CategoryResult> getCategories() { return required(categories, "categories"); }
}
