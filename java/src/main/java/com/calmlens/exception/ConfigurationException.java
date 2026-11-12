package com.calmlens.exception;

import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The client's configuration is invalid ({@code sdk/invalid-config}). */
public class ConfigurationException extends InvalidArgumentException {
  private static final long serialVersionUID = 1L;

  /**
   * Creates the exception. The SDK raises these itself; construct one only to test your handling.
   *
   * @param code the error code, such as {@code asset/not-found}
   * @param message a message for logs
   * @param details structured details, or null
   * @param status the HTTP status, or 0 without a response
   * @param headers the response headers, or null
   * @param requestId the request ID when the response has no {@code X-Request-Id} header, or null
   * @param body the response body, or null
   * @param cause the cause, or null
   */
  public ConfigurationException(String code, @Nullable String message, @Nullable Map<String, Object> details, int status,
      @Nullable Map<String, List<String>> headers, @Nullable String requestId, @Nullable String body, @Nullable Throwable cause) {
    super(code, message, details, status, headers, requestId, body, cause);
  }
}
