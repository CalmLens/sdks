package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * Estimated age range in years. Estimates can be off by several years.
 */
public final class AgeRange extends CalmLensObject {
  @Required private Integer low;
  @Required private Integer high;

  private AgeRange() {}

  /** @return lowest estimated age */
  public int getLow() { return required(low, "low"); }

  /** @return highest estimated age */
  public int getHigh() { return required(high, "high"); }
}
