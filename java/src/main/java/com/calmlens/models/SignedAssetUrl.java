package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;

/**
 * A signed asset URL, or a resource URL beneath it. It grants access until it expires, so {@link
 * #toString()} hides its grant and query.
 */
public final class SignedAssetUrl extends CalmLensObject {
  @Required private String url;
  @Required @JsonAdapter(EpochMillis.class) private Instant expiresAt;

  private SignedAssetUrl() {}

  /** @return the signed URL */
  public String getUrl() { return required(url, "url"); }

  /** @return expiry time */
  public Instant getExpiresAt() { return required(expiresAt, "expiresAt"); }


  /** @return the URL with its signature and query redacted, so logs don't leak the grant */
  @Override public String toString() {
    String shown = url == null ? null : url.replaceAll("/sig_[^/?#]*", "/sig_[redacted]").replaceAll("\\?.*$", "?[redacted]");
    return "SignedAssetUrl[url=" + shown + ", expiresAt=" + expiresAt + "]";
  }
}
