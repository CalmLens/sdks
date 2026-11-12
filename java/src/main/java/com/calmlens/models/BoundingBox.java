package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * Position and size as fractions of the image width and height, from 0 to 1. {@code left} and
 * {@code top} can be slightly negative when the subject extends past the edge.
 */
public final class BoundingBox extends CalmLensObject {
  @Required private Double left;
  @Required private Double top;
  @Required private Double width;
  @Required private Double height;

  private BoundingBox() {}

  /** @return left edge */
  public double getLeft() { return required(left, "left"); }

  /** @return top edge */
  public double getTop() { return required(top, "top"); }

  /** @return width */
  public double getWidth() { return required(width, "width"); }

  /** @return height */
  public double getHeight() { return required(height, "height"); }
}
