package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * A link found in an asset.
 */
public final class DetectedLink extends CalmLensObject {
  @Required private String url;
  @Required private LinkSource source;

  private DetectedLink() {}

  /** @return the link */
  public String getUrl() { return required(url, "url"); }

  /** @return where it was found: {@code qr-code} or {@code text} */
  public LinkSource getSource() { return required(source, "source"); }
}
