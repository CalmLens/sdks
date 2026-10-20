package com.calmlens;

/**
 * A request did not complete within its timeout ({@link ErrorCodes#SDK_TIMEOUT}): connecting,
 * waiting for the response, reading the response body, or a stalled CDN stream.
 */
public class RequestTimeoutException extends TransportException {
  private static final long serialVersionUID = 1L;

  RequestTimeoutException(String message, Throwable cause) { super(ErrorCodes.SDK_TIMEOUT, message, cause); }
}
