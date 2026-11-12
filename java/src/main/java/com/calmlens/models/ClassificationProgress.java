package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * How far analysis of a long audio or video asset has got.
 */
public final class ClassificationProgress extends CalmLensObject {
  @Required private Integer completedSections;
  @Required private Integer totalSections;

  private ClassificationProgress() {}

  /** @return sections analysed so far */
  public int getCompletedSections() { return required(completedSections, "completedSections"); }

  /** @return sections in the asset */
  public int getTotalSections() { return required(totalSections, "totalSections"); }
}
