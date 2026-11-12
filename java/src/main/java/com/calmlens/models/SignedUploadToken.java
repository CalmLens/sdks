package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * A signed upload token.
 */
public final class SignedUploadToken extends CalmLensObject {
  @Required private String token;
  @Required private Long expiresAt;

  private SignedUploadToken() {}

  /** @return the token, to hand to the browser as its bearer token */
  public String getToken() { return required(token, "token"); }

  /** @return when it expires, in milliseconds since the Unix epoch */
  public long getExpiresAt() { return required(expiresAt, "expiresAt"); }
}
