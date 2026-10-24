package com.calmlens;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Base type of every failure the SDK reports. It is unchecked, like most Java HTTP client errors.
 *
 * <ul>
 *   <li>{@link ApiException}: the API answered with an error (or an unreadable body); carries the
 *       HTTP status, request ID, headers and {@code Retry-After}.
 *   <li>{@link TransportException}: the request could not be sent or its response could not be
 *       read; {@link RequestTimeoutException} when it timed out.
 *   <li>{@code CalmLensException} itself: invalid arguments ({@link ErrorCodes#SDK_INVALID_ARGUMENT}),
 *       invalid configuration ({@link ErrorCodes#SDK_INVALID_CONFIG}), upload payload validation
 *       ({@code upload/*}), webhook verification ({@code webhook/*}), interruption ({@link
 *       ErrorCodes#SDK_CANCELLED}) and use after close ({@link ErrorCodes#SDK_CLIENT_CLOSED}).
 *       Nothing was sent for validation failures.
 * </ul>
 *
 * <p>Handle failures by {@link #getCode()} (see {@link ErrorCodes}); messages are for logs.
 */
public class CalmLensException extends RuntimeException {
  private static final long serialVersionUID = 1L;
  private final String code;
  private final transient Map<String, Object> details;

  CalmLensException(String code, String message, Map<String, Object> details, Throwable cause) {
    super("[calmlens] " + (message == null || message.isEmpty() ? code : message), cause);
    this.code = code;
    this.details = details == null || details.isEmpty() ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(details));
  }

  CalmLensException(String code, String message) { this(code, message, null, null); }

  CalmLensException(String code, String message, Throwable cause) { this(code, message, null, cause); }

  /** @return the stable error code, for example {@code asset/not-found} or {@code sdk/timeout} */
  public String getCode() { return code; }

  /** @return extra structured information from the API error body; never null */
  public Map<String, Object> getDetails() { return details == null ? Map.of() : details; }

  /** @return the HTTP status, or 0 when the failure did not come from an HTTP response */
  public int getStatus() { return 0; }

  /** @return the {@code X-Request-Id} of the failed request, or null when there was no response */
  public String getRequestId() { return null; }

  /** @return whether the API reported that the resource does not exist (HTTP 404) */
  public boolean isNotFound() { return getStatus() == 404; }

  /**
   * Whether repeating the same request later may succeed. It follows from {@link #getCode()} and
   * {@link #getStatus()} alone, whatever the exception's class: {@link ErrorCodes#SDK_TRANSPORT_ERROR},
   * {@link ErrorCodes#SDK_TIMEOUT} (a request timeout or {@code waitForDecision}'s deadline), {@link
   * ErrorCodes#IDEMPOTENT_REQUEST_IN_PROGRESS} and HTTP 429, 502, 503 and 504 are retryable; nothing
   * else is, {@link ErrorCodes#SDK_CANCELLED} and other 5xx statuses included. The client already
   * retries these for safe requests (see {@link CalmLensServerClient.Builder#maxRetries(int)}).
   * Repeat a write only with the same idempotency key.
   *
   * @return whether the failure is transient
   */
  public final boolean isRetryable() {
    String code = getCode();
    int status = getStatus();
    return ErrorCodes.SDK_TRANSPORT_ERROR.equals(code) || ErrorCodes.SDK_TIMEOUT.equals(code)
        || ErrorCodes.IDEMPOTENT_REQUEST_IN_PROGRESS.equals(code)
        || status == 429 || status == 502 || status == 503 || status == 504;
  }
}
