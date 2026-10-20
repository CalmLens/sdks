package com.calmlens;

/**
 * A request could not be sent or its response could not be read ({@link
 * ErrorCodes#SDK_TRANSPORT_ERROR}): connection refused or reset, DNS, TLS, malformed HTTP, a
 * truncated body, or an unchecked exception from a custom {@link Transport}. The original exception
 * is the {@linkplain #getCause() cause}. The request may or may not have reached CalmLens.
 */
public class TransportException extends CalmLensException {
  private static final long serialVersionUID = 1L;

  TransportException(String code, String message, Throwable cause) { super(code, message, cause); }

  @Override public boolean isRetryable() { return true; }
}
